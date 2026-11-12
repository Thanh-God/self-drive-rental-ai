package com.carrental;

import com.carrental.exception.DomainException;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.operation.service.RentalWorkflow;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * R9 (12/11/2026): the customer's "Đồng ý" and a cancellation or handover of the same booking are serialized on the booking lock.
 * MySQL only: each case holds one transaction open, waits until the other request is really blocked in InnoDB
 * (performance_schema.data_lock_waits), then commits. No sleep decides the order.
 */
@SpringBootTest(properties = {"app.jwt-secret=contract-acceptance-race-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=ContractAcceptanceRaceOnly123!", "app.deposit-enabled=false", "app.payment-reconcile-ms=86400000",
    "app.contract-acceptance-enabled=true", "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@Import(ContractAcceptanceRaceTest.TimeConfig.class)
class ContractAcceptanceRaceTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("contract-acceptance-race-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:contractacceptancerace;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
        r.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        r.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("app.license-photo-directory", ROOT::toString);
    }

    static class FixtureClock extends Clock {
        volatile Instant value = Instant.parse("2026-10-23T03:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId z) { return this; }
        public Instant instant() { return value; }
    }

    @TestConfiguration
    static class TimeConfig { @Bean @Primary FixtureClock contractAcceptanceRaceClock() { return new FixtureClock(); } }

    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired RentalWorkflow rental;
    @Autowired TransactionTemplate tx;
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");

    @BeforeEach
    void setup() {
        Assumptions.assumeTrue(System.getenv("KDRIVE_TEST_DB_URL") != null, "Lock ordering is proven on MySQL only");
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-ACCEPTANCE-RACE", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    /** Same-branch booking without a deposit (26/10 → 28/10), confirmed by pickup Staff; its contract needs acceptance. */
    BookingService.View confirmed() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        rental.apply(staff, b.id(), new BookingService.Action("CONFIRMED", b.version(), null, null, false, false));
        var c = bookings.view(bookings.require(user, b.id()));
        assertEquals("contract-2026-11-12-v2", jdbc.queryForObject("select terms_version from contracts where booking_id=?", String.class, b.id()));
        return c;
    }

    BookingService.Action cancel(long version) { return new BookingService.Action("CANCELLED", version, "Synthetic customer cancellation", null, false, false); }

    String status(String id) { return jdbc.queryForObject("select status from bookings where id=?", String.class, id); }

    Instant acceptedAt(String id) {
        var t = jdbc.queryForObject("select accepted_at from contracts where booking_id=?", Timestamp.class, id);
        return t == null ? null : t.toInstant();
    }

    /** True once another transaction waits on a row lock of this schema's bookings/vehicles/contracts (polled, at most 5 s). */
    boolean otherRequestBlocked() {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < end) {
            Long waits = jdbc.queryForObject("select count(*) from performance_schema.data_lock_waits w join performance_schema.data_locks l " +
                "on w.requesting_engine_lock_id=l.engine_lock_id where l.object_schema=database() and l.object_name in ('bookings','vehicles','contracts')", Long.class);
            if (waits != null && waits > 0) return true;
            try { Thread.sleep(20); } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
        }
        return false;
    }

    static void await(CountDownLatch latch) {
        try { if (!latch.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("latch timed out"); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
    }

    /** Runs the holder (which keeps its transaction open until the other request blocks) and the other request; returns their errors. */
    List<Throwable> race(java.util.function.Consumer<Runnable> holder, Runnable other) throws Exception {
        var holderErr = new AtomicReference<Throwable>();
        var otherErr = new AtomicReference<Throwable>();
        var holding = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            pool.submit(() -> { try { holder.accept(holding::countDown); } catch (Throwable t) { holderErr.set(t); holding.countDown(); } });
            pool.submit(() -> { try { await(holding); other.run(); } catch (Throwable t) { otherErr.set(t); } });
        } finally {
            pool.shutdown();
        }
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS), "both requests finish");
        return java.util.Arrays.asList(holderErr.get(), otherErr.get());
    }

    static int status(Throwable t) {
        assertInstanceOf(DomainException.class, t, () -> "expected a domain refusal, got " + t);
        return ((DomainException) t).status.value();
    }

    @Test
    void cancellationCommittedFirstMakesTheWaitingAcceptanceFail() throws Exception {
        var b = confirmed();
        var blocked = new AtomicBoolean();
        var errors = race(holding -> tx.execute(s -> {
            rental.apply(user, b.id(), cancel(b.version()));
            holding.run();
            blocked.set(otherRequestBlocked());
            return null;
        }), () -> rental.acceptContract(user, b.id()));
        assertNull(errors.get(0), () -> "cancellation: " + errors.get(0));
        assertNotNull(errors.get(1), "the acceptance must not succeed on a booking cancelled before it");
        assertEquals(409, status(errors.get(1)));
        assertTrue(blocked.get(), "the acceptance waited for the cancellation's booking lock");
        assertEquals("CANCELLED", status(b.id()));
        assertNull(acceptedAt(b.id()), "no acceptance time on the cancelled booking's contract");
    }

    @Test
    void acceptanceCommittedFirstIsKeptAndTheWaitingCancellationFollowsTheUsualRules() throws Exception {
        var b = confirmed();
        var blocked = new AtomicBoolean();
        var errors = race(holding -> tx.execute(s -> {
            rental.acceptContract(user, b.id());
            holding.run();
            blocked.set(otherRequestBlocked());
            return null;
        }), () -> rental.apply(user, b.id(), cancel(b.version())));
        assertNull(errors.get(0), () -> "acceptance: " + errors.get(0));
        assertNull(errors.get(1), () -> "a customer cancellation 3 days ahead is still allowed after accepting: " + errors.get(1));
        assertTrue(blocked.get(), "the cancellation waited for the acceptance's booking lock");
        assertEquals("CANCELLED", status(b.id()));
        assertEquals(Instant.parse("2026-10-23T03:00:00Z"), acceptedAt(b.id()), "the acceptance made before the cancellation stays recorded");
        clock.value = Instant.parse("2026-10-23T05:00:00Z");
        assertEquals(409, status(assertThrows(DomainException.class, () -> rental.acceptContract(user, b.id()))));
        assertEquals(Instant.parse("2026-10-23T03:00:00Z"), acceptedAt(b.id()));
    }

    @Test
    void twoAcceptancesAtOnceKeepTheFirstTime() throws Exception {
        var b = confirmed();
        var blocked = new AtomicBoolean();
        var errors = race(holding -> tx.execute(s -> {
            rental.acceptContract(user, b.id());
            clock.value = Instant.parse("2026-10-23T04:00:00Z");
            holding.run();
            blocked.set(otherRequestBlocked());
            return null;
        }), () -> rental.acceptContract(user, b.id()));
        assertNull(errors.get(0), () -> "first: " + errors.get(0));
        assertNull(errors.get(1), () -> "second press is harmless: " + errors.get(1));
        assertTrue(blocked.get(), "the second acceptance waited for the first");
        assertEquals(Instant.parse("2026-10-23T03:00:00Z"), acceptedAt(b.id()));
        assertEquals("CONFIRMED", status(b.id()));
    }

    @Test
    void handoverWaitingBehindTheAcceptanceSeesItAndProceeds() throws Exception {
        var b = confirmed();
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        var blocked = new AtomicBoolean();
        var errors = race(holding -> tx.execute(s -> {
            rental.acceptContract(user, b.id());
            holding.run();
            blocked.set(otherRequestBlocked());
            return null;
        }), () -> rental.apply(staff, b.id(), TestActions.handover(b.version(), null, "Synthetic handover", true, false)));
        assertNull(errors.get(0), () -> "acceptance: " + errors.get(0));
        assertNull(errors.get(1), () -> "the handover reads the committed acceptance after waiting: " + errors.get(1));
        assertTrue(blocked.get(), "the handover waited for the acceptance's lock");
        assertEquals("IN_PROGRESS", status(b.id()));
        assertEquals(1, jdbc.queryForObject("select count(*) from vehicle_handover_records where booking_id=?", Integer.class, b.id()));
    }
}
