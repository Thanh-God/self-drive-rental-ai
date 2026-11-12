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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** L8 (12/11/2026): the customer presses "Đồng ý" on the contract and Staff cannot hand over before it. */
@SpringBootTest(properties = {"app.jwt-secret=contract-acceptance-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=ContractAcceptanceTestOnly123!", "app.deposit-enabled=false", "app.payment-reconcile-ms=86400000",
    "app.contract-acceptance-enabled=true", "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(ContractAcceptanceHttpTest.TimeConfig.class)
class ContractAcceptanceHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("contract-acceptance-synthetic-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:contractacceptance;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock contractAcceptanceClock() { return new FixtureClock(); } }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired FixtureClock clock;
    @Autowired LicenseService licenses;
    @Autowired BookingService bookings;
    @Autowired RentalWorkflow rental;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    final ObjectMapper json = new ObjectMapper();
    final Actor user = new Actor("demo-user", "USER", "Synthetic");
    final Actor staff = new Actor("demo-staff-dn", "STAFF", "Synthetic");
    JsonNode lastBody;

    @BeforeEach
    void setup() {
        CancelBoundaryTest.verifySafeIsolatedDatabase(jdbc);
        for (String t : List.of("payment_events", "payment_refunds", "payment_transactions", "reviews", "incident_events", "incident_cases",
            "vehicle_handover_records", "invoice_items", "invoices", "contracts", "booking_status_history", "bookings"))
            jdbc.update("delete from " + t);
        jdbc.update("update vehicles set current_branch_id='dn',status='ACTIVE' where id='v1'");
        clock.value = Instant.parse("2026-10-23T03:00:00Z");
        var old = licenses.mine(user);
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-ACCEPTANCE-NOT-REAL", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
            "PENDING", old == null ? 0 : old.version()));
        LicensePhotoFixture.approved(licenses, user);
    }

    /** Same-branch booking without a deposit (26/10 → 28/10, Vietnam days), confirmed by pickup Staff. */
    BookingService.View confirmed() {
        var b = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        rental.apply(staff, b.id(), new BookingService.Action("CONFIRMED", b.version(), null, null, false, false));
        return current(b.id());
    }

    BookingService.View current(String id) { return bookings.view(bookings.require(user, id)); }

    String bearer(String actorId) { return "Bearer " + tokens.issue(accounts.require(actorId)); }

    int accept(String actorId, String id) throws Exception {
        var r = mvc.perform(post("/api/v1/bookings/" + id + "/contract/accept").header("Authorization", bearer(actorId))).andReturn().getResponse();
        lastBody = r.getContentAsByteArray().length == 0 ? null : json.readTree(r.getContentAsByteArray());
        return r.getStatus();
    }

    int handover(String id, long version) throws Exception {
        var body = new HashMap<String, Object>(Map.of("next", "IN_PROGRESS", "version", version, "condition", "Synthetic handover",
            "licenseChecked", true, "fuelLevel", 6, "odometerKm", 12000));
        var r = mvc.perform(post("/api/v1/bookings/" + id + "/actions").header("Authorization", bearer("demo-staff-dn"))
            .contentType("application/json").content(json.writeValueAsString(body))).andReturn().getResponse();
        lastBody = r.getContentAsByteArray().length == 0 ? null : json.readTree(r.getContentAsByteArray());
        return r.getStatus();
    }

    JsonNode contract(String actorId, String id) throws Exception {
        var r = mvc.perform(get("/api/v1/bookings/" + id + "/contract").header("Authorization", bearer(actorId))).andReturn().getResponse();
        assertEquals(200, r.getStatus(), r.getContentAsString());
        return json.readTree(r.getContentAsString()).get(0);
    }

    Object acceptedAt(String id) { return jdbc.queryForObject("select accepted_at from contracts where booking_id=?", Object.class, id); }

    int records(String id) { return jdbc.queryForObject("select count(*) from vehicle_handover_records where booking_id=?", Integer.class, id); }

    @Test
    void handoverWaitsForTheCustomersAcceptanceWhichIsRecordedOnce() throws Exception {
        var b = confirmed();
        var row = contract("demo-user", b.id());
        assertEquals("contract-2026-11-12-v2", row.path("terms_version").asText());
        assertTrue(row.path("accepted_at").isNull());
        var article12 = json.readTree(row.path("snapshot").asText()).at("/articles/11/clauses/0").asText();
        assertTrue(article12.contains("có hiệu lực khi Bên thuê bấm \"Đồng ý\""), article12);

        int historyBefore = jdbc.queryForObject("select count(*) from booking_status_history where booking_id=?", Integer.class, b.id());
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        assertEquals(409, handover(b.id(), b.version()));
        assertEquals("Khách chưa bấm Đồng ý hợp đồng trên hệ thống; chưa thể bàn giao xe.", lastBody.path("message").asText());
        assertEquals("CONFIRMED", current(b.id()).status());
        assertEquals(b.version(), current(b.id()).version(), "the refused handover is rolled back");
        assertEquals(0, records(b.id()));
        assertEquals(historyBefore, jdbc.queryForObject("select count(*) from booking_status_history where booking_id=?", Integer.class, b.id()), "no IN_PROGRESS history row");

        assertEquals(200, accept("demo-user", b.id()), String.valueOf(lastBody));
        assertFalse(lastBody.get(0).path("accepted_at").isNull(), "the response carries the acceptance");
        assertEquals(Instant.parse("2026-10-26T03:00:00Z"), jdbc.queryForObject("select accepted_at from contracts where booking_id=?", java.sql.Timestamp.class, b.id()).toInstant());
        var first = acceptedAt(b.id());
        assertNotNull(first);
        clock.value = Instant.parse("2026-10-26T04:00:00Z");
        assertEquals(200, accept("demo-user", b.id()), "pressing again is harmless");
        assertEquals(first, acceptedAt(b.id()), "the first acceptance time is kept");

        assertEquals(200, handover(b.id(), b.version()), String.valueOf(lastBody));
        assertEquals("IN_PROGRESS", current(b.id()).status());
        assertEquals(1, records(b.id()));
        assertEquals(409, accept("demo-user", b.id()), "after handover the booking is no longer confirmed");
        assertEquals(first, acceptedAt(b.id()));
        assertFalse(contract("demo-staff-dn", b.id()).path("accepted_at").isNull(), "Staff read the acceptance");
    }

    @Test
    void onlyTheBookingsCustomerAcceptsAndOnlyWhileConfirmed() throws Exception {
        var pending = bookings.create(user, new BookingService.Input("v1", "dn", "dn", null, null, 1300000L, LocalDate.of(2026, 10, 26), LocalDate.of(2026, 10, 28)));
        assertEquals(409, accept("demo-user", pending.id()), "no contract before confirmation");
        rental.apply(staff, pending.id(), new BookingService.Action("CONFIRMED", pending.version(), null, null, false, false));

        for (String other : List.of("demo-staff-dn", "demo-admin")) {
            assertEquals(403, accept(other, pending.id()), other + " cannot accept for the customer");
            assertNull(acceptedAt(pending.id()));
        }
        assertEquals(404, accept("demo-staff-hn", pending.id()), "outside the route the booking is not visible");
        assertNull(acceptedAt(pending.id()));

        var c = current(pending.id());
        assertEquals(200, mvc.perform(post("/api/v1/bookings/" + c.id() + "/actions").header("Authorization", bearer("demo-user"))
            .contentType("application/json").content(json.writeValueAsString(Map.of("next", "CANCELLED", "version", c.version(), "reason", "Synthetic"))))
            .andReturn().getResponse().getStatus());
        assertEquals(409, accept("demo-user", pending.id()), "a cancelled booking's contract is not accepted");
        assertNull(acceptedAt(pending.id()));
    }

    @Test
    void contractsIssuedBeforeL8NeedNoAcceptance() throws Exception {
        var b = confirmed();
        assertEquals(1, jdbc.update("update contracts set terms_version='contract-2026-11-12' where booking_id=?", b.id()));
        assertEquals(409, accept("demo-user", b.id()));
        assertTrue(lastBody.path("message").asText().contains("không cần bấm đồng ý"), String.valueOf(lastBody));
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        assertEquals(200, handover(b.id(), b.version()), String.valueOf(lastBody));
        assertNull(acceptedAt(b.id()));

        setup();
        var older = confirmed();
        assertEquals(1, jdbc.update("update contracts set terms_version='terms-2026-09-28' where booking_id=?", older.id()));
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        assertEquals(200, handover(older.id(), older.version()), String.valueOf(lastBody));
    }

    @Test
    void productionDefaultTurnsTheAcceptanceStepOn() throws Exception {
        String yml = Files.readString(Path.of("src/main/resources/application.yml"));
        assertTrue(yml.contains("contract-acceptance-enabled: ${CONTRACT_ACCEPTANCE_ENABLED:true}"), "acceptance is on unless explicitly turned off");
    }
}
