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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

@SpringBootTest(properties = {"app.jwt-secret=business-cancel-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=BusinessCancelTestOnly123!", "app.deposit-enabled=false", "app.payment-reconcile-ms=86400000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(BusinessCancellationHttpTest.TimeConfig.class)
class BusinessCancellationHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("business-cancel-synthetic-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:businesscancel;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock businessCancelClock() { return new FixtureClock(); } }

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
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-BUSINESS-CANCEL-NOT-REAL", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    /** A one-way booking without a deposit (pickup dn, return hn), confirmed by pickup-branch Staff. */
    BookingService.View confirmedOneWay() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "hn", null, null, 2800000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        assertFalse(b.deposit().required(), "fixture must be a booking without a deposit");
        rental.apply(staff, b.id(), new BookingService.Action("CONFIRMED", b.version(), null, null, false, false));
        return current(b.id());
    }

    BookingService.View current(String id) {
        return bookings.list(user).stream().filter(x -> x.id().equals(id)).findFirst().orElseThrow();
    }

    String bearer(String actorId) { return "Bearer " + tokens.issue(accounts.require(actorId)); }

    int cancel(String actorId, String id, long version, String reason, String kind, Boolean contacted) throws Exception {
        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("next", "CANCELLED"); body.put("version", version); body.put("reason", reason);
        if (kind != null) body.put("cancellationKind", kind);
        if (contacted != null) body.put("customerContacted", contacted);
        return mvc.perform(post("/api/v1/bookings/" + id + "/actions").header("Authorization", bearer(actorId))
            .contentType("application/json").content(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body)))
            .andReturn().getResponse().getStatus();
    }

    String kind(String id) { return jdbc.queryForObject("select cancellation_kind from bookings where id=?", String.class, id); }

    @Test
    void businessCancellationNeedsAReasonAContactedCustomerAndThePickupBranch() throws Exception {
        var b = confirmedOneWay();
        assertEquals("CONFIRMED", b.status());
        // 23/10, three days before pickup: the pickup branch learns the car cannot be delivered.
        assertEquals(403, cancel("demo-staff-hn", b.id(), b.version(), "Synthetic: chi nhánh trả không hủy", "BUSINESS", true),
            "the return branch reads the booking but does not cancel it");
        assertEquals(400, cancel("demo-staff-dn", b.id(), b.version(), "Synthetic: xe hỏng", "BUSINESS", false), "contact must be confirmed");
        assertEquals(400, cancel("demo-staff-dn", b.id(), b.version(), "Synthetic: xe hỏng", "BUSINESS", null));
        assertEquals(400, cancel("demo-staff-dn", b.id(), b.version(), "  ", "BUSINESS", true), "a reason is required");
        assertEquals(400, cancel("demo-staff-dn", b.id(), b.version(), "Synthetic", "NO_SHOW", true), "no-show has its own action");
        assertEquals(400, cancel("demo-staff-dn", b.id(), b.version(), "Synthetic", "EARLY_USER", true));
        assertEquals("CONFIRMED", current(b.id()).status());
        assertNull(kind(b.id()));

        assertEquals(200, cancel("demo-staff-dn", b.id(), b.version(), "Synthetic: xe hỏng, đã gọi báo khách", "BUSINESS", true));
        assertEquals("CANCELLED", current(b.id()).status());
        assertEquals("BUSINESS", kind(b.id()));
        assertEquals("Synthetic: xe hỏng, đã gọi báo khách", jdbc.queryForObject(
            "select reason from booking_status_history where booking_id=? and next_status='CANCELLED'", String.class, b.id()));
        assertEquals(0, jdbc.queryForObject("select count(*) from payment_refunds where booking_id=?", Integer.class, b.id()),
            "no deposit, nothing to refund");
    }

    @Test
    void cancellationsWithoutACauseKeepWorkingAndTheCustomerCannotChooseTheCause() throws Exception {
        var staffCancel = confirmedOneWay();
        assertEquals(200, cancel("demo-staff-dn", staffCancel.id(), staffCancel.version(), "Synthetic: khách gọi hủy", null, null));
        assertNull(kind(staffCancel.id()), "a booking without deposit may still be cancelled without a cause");

        setup();
        var own = confirmedOneWay();
        assertEquals(200, cancel("demo-user", own.id(), own.version(), "Synthetic: đổi kế hoạch", "BUSINESS", true));
        assertNull(kind(own.id()), "the customer cannot mark a cancellation as the business's");

        setup();
        var admin = confirmedOneWay();
        assertEquals(400, cancel("demo-admin", admin.id(), admin.version(), "Synthetic", "BUSINESS", false));
        assertEquals(200, cancel("demo-admin", admin.id(), admin.version(), "Synthetic: Admin hủy thay chi nhánh", "BUSINESS", true));
        assertEquals("BUSINESS", kind(admin.id()));

        setup();
        var late = confirmedOneWay();
        clock.value = Instant.parse("2026-10-25T05:00:00Z"); // 12 hours before the pickup day starts in Vietnam
        assertEquals(200, cancel("demo-staff-dn", late.id(), late.version(), "Synthetic: khách xin hủy sát giờ", "LATE_CUSTOMER", null));
        assertEquals("LATE_CUSTOMER", kind(late.id()), "under 24 hours before the pickup day the customer cause stays late");
    }
}
