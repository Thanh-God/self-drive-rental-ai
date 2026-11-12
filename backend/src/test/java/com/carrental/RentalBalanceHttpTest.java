package com.carrental;

import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.operation.service.RentalWorkflow;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * L4 (Q1/Q2): with app.rental-balance-enabled on, pickup-branch Staff must record the remaining rent once before
 * handover; Admin reverses a wrong record with a reason and Staff records it again. Bookings without a deposit, so the
 * remaining rent is the whole total. DEMO record only.
 */
@SpringBootTest(properties = {"app.jwt-secret=rental-balance-test-only-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=RentalBalanceTestOnly123!", "app.deposit-enabled=false", "app.rental-balance-enabled=true",
    "app.payment-reconcile-ms=86400000", "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(RentalBalanceHttpTest.TimeConfig.class)
class RentalBalanceHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("rental-balance-synthetic-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:rentalbalance;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock rentalBalanceClock() { return new FixtureClock(); } }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired RentalWorkflow rental;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");

    record Reply(int status, JsonNode body) {}

    @BeforeEach
    void setup() {
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-BALANCE-NOT-REAL", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    BookingService.View confirmed() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        rental.apply(staff, b.id(), new BookingService.Action("CONFIRMED", b.version(), null, null, false, false));
        return current(b.id());
    }

    BookingService.View current(String id) {
        return bookings.list(user).stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow();
    }

    String bearer(String actorId) { return "Bearer " + tokens.issue(accounts.require(actorId)); }

    Reply call(String actorId, String path, Object body) throws Exception {
        var response = mvc.perform(post("/api/v1/bookings/" + path).header("Authorization", bearer(actorId))
            .contentType("application/json").content(json.writeValueAsString(body))).andReturn().getResponse();
        byte[] content = response.getContentAsByteArray();
        return new Reply(response.getStatus(), content.length == 0 ? null : json.readTree(content));
    }

    JsonNode detail(String actorId, String id) throws Exception {
        return json.readTree(mvc.perform(get("/api/v1/bookings/" + id).header("Authorization", bearer(actorId)))
            .andReturn().getResponse().getContentAsByteArray()).path("booking");
    }

    Map<String, Object> record(long amount, String method, String reference, String key, long version) {
        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("amountVnd", amount); body.put("method", method); body.put("reference", reference);
        body.put("idempotencyKey", key); body.put("expectedVersion", version); body.put("confirmed", true);
        return body;
    }

    Reply handover(String id, long version) throws Exception {
        return call("demo-staff-dn", id + "/actions", Map.of("next", "IN_PROGRESS", "version", version, "condition", "Synthetic handover", "licenseChecked", true, "fuelLevel", 6, "odometerKm", 12000));
    }

    @Test
    void handoverWaitsForTheOneTimeRecordAndOnlyPickupStaffMayRecordTheExactRemainder() throws Exception {
        var b = confirmed();
        assertEquals("rental-balance-v1", b.rentalBalance().policy());
        assertEquals(1300000, b.rentalBalance().dueAmount(), "no deposit: the whole total remains");
        assertEquals("DUE", b.rentalBalance().status());
        assertTrue(b.rentalBalance().demo());

        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        var refused = handover(b.id(), b.version());
        assertEquals(400, refused.status());
        assertTrue(refused.body().path("message").asText().contains("phần tiền thuê còn lại (1300000 đ)"), refused.body().toString());
        assertEquals("CONFIRMED", current(b.id()).status());

        assertEquals(403, call("demo-staff-hn", b.id() + "/rental-balance", record(1300000, "CASH", null, "k-hn", b.version())).status());
        assertEquals(403, call("demo-admin", b.id() + "/rental-balance", record(1300000, "CASH", null, "k-admin", b.version())).status());
        assertEquals(403, call("demo-user", b.id() + "/rental-balance", record(1300000, "CASH", null, "k-user", b.version())).status());
        assertEquals(409, call("demo-staff-dn", b.id() + "/rental-balance", record(1299999, "CASH", null, "k1", b.version())).status(), "partial amount");
        assertEquals(409, call("demo-staff-dn", b.id() + "/rental-balance", record(1300001, "CASH", null, "k1", b.version())).status(), "excess amount");
        assertEquals(400, call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "BANK_TRANSFER", null, "k1", b.version())).status(), "transfer needs a reference");
        assertEquals(400, call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CARD", null, "k1", b.version())).status());
        assertEquals(400, call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CASH", " PT-1", "k1", b.version())).status(), "padded reference");
        var unconfirmed = record(1300000, "CASH", null, "k1", b.version()); unconfirmed.put("confirmed", false);
        assertEquals(400, call("demo-staff-dn", b.id() + "/rental-balance", unconfirmed).status());
        var decimal = record(1300000, "CASH", null, "k1", b.version()); decimal.put("amountVnd", 1300000.5);
        assertEquals(400, call("demo-staff-dn", b.id() + "/rental-balance", decimal).status());
        assertEquals(409, call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CASH", null, "k1", b.version() + 1)).status(), "stale version");
        assertNull(jdbc.queryForObject("select rental_balance_amount from bookings where id=?", Long.class, b.id()), "no partial write");

        var ok = call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CASH", null, "k1", b.version()));
        assertEquals(200, ok.status(), String.valueOf(ok.body()));
        assertEquals("RECORDED", ok.body().path("rentalBalance").path("status").asText());
        assertEquals(1300000, ok.body().path("rentalBalance").path("recorded").path("amount").asLong());
        assertEquals("CASH", ok.body().path("rentalBalance").path("recorded").path("method").asText());
        long recordedVersion = ok.body().path("version").asLong();
        assertTrue(recordedVersion > b.version(), "recording bumps the booking version");

        var replay = call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CASH", null, "k1", b.version()));
        assertEquals(200, replay.status(), "same key and content returns the stored result");
        assertEquals(recordedVersion, replay.body().path("version").asLong());
        assertEquals(409, call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "BANK_TRANSFER", "CK-1", "k1", recordedVersion)).status(), "same key, other content");
        assertEquals(409, call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CASH", null, "k2", recordedVersion)).status(), "only one record");
        assertEquals(1, json.readTree(jdbc.queryForObject("select rental_balance_log from bookings where id=?", String.class, b.id())).size());

        var renter = detail("demo-user", b.id()).path("rentalBalance");
        assertEquals("RECORDED", renter.path("status").asText());
        assertEquals(1300000, renter.path("recorded").path("amount").asLong());
        assertTrue(renter.path("recordedByName").isMissingNode() && renter.path("history").isMissingNode(), "renter gets no staff identity or log: " + renter);
        var staffView = detail("demo-staff-dn", b.id()).path("rentalBalance");
        assertEquals("Staff Đà Nẵng", staffView.path("recordedByName").asText());
        assertEquals("RECORDED", staffView.path("history").get(0).path("kind").asText());
        assertTrue(staffView.path("history").get(0).path("actorId").isMissingNode(), "no internal ids in the log view");

        var handed = handover(b.id(), recordedVersion);
        assertEquals(200, handed.status(), String.valueOf(handed.body()));
        assertEquals("IN_PROGRESS", current(b.id()).status());
    }

    @Test
    void adminReversesWithAReasonStaffRecordsAgainAndCompletionWaitsForTheNewRecord() throws Exception {
        var b = confirmed();
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        var first = call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "BANK_TRANSFER", "CK-0001", "k1", b.version()));
        assertEquals(200, first.status());
        long v = first.body().path("version").asLong();
        assertEquals(200, handover(b.id(), v).status());
        v = current(b.id()).version();

        var noReason = Map.of("reason", "", "idempotencyKey", "r1", "expectedVersion", v, "confirmed", true);
        assertEquals(400, call("demo-admin", b.id() + "/rental-balance/reverse", noReason).status());
        var reverse = Map.of("reason", "Nhập nhầm mã chuyển khoản", "idempotencyKey", "r1", "expectedVersion", v, "confirmed", true);
        assertEquals(403, call("demo-staff-dn", b.id() + "/rental-balance/reverse", reverse).status(), "Staff cannot reverse");
        assertEquals(403, call("demo-user", b.id() + "/rental-balance/reverse", reverse).status());
        var reversed = call("demo-admin", b.id() + "/rental-balance/reverse", reverse);
        assertEquals(200, reversed.status(), String.valueOf(reversed.body()));
        assertEquals("DUE", reversed.body().path("rentalBalance").path("status").asText());
        assertTrue(reversed.body().path("rentalBalance").path("recorded").isNull());
        var history = reversed.body().path("rentalBalance").path("history");
        assertEquals(2, history.size());
        assertEquals("REVERSED", history.get(1).path("kind").asText());
        assertEquals("CK-0001", history.get(1).path("reference").asText(), "the reversed record is kept in the log");
        assertEquals("Nhập nhầm mã chuyển khoản", history.get(1).path("reason").asText());
        assertEquals("Admin mẫu", history.get(1).path("actorName").asText());
        assertEquals(200, call("demo-admin", b.id() + "/rental-balance/reverse", reverse).status(), "same reversal key replays");
        long afterReverse = current(b.id()).version();
        assertEquals(409, call("demo-admin", b.id() + "/rental-balance/reverse",
            Map.of("reason", "Lần hai", "idempotencyKey", "r2", "expectedVersion", afterReverse, "confirmed", true)).status(), "nothing left to reverse");

        clock.value = Instant.parse("2026-10-28T03:00:00Z");
        assertEquals(200, call("demo-staff-dn", b.id() + "/actions", Map.of("next", "RETURNED", "version", afterReverse, "condition", "Synthetic return", "fuelLevel", 5, "odometerKm", 12150)).status());
        long returned = current(b.id()).version();
        var blocked = call("demo-staff-dn", b.id() + "/actions", Map.of("next", "COMPLETED", "version", returned));
        assertEquals(409, blocked.status(), "completion waits for a new record");
        assertEquals(0, jdbc.queryForObject("select count(*) from invoices where booking_id=?", Integer.class, b.id()));

        var again = call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "BANK_TRANSFER", "CK-0002", "k3", returned));
        assertEquals(200, again.status(), String.valueOf(again.body()));
        assertEquals(3, again.body().path("rentalBalance").path("history").size());
        long recorded = again.body().path("version").asLong();
        assertEquals(200, call("demo-staff-dn", b.id() + "/actions", Map.of("next", "COMPLETED", "version", recorded)).status());

        var snapshot = json.readTree(jdbc.queryForObject("select snapshot from invoices where booking_id=?", String.class, b.id())).path("rentalBalance");
        assertEquals(1300000, snapshot.path("amount").asLong());
        assertEquals("BANK_TRANSFER", snapshot.path("method").asText());
        assertEquals("CK-0002", snapshot.path("reference").asText());
        assertTrue(snapshot.path("note").asText().contains("không chứng minh đã nhận tiền thật"));
        long completed = current(b.id()).version();
        assertEquals(409, call("demo-admin", b.id() + "/rental-balance/reverse",
            Map.of("reason", "Sau hoàn tất", "idempotencyKey", "r9", "expectedVersion", completed, "confirmed", true)).status(), "no reversal after completion");
    }

    @Test
    void cancelledOrPendingBookingsCannotBeRecorded() throws Exception {
        var pending = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        assertEquals(409, call("demo-staff-dn", pending.id() + "/rental-balance", record(1300000, "CASH", null, "p1", pending.version())).status());
        rental.apply(staff, pending.id(), new BookingService.Action("REJECTED", pending.version(), "Synthetic rejection", null, false, false));
        assertEquals(409, call("demo-staff-dn", pending.id() + "/rental-balance", record(1300000, "CASH", null, "p2", current(pending.id()).version())).status());
        assertNull(jdbc.queryForObject("select rental_balance_log from bookings where id=?", String.class, pending.id()));
    }
}
