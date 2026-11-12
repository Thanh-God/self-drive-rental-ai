package com.carrental;

import com.carrental.exception.DomainException;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.booking.service.DepositPolicy;
import com.carrental.modules.booking.service.RentalBalanceService;
import com.carrental.modules.contract.service.ContractService;
import com.carrental.modules.operation.service.DepositWorkflow;
import com.carrental.modules.operation.service.RentalWorkflow;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
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
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.*;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * R9 (12/11/2026): the decided rules together on one QR booking — deposit policy v2 (L6), remaining rent recorded before handover (L4),
 * the customer's "Đồng ý" (L8) and fuel/km readings (L5). Each gate refuses on its own and rolls the handover back; legacy bookings
 * and contracts keep their stored rules, and turning a flag off later does not change what a booking already stored.
 */
@SpringBootTest(properties = {"app.jwt-secret=contract-rental-balance-flow-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=ContractRentalBalanceFlow123!", "app.deposit-enabled=true", "app.deposit-method=DEMO_QR_MANUAL",
    "app.rental-balance-enabled=true", "app.contract-acceptance-enabled=true", "app.payment-reconcile-ms=86400000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(ContractRentalBalanceFlowHttpTest.TimeConfig.class)
class ContractRentalBalanceFlowHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("contract-rental-balance-flow-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:contractrentalbalanceflow;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock contractRentalBalanceFlowClock() { return new FixtureClock(); } }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired DepositWorkflow deposits;
    @Autowired RentalWorkflow rental;
    @Autowired ContractService contracts;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    final ObjectMapper json = new ObjectMapper();
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");
    final Actor admin = new Actor("demo-admin", "ADMIN", "Synthetic");

    @BeforeEach
    void setup() {
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        flags(true, true);
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-COMBINED-FLOW", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    @AfterEach
    void restoreFlags() { flags(true, true); }

    /** Turns the two booking-time flags on/off in the running context (values are read only when a booking or contract is created). */
    void flags(boolean rentalBalance, boolean acceptance) {
        ReflectionTestUtils.setField((Object) AopTestUtils.getTargetObject(bookings), "rentalBalanceEnabled", rentalBalance);
        ReflectionTestUtils.setField((Object) AopTestUtils.getTargetObject(contracts), "acceptanceEnabled", acceptance);
    }

    /** QR booking 26/10 → 28/10 (1.300.000 đ), deposit 390.000 đ verified by pickup Staff, so it is CONFIRMED with a contract. */
    BookingService.View confirmedQr() throws Exception {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        deposits.approve(staff, b.id(), b.version());
        var body = new LinkedHashMap<String, Object>(Map.of("transactionRef", "QR-" + b.id().substring(0, 8), "amountVnd", 390000,
            "transferTime", clock.instant().toString(), "transferNote", BookingService.requestCode(b.id()), "sourceAccount", "DEMO-PAYER",
            "idempotencyKey", "verify-" + b.id(), "expectedVersion", current(b.id()).version(), "verified", true));
        var r = mvc.perform(post("/api/v1/bookings/" + b.id() + "/deposit/verify").header("Authorization", "Bearer " + tokens.issue(accounts.require(staff.id())))
            .contentType("application/json").content(json.writeValueAsString(body))).andReturn().getResponse();
        assertEquals(200, r.getStatus(), r.getContentAsString());
        var c = current(b.id());
        assertEquals("CONFIRMED", c.status());
        return c;
    }

    BookingService.View current(String id) { return bookings.view(bookings.require(user, id)); }

    RentalBalanceService.Input record(long amount, String key, long version) {
        return new RentalBalanceService.Input(BigDecimal.valueOf(amount), "CASH", "PT-" + key, key, version, true);
    }

    BookingService.Action handover(long version, Integer fuel, Long km) {
        return new BookingService.Action("IN_PROGRESS", version, null, "Synthetic handover", true, false, null, null, null, fuel, km);
    }

    int handoverRecords(String id) { return jdbc.queryForObject("select count(*) from vehicle_handover_records where booking_id=?", Integer.class, id); }

    int history(String id) { return jdbc.queryForObject("select count(*) from booking_status_history where booking_id=?", Integer.class, id); }

    /** A refused handover leaves the booking, its history and handover records unchanged; returns the refusal. */
    DomainException refusedHandover(String id, BookingService.Action action) {
        var before = current(id);
        int historyBefore = history(id);
        var e = assertThrows(DomainException.class, () -> rental.apply(staff, id, action));
        var after = current(id);
        assertEquals("CONFIRMED", after.status());
        assertEquals(before.version(), after.version(), "rolled back");
        assertEquals(historyBefore, history(id));
        assertEquals(0, handoverRecords(id));
        return e;
    }

    @Test
    void handoverNeedsTheDepositTheRemainingRentTheAcceptanceAndTheReadingsAndThenSavesThemAll() throws Exception {
        var b = confirmedQr();
        assertEquals(DepositPolicy.QR_VERSION, jdbc.queryForObject("select deposit_policy from bookings where id=?", String.class, b.id()));
        assertEquals(RentalBalanceService.VERSION, jdbc.queryForObject("select rental_balance_policy from bookings where id=?", String.class, b.id()));
        assertEquals("contract-2026-11-12-v2", jdbc.queryForObject("select terms_version from contracts where booking_id=?", String.class, b.id()));
        var snapshot = json.readTree(jdbc.queryForObject("select snapshot from contracts where booking_id=?", String.class, b.id()));
        assertEquals(910000, snapshot.path("remainingRent").asLong());
        assertTrue(snapshot.at("/articles/1/clauses").toString().contains("Phần tiền thuê còn lại 910.000 đ được thanh toán tại chi nhánh nhận trước khi bàn giao xe"));

        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        // 1) deposit paid, but neither the remaining rent nor the acceptance.
        var e1 = refusedHandover(b.id(), handover(b.version(), 6, 12000L));
        assertEquals(400, e1.status.value());
        assertTrue(e1.getMessage().contains("910000"), e1.getMessage());

        // 2) remaining rent recorded, contract not accepted.
        var recorded = bookings.recordRentalBalance(staff, b.id(), record(910000, "k1", b.version()));
        assertEquals("RECORDED", recorded.rentalBalance().status());
        var e2 = refusedHandover(b.id(), handover(recorded.version(), 6, 12000L));
        assertEquals(409, e2.status.value());
        assertEquals("Khách chưa bấm Đồng ý hợp đồng trên hệ thống; chưa thể bàn giao xe.", e2.getMessage());

        // 6) nobody but the booking's customer accepts.
        for (var other : List.of(staff, admin))
            assertEquals(403, assertThrows(DomainException.class, () -> rental.acceptContract(other, b.id())).status.value());
        rental.acceptContract(user, b.id());
        var acceptedAt = jdbc.queryForObject("select accepted_at from contracts where booking_id=?", java.sql.Timestamp.class, b.id());
        assertNotNull(acceptedAt);

        // 3) accepted, but the record is reversed (Admin) so the remaining rent is missing again.
        var reversed = bookings.reverseRentalBalance(admin, b.id(), new RentalBalanceService.ReverseInput("Ghi nhầm người thu", "r1", recorded.version(), true));
        assertEquals("DUE", reversed.rentalBalance().status());
        assertEquals(400, refusedHandover(b.id(), handover(reversed.version(), 6, 12000L)).status.value());
        var again = bookings.recordRentalBalance(staff, b.id(), record(910000, "k2", reversed.version()));

        // 4) everything else ready, readings missing or out of range.
        assertEquals(400, refusedHandover(b.id(), handover(again.version(), null, 12000L)).status.value());
        assertEquals(400, refusedHandover(b.id(), handover(again.version(), 6, null)).status.value());
        assertEquals(400, refusedHandover(b.id(), handover(again.version(), 9, 12000L)).status.value());

        // 5) all gates met.
        int historyBefore = history(b.id());
        rental.apply(staff, b.id(), handover(again.version(), 6, 12000L));
        var started = current(b.id());
        assertEquals("IN_PROGRESS", started.status());
        assertEquals(historyBefore + 1, history(b.id()));
        var row = jdbc.queryForMap("select kind,branch_id,fuel_level,odometer_km,license_snapshot from vehicle_handover_records where booking_id=?", b.id());
        assertEquals("HANDOVER", row.get("kind"));
        assertEquals("dn", row.get("branch_id"));
        assertEquals(6, ((Number) row.get("fuel_level")).intValue());
        assertEquals(12000L, ((Number) row.get("odometer_km")).longValue());
        assertNotNull(row.get("license_snapshot"));
        assertEquals(acceptedAt, jdbc.queryForObject("select accepted_at from contracts where booking_id=?", java.sql.Timestamp.class, b.id()));
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_transactions where booking_id=? and amount=910000", Integer.class, b.id()),
            "the remaining rent never enters the deposit ledger");
        // 7) acceptance after handover is refused and keeps the first time.
        assertEquals(409, assertThrows(DomainException.class, () -> rental.acceptContract(user, b.id())).status.value());
        assertEquals(acceptedAt, jdbc.queryForObject("select accepted_at from contracts where booking_id=?", java.sql.Timestamp.class, b.id()));

        // 8) a reversal after handover blocks completion until Staff records again.
        var afterHandoverReverse = bookings.reverseRentalBalance(admin, b.id(), new RentalBalanceService.ReverseInput("Sai số phiếu thu", "r2", started.version(), true));
        clock.value = Instant.parse("2026-10-28T03:00:00Z");
        assertEquals(400, assertThrows(DomainException.class, () -> rental.apply(staff, b.id(), returned(afterHandoverReverse.version(), 11999L))).status.value(),
            "return km below the handover km");
        rental.apply(staff, b.id(), returned(afterHandoverReverse.version(), 12150L));
        var back = current(b.id());
        assertEquals("RETURNED", back.status());
        var blocked = assertThrows(DomainException.class, () -> rental.apply(staff, b.id(), new BookingService.Action("COMPLETED", back.version(), null, null, false, false)));
        assertEquals(409, blocked.status.value());
        assertEquals(0, jdbc.queryForObject("select count(*) from invoices where booking_id=?", Integer.class, b.id()));
        var recordedAgain = bookings.recordRentalBalance(staff, b.id(), record(910000, "k3", back.version()));
        rental.apply(staff, b.id(), new BookingService.Action("COMPLETED", recordedAgain.version(), null, null, false, false));
        assertEquals("COMPLETED", current(b.id()).status());
        var invoice = json.readTree(jdbc.queryForObject("select snapshot from invoices where booking_id=?", String.class, b.id()));
        assertEquals(910000, invoice.path("rentalBalance").path("amount").asLong());
        assertEquals("PT-k3", invoice.path("rentalBalance").path("reference").asText());
    }

    BookingService.Action returned(long version, long km) {
        return new BookingService.Action("RETURNED", version, null, "Synthetic return", false, false, null, null, null, 5, km);
    }

    @Test
    void legacyBookingsAndContractsKeepTheirStoredRules() throws Exception {
        var b = confirmedQr();
        // A booking and contract as stored before L4/L6/L8: no remaining-rent policy, QR policy v1, L7 terms.
        jdbc.update("update bookings set rental_balance_policy=null, deposit_policy=? where id=?", DepositPolicy.QR_VERSION_V1, b.id());
        jdbc.update("update contracts set terms_version='contract-2026-11-12' where booking_id=?", b.id());
        var legacy = current(b.id());
        assertNull(legacy.rentalBalance(), "no remaining-rent tracking: nothing is inferred as paid or due");
        assertEquals(409, assertThrows(DomainException.class, () -> rental.acceptContract(user, b.id())).status.value(), "no acceptance step");
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        assertEquals(400, refusedHandover(b.id(), handover(legacy.version(), null, null)).status.value(), "readings are required at every new handover");
        rental.apply(staff, b.id(), handover(legacy.version(), 6, 12000L));
        assertEquals("IN_PROGRESS", current(b.id()).status());
        assertNull(jdbc.queryForObject("select accepted_at from contracts where booking_id=?", Object.class, b.id()));
        assertNull(jdbc.queryForObject("select rental_balance_log from bookings where id=?", String.class, b.id()));
    }

    @Test
    void turningTheFlagsOffLaterKeepsWhatABookingAlreadyStored() throws Exception {
        var stored = confirmedQr();
        flags(false, false);
        var storedView = current(stored.id());
        assertEquals(RentalBalanceService.VERSION, jdbc.queryForObject("select rental_balance_policy from bookings where id=?", String.class, stored.id()));
        assertEquals("contract-2026-11-12-v2", jdbc.queryForObject("select terms_version from contracts where booking_id=?", String.class, stored.id()));
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        assertEquals(400, refusedHandover(stored.id(), handover(storedView.version(), 6, 12000L)).status.value(), "the stored remaining-rent rule still applies");
        var recorded = bookings.recordRentalBalance(staff, stored.id(), record(910000, "f1", storedView.version()));
        assertEquals(409, refusedHandover(stored.id(), handover(recorded.version(), 6, 12000L)).status.value(), "a v2 contract still needs the customer's acceptance");
        rental.acceptContract(user, stored.id());
        rental.apply(staff, stored.id(), handover(recorded.version(), 6, 12000L));
        assertEquals("IN_PROGRESS", current(stored.id()).status());

        // A booking created while the flags are off stores neither rule.
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var fresh = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 4)));
        assertNull(jdbc.queryForObject("select rental_balance_policy from bookings where id=?", String.class, fresh.id()));
    }
}
