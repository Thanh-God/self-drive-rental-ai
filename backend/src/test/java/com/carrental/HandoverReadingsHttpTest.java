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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(properties = {"app.jwt-secret=handover-readings-test-secret-at-least-32-bytes", "app.seed-enabled=true",
    "app.seed-password=ReadingsTestOnly123!", "app.deposit-enabled=false", "app.payment-reconcile-ms=86400000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"})
@AutoConfigureMockMvc
@Import(HandoverReadingsHttpTest.TimeConfig.class)
class HandoverReadingsHttpTest {
    static final Path ROOT;
    static {
        try { ROOT = Files.createTempDirectory("readings-synthetic-photos-"); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null) CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
            System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:readings;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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
    static class TimeConfig { @Bean @Primary FixtureClock readingsClock() { return new FixtureClock(); } }

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
        licenses.save(user, new LicenseService.View(null, "SYNTHETIC-READINGS-NOT-REAL", "VN_2025", "B", LocalDate.of(2035, 12, 31), false,
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

    com.fasterxml.jackson.databind.JsonNode lastBody;

    int act(String actorId, String id, java.util.Map<String, Object> body) throws Exception {
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var response = mvc.perform(post("/api/v1/bookings/" + id + "/actions").header("Authorization", bearer(actorId))
            .contentType("application/json").content(mapper.writeValueAsString(body))).andReturn().getResponse();
        lastBody = response.getContentAsByteArray().length == 0 ? null : mapper.readTree(response.getContentAsByteArray());
        return response.getStatus();
    }

    java.util.Map<String, Object> handover(long version, Object fuel, Object km) {
        var body = new java.util.HashMap<String, Object>(java.util.Map.of("next", "IN_PROGRESS", "version", version, "condition", "Synthetic handover", "licenseChecked", true));
        if (fuel != null) body.put("fuelLevel", fuel);
        if (km != null) body.put("odometerKm", km);
        return body;
    }

    java.util.Map<String, Object> giveBack(long version, Object fuel, Object km) {
        var body = new java.util.HashMap<String, Object>(java.util.Map.of("next", "RETURNED", "version", version, "condition", "Synthetic return"));
        if (fuel != null) body.put("fuelLevel", fuel);
        if (km != null) body.put("odometerKm", km);
        return body;
    }

    java.util.Map<String, Object> row(String id, String kind) {
        return jdbc.queryForMap("select fuel_level,odometer_km from vehicle_handover_records where booking_id=? and kind=?", id, kind);
    }

    @Test
    void handoverRequiresBothReadingsInRangeAndReturnCannotGoBelowTheHandoverOdometer() throws Exception {
        var b = confirmedWithoutDeposit();
        clock.value = Instant.parse("2026-10-26T03:00:00Z");
        long v = b.version();
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, null, null)), "readings are required at handover");
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, 6, null)));
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, null, 12000)));
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, 9, 12000)), "gauge has 8 steps");
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, -1, 12000)));
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, 6, -5)));
        assertEquals(400, act("demo-staff-dn", b.id(), handover(v, 6, 10_000_001L)));
        assertEquals(0, jdbc.queryForObject("select count(*) from vehicle_handover_records where booking_id=?", Integer.class, b.id()));
        assertEquals("CONFIRMED", current(b.id()).status());

        assertEquals(200, act("demo-staff-dn", b.id(), handover(v, 6, 12000)), String.valueOf(lastBody));
        assertEquals(6, ((Number) row(b.id(), "HANDOVER").get("fuel_level")).intValue());
        assertEquals(12000L, ((Number) row(b.id(), "HANDOVER").get("odometer_km")).longValue());
        long active = current(b.id()).version();

        clock.value = Instant.parse("2026-10-28T03:00:00Z");
        assertEquals(400, act("demo-staff-dn", b.id(), giveBack(active, null, null)), "readings required at return after a handover with readings");
        assertEquals(400, act("demo-staff-dn", b.id(), giveBack(active, 5, 11999)), "odometer cannot go backwards");
        assertTrue(lastBody.path("message").asText().contains("12000"), String.valueOf(lastBody));
        assertEquals("IN_PROGRESS", current(b.id()).status());
        assertEquals(200, act("demo-staff-dn", b.id(), giveBack(active, 0, 12000)), "same odometer is allowed (car not driven)");
        assertEquals(0, ((Number) row(b.id(), "RETURN").get("fuel_level")).intValue());
        assertEquals(12000L, ((Number) row(b.id(), "RETURN").get("odometer_km")).longValue());

        var detail = new com.fasterxml.jackson.databind.ObjectMapper().readTree(mvc.perform(get("/api/v1/bookings/" + b.id()).header("Authorization", bearer("demo-user")))
            .andReturn().getResponse().getContentAsByteArray());
        var records = detail.path("records");
        assertEquals(2, records.size());
        assertEquals(6, records.get(0).path("fuel_level").asInt());
        assertEquals(12000, records.get(0).path("odometer_km").asLong());
        assertEquals(0, records.get(1).path("fuel_level").asInt());
    }

    @Test
    void bookingsHandedOverBeforeTheReadingsExistReturnWithOrWithoutThem() throws Exception {
        for (boolean withReadings : new boolean[]{false, true}) {
            setup();
            var b = confirmedWithoutDeposit();
            clock.value = Instant.parse("2026-10-26T03:00:00Z");
            // A handover recorded before V15 has no readings; simulate it directly.
            jdbc.update("update bookings set status='IN_PROGRESS', version=version+1 where id=?", b.id());
            jdbc.update("insert into vehicle_handover_records(id,booking_id,kind,actor_id,branch_id,occurred_at,condition_note,maintenance) values(?,?,'HANDOVER','demo-staff-dn','dn',?,'Before readings',false)",
                java.util.UUID.randomUUID().toString(), b.id(), java.sql.Timestamp.from(clock.instant()));
            long active = current(b.id()).version();
            clock.value = Instant.parse("2026-10-28T03:00:00Z");
            assertEquals(400, act("demo-staff-dn", b.id(), giveBack(active, 4, null)), "half a reading is refused");
            assertEquals(400, act("demo-staff-dn", b.id(), giveBack(active, 12, 500)), "an out-of-range reading is refused");
            if (withReadings) {
                assertEquals(200, act("demo-staff-dn", b.id(), giveBack(active, 4, 500)), String.valueOf(lastBody));
                assertEquals(500L, ((Number) row(b.id(), "RETURN").get("odometer_km")).longValue());
            } else {
                assertEquals(200, act("demo-staff-dn", b.id(), giveBack(active, null, null)), String.valueOf(lastBody));
                assertNull(row(b.id(), "RETURN").get("odometer_km"));
            }
        }
    }
}
