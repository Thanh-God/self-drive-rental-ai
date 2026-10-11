package com.carrental;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.http.*;
import com.carrental.security.TokenService;
import com.carrental.security.Actor;
import com.carrental.modules.vehicle.service.VehicleService;

import java.time.Instant;
import java.time.Duration;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "app.jwt-secret=integration-test-only-secret-at-least-32-bytes",
    "app.token-minutes=30",
    "app.seed-enabled=true",
    "app.seed-password=kdrive_seed_pw_c7_incident_http_20261011",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@Import(IncidentReportHttpServerTest.TimeConfig.class)
public class IncidentReportHttpServerTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate restTemplate;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null && !url.isBlank()) {
            CancelBoundaryTest.verifySafeIsolatedDatabase(url,
                System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
                System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"),
                System.getenv("KDRIVE_TEST_DB_USER"),
                System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        }
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:incidentreporthttp;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
        r.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        r.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
    }

    static class MutableClock extends java.time.Clock {
        Instant value = Instant.parse("2026-10-15T12:00:00Z");
        public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
        public java.time.Clock withZone(java.time.ZoneId z) { return this; }
        public Instant instant() { return value; }
    }

    @TestConfiguration
    static class TimeConfig {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired com.carrental.modules.user.service.AccountService accountService;
    @Autowired MutableClock clock;
    @Autowired VehicleService vehicleService;

    private String userToken;
    private String otherUserToken;
    private String staffHnToken;
    private String staffDnToken;
    private String staffSgnToken;
    private String adminToken;

    @BeforeEach
    void setupTokens() {
        clock.value = Instant.parse("2026-10-15T12:00:00Z");

        ensureUserExists("other-user-http", "Khách khác HTTP", "other.http@example.com", "USER");
        ensureUserExists("demo-staff-sgn-http", "Staff Sài Gòn HTTP", "staff.sgn.http@example.com", "STAFF");
        if (jdbc.queryForObject("select count(*) from branches where id='sgn'", Long.class) == 0) {
            jdbc.update("insert into branches(id, name, address, status, version) values('sgn', 'Sài Gòn · mẫu', 'Điểm mẫu SG', 'ACTIVE', 0)");
        }
        if (jdbc.queryForObject("select count(*) from staff_branches where user_id='demo-staff-sgn-http' and branch_id='sgn'", Long.class) == 0) {
            jdbc.update("insert into staff_branches(user_id, branch_id) values(?, ?)", "demo-staff-sgn-http", "sgn");
        }

        userToken = "Bearer " + tokens.issue(accountService.require("demo-user"));
        otherUserToken = "Bearer " + tokens.issue(accountService.require("other-user-http"));
        staffHnToken = "Bearer " + tokens.issue(accountService.require("demo-staff-hn"));
        staffDnToken = "Bearer " + tokens.issue(accountService.require("demo-staff-dn"));
        staffSgnToken = "Bearer " + tokens.issue(accountService.require("demo-staff-sgn-http"));
        adminToken = "Bearer " + tokens.issue(accountService.require("demo-admin"));
    }

    private void ensureUserExists(String id, String fullName, String email, String role) {
        Long cnt = jdbc.queryForObject("select count(*) from users where id=?", Long.class, id);
        if (cnt == 0) {
            jdbc.update("insert into users(id, full_name, email, phone, password_hash, role, status, token_version, version) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, fullName, email, "0900000000", "pw_dummy", role, "ACTIVE", 0L, 0L);
        }
    }

    private record FixtureContext(String bookingId, String vehicleId, Instant handoverTime, Instant returnTime) {}

    private FixtureContext createBookingFixture(String status, String pickupBranch, String returnBranch, String vehicleCurrentBranch, boolean withHandover, boolean withReturn) {
        String bookingId = "bkh-" + UUID.randomUUID().toString().substring(0, 8);
        String vehicleId = "vehh-" + UUID.randomUUID().toString().substring(0, 8);

        jdbc.update("insert into vehicles(id, name, plate, brand_id, category_id, home_branch_id, current_branch_id, seats, transmission, daily_price, status, description, version) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            vehicleId, "Xe HTTP " + vehicleId, "29A-" + UUID.randomUUID().toString().substring(0, 5).toUpperCase(), "toyota", "sedan", pickupBranch, vehicleCurrentBranch, 5, "AUTO", 1000000L, "ACTIVE", "Mô tả", 0L);

        Instant startAt = clock.value.minus(Duration.ofDays(4));
        Instant endAt = clock.value.minus(Duration.ofDays(1));
        Instant handoverTime = startAt.plus(Duration.ofHours(1));
        Instant returnTime = endAt.minus(Duration.ofHours(1));

        jdbc.update("insert into bookings(id, user_id, vehicle_id, customer_name, vehicle_name, pickup_branch_id, return_branch_id, pickup_name, return_name, actual_return_branch_id, start_at, end_at, expires_at, status, daily_price, rental_days, rental_total, one_way_fee, total, policy_version, version, created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            bookingId, "demo-user", vehicleId, "Khách hàng", "Xe HTTP " + vehicleId, pickupBranch, returnBranch, pickupBranch, returnBranch, null,
            java.sql.Timestamp.from(startAt), java.sql.Timestamp.from(endAt), java.sql.Timestamp.from(startAt), status, 1000000L, 3, 3000000L, 0L, 3000000L, "rental-2026-09-28", 0L, java.sql.Timestamp.from(startAt.minus(Duration.ofDays(1))));

        if (withHandover) {
            jdbc.update("insert into vehicle_handover_records(id, booking_id, kind, actor_id, branch_id, occurred_at, condition_note, maintenance) values(?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), bookingId, "HANDOVER", "demo-staff-hn", pickupBranch, java.sql.Timestamp.from(handoverTime), "Bàn giao xe", false);
        }

        if (withReturn) {
            jdbc.update("insert into vehicle_handover_records(id, booking_id, kind, actor_id, branch_id, occurred_at, condition_note, maintenance) values(?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), bookingId, "RETURN", "demo-staff-dn", returnBranch, java.sql.Timestamp.from(returnTime), "Nhận xe", false);
        }

        return new FixtureContext(bookingId, vehicleId, handoverTime, returnTime);
    }

    private HttpHeaders authHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) headers.set("Authorization", token);
        return headers;
    }

    @Test
    void testRealHttp_PositiveReportAndReadbackOverSocket() {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);

        String url = "http://localhost:" + port + "/api/v1/incidents";
        Map<String, Object> req = Map.of(
            "bookingId", fix.bookingId,
            "kind", "ACCIDENT",
            "occurredAt", fix.handoverTime.plus(Duration.ofHours(2)).toString(),
            "description", "Sự cố giao thông qua real HTTP client",
            "evidenceReference", "http://evidence.test/photo.jpg",
            "blockVehicle", false
        );

        var snapBefore = IncidentEvidence.snapshot(jdbc);
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(req, authHeaders(userToken)), Map.class);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Real HTTP response status must be 200 OK");
        assertNotNull(response.getBody());
        assertEquals("OPEN", response.getBody().get("status"));
        assertEquals("ACCIDENT", response.getBody().get("kind"));

        String caseId = (String) response.getBody().get("id");
        assertNotNull(caseId);

        // Readback GET list over HTTP
        ResponseEntity<List> listResp = restTemplate.exchange(url + "?bookingId=" + fix.bookingId, HttpMethod.GET, new HttpEntity<>(authHeaders(userToken)), List.class);
        assertEquals(HttpStatus.OK, listResp.getStatusCode());
        assertNotNull(listResp.getBody());
        assertEquals(1, listResp.getBody().size());

        // Readback GET events over HTTP
        ResponseEntity<List> eventsResp = restTemplate.exchange(url + "/" + caseId + "/events", HttpMethod.GET, new HttpEntity<>(authHeaders(userToken)), List.class);
        assertEquals(HttpStatus.OK, eventsResp.getStatusCode());
        assertNotNull(eventsResp.getBody());
        assertEquals(1, eventsResp.getBody().size());
    }

    @Test
    void testRealHttp_NegativeCustodyAndInvarianceOverSocket() {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);
        String url = "http://localhost:" + port + "/api/v1/incidents";

        // Occurred 1 microsecond before handover
        Instant badTime = fix.handoverTime.minusNanos(1000);
        Map<String, Object> req = Map.of(
            "bookingId", fix.bookingId,
            "kind", "ACCIDENT",
            "occurredAt", badTime.toString(),
            "description", "Sự cố ngoài ranh giới qua HTTP",
            "evidenceReference", "ref-http",
            "blockVehicle", false
        );

        var snapBefore = IncidentEvidence.snapshot(jdbc);
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(req, authHeaders(userToken)), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode(), "Real HTTP outside custody must return 400");
        assertEquals("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế.", response.getBody().get("message"));

        var snapAfter = IncidentEvidence.snapshot(jdbc);
        assertEquals(snapBefore, snapAfter, "Database state must be 100% invariant on HTTP rejection");
    }

    @Test
    void testRealHttp_ForbiddenUserBlockVehicleOverSocket() {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);
        String url = "http://localhost:" + port + "/api/v1/incidents";

        Map<String, Object> req = Map.of(
            "bookingId", fix.bookingId,
            "kind", "DAMAGE",
            "occurredAt", fix.handoverTime.plus(Duration.ofHours(1)).toString(),
            "description", "Khách cố khóa xe qua HTTP",
            "evidenceReference", "ref-http",
            "blockVehicle", true
        );

        var snapBefore = IncidentEvidence.snapshot(jdbc);
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(req, authHeaders(userToken)), Map.class);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode(), "User attempting to block vehicle must receive 403 Forbidden");

        var snapAfter = IncidentEvidence.snapshot(jdbc);
        assertEquals(snapBefore, snapAfter, "Database state and vehicle status must be 100% invariant on 403 rejection");
        assertEquals("ACTIVE", vehicleService.get(fix.vehicleId).status);
    }

    @Test
    void testRealHttp_ForeignUserDenied404OverSocket() {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);
        String url = "http://localhost:" + port + "/api/v1/incidents";

        Map<String, Object> req = Map.of(
            "bookingId", fix.bookingId,
            "kind", "DAMAGE",
            "occurredAt", fix.handoverTime.plus(Duration.ofHours(1)).toString(),
            "description", "Khách lạ cố báo sự cố qua HTTP",
            "evidenceReference", "ref-http",
            "blockVehicle", false
        );

        var snapBefore = IncidentEvidence.snapshot(jdbc);
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(req, authHeaders(otherUserToken)), Map.class);
        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode(), "Foreign user must receive 404 Not Found (no booking leakage)");

        var snapAfter = IncidentEvidence.snapshot(jdbc);
        assertEquals(snapBefore, snapAfter, "Database state must be 100% invariant on 404 rejection");
    }

    @Test
    void testRealHttp_UnauthorizedWhenNoTokenOverSocket() {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);
        String url = "http://localhost:" + port + "/api/v1/incidents";

        Map<String, Object> req = Map.of(
            "bookingId", fix.bookingId,
            "kind", "DAMAGE",
            "occurredAt", fix.handoverTime.plus(Duration.ofHours(1)).toString(),
            "description", "Không gửi token",
            "evidenceReference", "ref-http",
            "blockVehicle", false
        );

        var snapBefore = IncidentEvidence.snapshot(jdbc);
        ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST, new HttpEntity<>(req, authHeaders(null)), Map.class);
        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode(), "Missing JWT must receive 401 Unauthorized");

        var snapAfter = IncidentEvidence.snapshot(jdbc);
        assertEquals(snapBefore, snapAfter, "Database state must be 100% invariant on 401 rejection");
    }
}

