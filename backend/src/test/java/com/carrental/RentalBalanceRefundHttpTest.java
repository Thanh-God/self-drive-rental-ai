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
 * L9 (Q8/Q9, 12/11/2026): a booking cancelled after the remaining rent was recorded owes the whole recorded amount back
 * (REFUND_DUE, whoever cancels); Admin records the DEMO refund once (REFUNDED). A booking whose rent is recorded cannot be
 * recorded as a no-show, and a no-show needs Staff to confirm the customer did not cancel. Bookings without a deposit.
 */
@SpringBootTest(properties = {"app.jwt-secret=rental-balance-refund-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=RentalBalanceRefundOnly123!", "app.deposit-enabled=false", "app.rental-balance-enabled=true",
    "app.payment-reconcile-ms=86400000", "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(RentalBalanceRefundHttpTest.TimeConfig.class)
class RentalBalanceRefundHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("rental-balance-refund-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:rentalbalancerefund;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock rentalBalanceRefundClock() { return new FixtureClock(); } }

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

    Map<String, Object> refund(long amount, String method, String reference, String key, long version) {
        return record(amount, method, reference, key, version);
    }

    Map<String, Object> businessCancel(long version) {
        return Map.of("next", "CANCELLED", "version", version, "reason", "Synthetic: xe hỏng, không giao được",
            "cancellationKind", "BUSINESS", "customerContacted", true);
    }

    long version(String id) { return current(id).version(); }

    JsonNode recordedBooking() throws Exception {
        var b = confirmed();
        var r = call("demo-staff-dn", b.id() + "/rental-balance", record(1300000, "CASH", "PT-0001", "k1", b.version()));
        assertEquals(200, r.status(), String.valueOf(r.body()));
        return r.body();
    }

    @Test
    void businessCancellationAfterTheRecordOwesTheWholeRentAndAdminRecordsTheRefundOnce() throws Exception {
        var rec = recordedBooking();
        String id = rec.path("id").asText();
        assertEquals(200, call("demo-staff-dn", id + "/actions", businessCancel(rec.path("version").asLong())).status());

        var staffView = detail("demo-staff-dn", id).path("rentalBalance");
        assertEquals("REFUND_DUE", staffView.path("status").asText());
        assertEquals(1300000, staffView.path("refund").path("amount").asLong());
        assertEquals("REFUND_DUE", staffView.path("refund").path("status").asText());
        assertEquals(1300000, staffView.path("recorded").path("amount").asLong(), "the money received stays recorded");
        var last = staffView.path("history").get(staffView.path("history").size() - 1);
        assertEquals("REFUND_DUE", last.path("kind").asText());
        assertEquals("Đơn bị hủy: Synthetic: xe hỏng, không giao được", last.path("reason").asText());
        var userView = detail("demo-user", id).path("rentalBalance");
        assertEquals("REFUND_DUE", userView.path("status").asText());
        assertEquals(1300000, userView.path("refund").path("amount").asLong());
        assertTrue(userView.path("history").isMissingNode(), "customers do not see the log");

        long v = version(id);
        assertEquals(403, call("demo-staff-dn", id + "/rental-balance/refund", refund(1300000, "CASH", null, "f1", v)).status(), "Staff cannot record the refund");
        assertEquals(403, call("demo-user", id + "/rental-balance/refund", refund(1300000, "CASH", null, "f1", v)).status());
        assertEquals(409, call("demo-admin", id + "/rental-balance/refund", refund(1000000, "CASH", null, "f1", v)).status(), "only the whole recorded amount");
        assertEquals(400, call("demo-admin", id + "/rental-balance/refund", refund(1300000, "BANK_TRANSFER", null, "f1", v)).status(), "bank transfer needs a reference");
        var unconfirmed = new java.util.LinkedHashMap<>(refund(1300000, "CASH", null, "f1", v));
        unconfirmed.put("confirmed", false);
        assertEquals(400, call("demo-admin", id + "/rental-balance/refund", unconfirmed).status());
        assertEquals(409, call("demo-admin", id + "/rental-balance/refund", refund(1300000, "CASH", null, "f1", v + 1)).status(), "stale version");
        assertEquals("REFUND_DUE", detail("demo-admin", id).path("rentalBalance").path("status").asText(), "refused attempts change nothing");

        clock.value = Instant.parse("2026-10-24T03:00:00Z");
        var done = call("demo-admin", id + "/rental-balance/refund", refund(1300000, "BANK_TRANSFER", "HT-0001", "f1", v));
        assertEquals(200, done.status(), String.valueOf(done.body()));
        var refunded = done.body().path("rentalBalance");
        assertEquals("REFUNDED", refunded.path("status").asText());
        assertEquals("BANK_TRANSFER", refunded.path("refund").path("method").asText());
        assertEquals("HT-0001", refunded.path("refund").path("reference").asText());
        assertEquals(Instant.parse("2026-10-24T03:00:00Z"), Instant.parse(refunded.path("refund").path("refundedAt").asText()));
        int entries = refunded.path("history").size();
        assertEquals("REFUNDED", refunded.path("history").get(entries - 1).path("kind").asText());

        assertEquals(200, call("demo-admin", id + "/rental-balance/refund", refund(1300000, "BANK_TRANSFER", "HT-0001", "f1", v)).status(), "same key replays");
        assertEquals(entries, detail("demo-admin", id).path("rentalBalance").path("history").size());
        assertEquals(409, call("demo-admin", id + "/rental-balance/refund", refund(1300000, "BANK_TRANSFER", "HT-0002", "f1", version(id))).status(), "same key, other content");
        assertEquals(409, call("demo-admin", id + "/rental-balance/refund", refund(1300000, "CASH", null, "f2", version(id))).status(), "refunded once");
        assertEquals(409, call("demo-admin", id + "/rental-balance/reverse", Map.of("reason", "Sau hủy", "idempotencyKey", "r1", "expectedVersion", version(id), "confirmed", true)).status(),
            "a correct record is refunded, not reversed");
        assertEquals("REFUNDED", detail("demo-user", id).path("rentalBalance").path("status").asText());
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_refunds", Integer.class), "the rent never enters the deposit ledger");
    }

    @Test
    void customerCancellationAfterTheRecordAlsoOwesTheRentBack() throws Exception {
        var rec = recordedBooking();
        String id = rec.path("id").asText();
        assertEquals(409, call("demo-admin", id + "/rental-balance/refund", refund(1300000, "CASH", null, "f0", version(id))).status(), "nothing to refund while confirmed");
        assertEquals(200, call("demo-user", id + "/actions", Map.of("next", "CANCELLED", "version", version(id), "reason", "Synthetic: đổi kế hoạch")).status());
        var view = detail("demo-user", id).path("rentalBalance");
        assertEquals("REFUND_DUE", view.path("status").asText());
        assertEquals(1300000, view.path("refund").path("amount").asLong());
    }

    @Test
    void cancellingWithoutARecordOwesNothing() throws Exception {
        var b = confirmed();
        assertEquals(200, call("demo-staff-dn", b.id() + "/actions", businessCancel(b.version())).status());
        var view = detail("demo-staff-dn", b.id()).path("rentalBalance");
        assertNotEquals("REFUND_DUE", view.path("status").asText());
        assertTrue(view.path("refund").isMissingNode() || view.path("refund").isNull());
        assertEquals(409, call("demo-admin", b.id() + "/rental-balance/refund", refund(1300000, "CASH", null, "f1", version(b.id()))).status());
    }

    @Test
    void aBookingWhoseRentIsRecordedIsNotANoShowAndANoShowNeedsTheCustomerNotToHaveCancelled() throws Exception {
        var rec = recordedBooking();
        String id = rec.path("id").asText();
        clock.value = Instant.parse("2026-10-27T03:00:00Z");
        var refused = call("demo-staff-dn", id + "/no-show", Map.of("expectedVersion", version(id), "contacted", true, "customerDidNotCancel", true,
            "notDelivered", true, "reason", "Synthetic: gọi 2 lần qua điện thoại lúc 18:00"));
        assertEquals(409, refused.status());
        assertTrue(refused.body().path("message").asText().contains("khách đã thanh toán tại chi nhánh"), refused.body().toString());
        assertEquals("CONFIRMED", current(id).status());
        assertEquals("RECORDED", current(id).rentalBalance().status());

        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var other = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 11, 2), LocalDate.of(2026, 11, 4)));
        rental.apply(staff, other.id(), new BookingService.Action("CONFIRMED", other.version(), null, null, false, false));
        clock.value = Instant.parse("2026-11-03T03:00:00Z");
        var body = new java.util.HashMap<String, Object>(Map.of("expectedVersion", version(other.id()), "contacted", true, "notDelivered", true,
            "reason", "Synthetic: gọi 2 lần qua điện thoại lúc 18:00"));
        assertEquals(400, call("demo-staff-dn", other.id() + "/no-show", body).status(), "the customer-did-not-cancel confirmation is required");
        body.put("customerDidNotCancel", true);
        assertEquals(200, call("demo-staff-dn", other.id() + "/no-show", body).status());
        assertEquals("Khách không đến nhận, không báo hủy trước khi hết ngày nhận: Synthetic: gọi 2 lần qua điện thoại lúc 18:00",
            jdbc.queryForObject("select reason from booking_status_history where booking_id=? and next_status='CANCELLED'", String.class, other.id()));
        assertNotEquals("REFUND_DUE", current(other.id()).rentalBalance().status(), "nothing was recorded, nothing is owed");
    }
}
