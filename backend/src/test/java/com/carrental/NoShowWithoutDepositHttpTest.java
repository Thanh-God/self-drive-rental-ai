package com.carrental;

import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.operation.service.RentalWorkflow;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * L2: the Staff no-show action already exists in the backend for every CONFIRMED booking; the desktop now offers it for
 * bookings without a deposit too. This proves that path over HTTP with the deposit flag off: pickup-branch Staff only,
 * only after the pickup day, never after a handover, and no refund rows for a booking that took no money.
 */
@SpringBootTest(properties = {"app.jwt-secret=no-show-test-only-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=NoShowTestOnly123!", "app.deposit-enabled=false", "app.payment-reconcile-ms=86400000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(NoShowWithoutDepositHttpTest.TimeConfig.class)
class NoShowWithoutDepositHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("no-show-synthetic-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:noshow;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
        r.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        r.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("app.license-photo-directory", ROOT::toString);
    }

    static class FixtureClock extends Clock {
        Instant value = Instant.parse("2026-10-23T03:00:00Z");
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId z) { return this; }
        public Instant instant() { return value; }
    }

    @TestConfiguration
    static class TimeConfig { @Bean @Primary FixtureClock noShowClock() { return new FixtureClock(); } }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired RentalWorkflow rental;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");

    @BeforeEach
    void setup() {
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-NO-SHOW-NOT-REAL", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    /** A booking without a deposit, confirmed by pickup-branch Staff (26/10 → 28/10, Vietnam days). */
    BookingService.View confirmedWithoutDeposit() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        assertFalse(b.deposit().required(), "fixture must be a booking without a deposit");
        rental.apply(staff, b.id(), new BookingService.Action("CONFIRMED", b.version(), null, null, false, false));
        return current(b.id());
    }

    BookingService.View current(String id) {
        return bookings.list(user).stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow();
    }

    String bearer(String actorId) { return "Bearer " + tokens.issue(accounts.require(actorId)); }

    int noShow(String actorId, String id, long version, boolean contacted, boolean notDelivered, String reason) throws Exception {
        String body = "{\"expectedVersion\":" + version + ",\"contacted\":" + contacted + ",\"notDelivered\":" + notDelivered
            + ",\"reason\":" + (reason == null ? "null" : "\"" + reason + "\"") + "}";
        return mvc.perform(post("/api/v1/bookings/" + id + "/no-show").header("Authorization", bearer(actorId))
            .contentType("application/json").content(body)).andReturn().getResponse().getStatus();
    }

    @Test
    void pickupStaffRecordsNoShowAfterThePickupDayWithoutCreatingRefunds() throws Exception {
        var b = confirmedWithoutDeposit();
        assertEquals("CONFIRMED", b.status());

        clock.value = Instant.parse("2026-10-26T15:00:00Z"); // 22:00 on the pickup day in Vietnam: still the pickup day
        assertEquals(400, noShow("demo-staff-dn", b.id(), b.version(), true, true, "Synthetic: khách chưa đến"));

        clock.value = Instant.parse("2026-10-27T03:00:00Z"); // the day after pickup
        assertEquals(403, noShow("demo-staff-hn", b.id(), b.version(), true, true, "Synthetic: sai chi nhánh"));
        assertEquals(403, noShow("demo-admin", b.id(), b.version(), true, true, "Synthetic: Admin không xử lý no-show"));
        assertEquals(403, noShow("demo-user", b.id(), b.version(), true, true, "Synthetic: khách không tự ghi no-show"));
        assertEquals(400, noShow("demo-staff-dn", b.id(), b.version(), false, true, "Synthetic: chưa liên hệ"));
        assertEquals(400, noShow("demo-staff-dn", b.id(), b.version(), true, false, "Synthetic: chưa xác nhận chưa giao"));
        assertEquals(400, noShow("demo-staff-dn", b.id(), b.version(), true, true, " "));
        assertEquals(409, noShow("demo-staff-dn", b.id(), b.version() + 1, true, true, "Synthetic: phiên bản cũ"));
        assertEquals("CONFIRMED", current(b.id()).status());

        assertEquals(200, noShow("demo-staff-dn", b.id(), b.version(), true, true, "Synthetic: đã gọi hai lần, khách không đến"));
        assertEquals("CANCELLED", current(b.id()).status());
        assertEquals("NO_SHOW", jdbc.queryForObject("select cancellation_kind from bookings where id=?", String.class, b.id()));
        assertEquals("Khách không đến nhận: Synthetic: đã gọi hai lần, khách không đến", jdbc.queryForObject(
            "select reason from booking_status_history where booking_id=? and next_status='CANCELLED'", String.class, b.id()));
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_refunds", Integer.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_events", Integer.class));
        assertEquals(400, noShow("demo-staff-dn", b.id(), current(b.id()).version(), true, true, "Synthetic: ghi lặp"), "a cancelled booking is not CONFIRMED any more");
        assertEquals(1, jdbc.queryForObject("select count(*) from booking_status_history where booking_id=? and next_status='CANCELLED'", Integer.class, b.id()));
    }

    @Test
    void aHandedOverBookingCannotBecomeANoShow() throws Exception {
        var b = confirmedWithoutDeposit();
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        rental.apply(staff, b.id(), new BookingService.Action("IN_PROGRESS", b.version(), null, "Synthetic handover", true, false));
        var active = current(b.id());
        clock.value = Instant.parse("2026-10-27T03:00:00Z");
        assertEquals(400, noShow("demo-staff-dn", b.id(), active.version(), true, true, "Synthetic: phải bị từ chối"));
        assertEquals("IN_PROGRESS", current(b.id()).status());
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_refunds", Integer.class));
    }
}
