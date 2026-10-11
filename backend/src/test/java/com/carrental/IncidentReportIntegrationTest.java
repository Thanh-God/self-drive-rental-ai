package com.carrental;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.http.MediaType;
import org.springframework.transaction.support.TransactionTemplate;
import com.carrental.security.TokenService;
import com.carrental.security.Actor;
import com.carrental.modules.operation.service.IncidentService;
import com.carrental.modules.vehicle.service.VehicleService;

import java.time.Instant;
import java.time.Duration;
import java.util.*;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={
    "app.jwt-secret=integration-test-only-secret-at-least-32-bytes",
    "app.token-minutes=30",
    "app.seed-enabled=true",
    "app.seed-password=kdrive_seed_pw_c7_incident_20261011",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@AutoConfigureMockMvc
@Import(IncidentReportIntegrationTest.TimeConfig.class)
public class IncidentReportIntegrationTest {

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
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:incidentreport;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
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

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired com.carrental.modules.user.service.AccountService accountService;
    @Autowired MutableClock clock;
    @Autowired IncidentService incidentService;
    @Autowired VehicleService vehicleService;
    @Autowired TransactionTemplate tx;

    private String userToken;
    private String otherUserToken;
    private String staffHnToken;
    private String staffDnToken;
    private String staffSgnToken;
    private String adminToken;

    @BeforeEach
    void setupTokens() {
        clock.value = Instant.parse("2026-10-15T12:00:00Z");

        // Đảm bảo users và chi nhánh sgn tồn tại cho FK trong DB
        ensureUserExists("other-user", "Khách khác", "other@example.com", "USER");
        ensureUserExists("demo-staff-sgn", "Staff Sài Gòn", "staff.sgn@example.com", "STAFF");
        if (jdbc.queryForObject("select count(*) from branches where id='sgn'", Long.class) == 0) {
            jdbc.update("insert into branches(id, name, address, status, version) values('sgn', 'Sài Gòn · mẫu', 'Điểm mẫu SG', 'ACTIVE', 0)");
        }
        // Gán staff-sgn vào chi nhánh sgn
        if (jdbc.queryForObject("select count(*) from staff_branches where user_id='demo-staff-sgn' and branch_id='sgn'", Long.class) == 0) {
            jdbc.update("insert into staff_branches(user_id, branch_id) values(?, ?)", "demo-staff-sgn", "sgn");
        }

        userToken = "Bearer " + tokens.issue(accountService.require("demo-user"));
        otherUserToken = "Bearer " + tokens.issue(accountService.require("other-user"));
        staffHnToken = "Bearer " + tokens.issue(accountService.require("demo-staff-hn"));
        staffDnToken = "Bearer " + tokens.issue(accountService.require("demo-staff-dn"));
        staffSgnToken = "Bearer " + tokens.issue(accountService.require("demo-staff-sgn"));
        adminToken = "Bearer " + tokens.issue(accountService.require("demo-admin"));
    }

    private void ensureUserExists(String id, String fullName, String email, String role) {
        Long cnt = jdbc.queryForObject("select count(*) from users where id=?", Long.class, id);
        if (cnt == 0) {
            jdbc.update("insert into users(id, full_name, email, phone, password_hash, role, status, token_version, version) values(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, fullName, email, "0900000000", "pw_dummy", role, "ACTIVE", 0L, 0L);
        }
    }

    /**
     * Helper tạo fixture booking và handover records độc lập với id duy nhất
     */
    private record FixtureContext(String bookingId, String vehicleId, Instant handoverTime, Instant returnTime) {}

    private FixtureContext createBookingFixture(String status, String pickupBranch, String returnBranch, String vehicleCurrentBranch, boolean withHandover, boolean withReturn) {
        String bookingId = "bk-" + UUID.randomUUID().toString().substring(0, 8);
        String vehicleId = "veh-" + UUID.randomUUID().toString().substring(0, 8);

        // Tạo vehicle với homeBranch=pickupBranch và currentBranch=vehicleCurrentBranch
        jdbc.update("insert into vehicles(id, name, plate, brand_id, category_id, home_branch_id, current_branch_id, seats, transmission, daily_price, status, description, version) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            vehicleId, "Xe Test " + vehicleId, "29A-" + UUID.randomUUID().toString().substring(0, 5).toUpperCase(), "toyota", "sedan", pickupBranch, vehicleCurrentBranch, 5, "AUTO", 1000000L, "ACTIVE", "Mô tả", 0L);

        Instant startAt = clock.value.minus(Duration.ofDays(4));
        Instant endAt = clock.value.minus(Duration.ofDays(1));
        Instant handoverTime = startAt.plus(Duration.ofHours(1));
        Instant returnTime = endAt.minus(Duration.ofHours(1));

        jdbc.update("insert into bookings(id, user_id, vehicle_id, customer_name, vehicle_name, pickup_branch_id, return_branch_id, pickup_name, return_name, actual_return_branch_id, start_at, end_at, expires_at, status, daily_price, rental_days, rental_total, one_way_fee, total, policy_version, version, created_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            bookingId, "demo-user", vehicleId, "Khách hàng", "Xe Test " + vehicleId, pickupBranch, returnBranch, pickupBranch, returnBranch, null,
            java.sql.Timestamp.from(startAt), java.sql.Timestamp.from(endAt), java.sql.Timestamp.from(startAt), status, 1000000L, 4, 4000000L, 0L, 4000000L, "rental-2026-09-28", 0L, java.sql.Timestamp.from(startAt.minus(Duration.ofDays(1))));

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

    // =========================================================================
    // 1. Custody Time Boundary Tests (IN_PROGRESS, RETURNED, COMPLETED)
    // =========================================================================

    @Test
    void testCustodyBoundary_InProgress_ExactAndMicroseconds() throws Exception {
        // IN_PROGRESS: custodyStart = HANDOVER.occurred_at, custodyEnd = clock.instant()
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);

        // a. Exact custodyStart (HANDOVER time) -> ACCEPTED (inclusive)
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Sự cố đúng thời điểm bắt đầu bàn giao",
                        "evidenceReference": "ref-exact-start",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.kind").value("ACCIDENT"));

        // b. Outside custodyStart by 1 microsecond before -> REJECTED (400)
        Instant oneMicrosBeforeStart = fix.handoverTime.minusNanos(1000);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Sự cố trước bàn giao 1 microsecond",
                        "evidenceReference": "ref-before-start",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, oneMicrosBeforeStart.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));

        // c. Exact custodyEnd (clock.instant() for IN_PROGRESS) -> ACCEPTED
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "VIOLATION",
                        "occurredAt": "%s",
                        "description": "Sự cố đúng thời điểm hiện tại",
                        "evidenceReference": "ref-exact-now",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, clock.value.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));

        // d. Outside custodyEnd by 1 microsecond after clock.instant() -> REJECTED (400)
        Instant oneMicrosAfterNow = clock.value.plusNanos(1000);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "VIOLATION",
                        "occurredAt": "%s",
                        "description": "Sự cố sau hiện tại 1 microsecond",
                        "evidenceReference": "ref-future-micros",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, oneMicrosAfterNow.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));

        // e. Future occurrence (1 day in future) -> REJECTED (400)
        Instant future = clock.value.plus(Duration.ofDays(1));
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Sự cố ở tương lai",
                        "evidenceReference": "ref-future",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, future.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));
    }

    @Test
    void testCustodyBoundary_LateReportOnReturnedOrCompleted() throws Exception {
        // Chuyến đi đã RETURNED, bàn giao ở quá khứ, trả xe lúc 2 giờ trước, hiện tại là clock.instant()
        FixtureContext fix = createBookingFixture("RETURNED", "hn", "dn", "dn", true, true);

        // a. Báo muộn: occurredAt nằm giữa handoverTime và returnTime, nhưng reportedAt là hiện tại -> ACCEPTED
        Instant validOccurred = fix.handoverTime.plus(Duration.ofHours(5));
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Báo muộn sự cố đã xảy ra trong chuyến đi",
                        "evidenceReference": "ref-late-valid",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, validOccurred.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.reportedAt").value(clock.value.toString()))
                .andExpect(jsonPath("$.occurredAt").value(validOccurred.toString()));

        // b. Exact returnTime -> ACCEPTED (inclusive)
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Sự cố lúc trả xe",
                        "evidenceReference": "ref-exact-return",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.returnTime.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));

        // c. Outside returnTime by 1 microsecond after -> REJECTED (400)
        Instant oneMicrosAfterReturn = fix.returnTime.plusNanos(1000);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Sự cố sau khi đã trả xe 1 microsecond",
                        "evidenceReference": "ref-after-return",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, oneMicrosAfterReturn.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));

        // d. COMPLETED status: tương tự, cho phép báo muộn nếu occurredAt hợp lệ
        FixtureContext fixCompleted = createBookingFixture("COMPLETED", "hn", "dn", "dn", true, true);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "VIOLATION",
                        "occurredAt": "%s",
                        "description": "Phạt nguội trong thời gian thuê của đơn đã hoàn tất",
                        "evidenceReference": "ref-completed-valid",
                        "blockVehicle": false
                    }
                    """.formatted(fixCompleted.bookingId, fixCompleted.handoverTime.plus(Duration.ofHours(2)).toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));
    }

    @Test
    void testCustodyBoundary_MissingHandoverOrInvalidBookingStatus() throws Exception {
        // a. PENDING status -> REJECTED (400)
        FixtureContext fixPending = createBookingFixture("PENDING", "hn", "dn", "hn", false, false);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Báo sự cố cho đơn PENDING",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fixPending.bookingId, clock.value.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Chỉ ghi nhận sự cố của chuyến đã giao xe."));

        // b. CONFIRMED status -> REJECTED (400)
        FixtureContext fixConfirmed = createBookingFixture("CONFIRMED", "hn", "dn", "hn", false, false);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Báo sự cố cho đơn CONFIRMED",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fixConfirmed.bookingId, clock.value.toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Chỉ ghi nhận sự cố của chuyến đã giao xe."));

        // c. IN_PROGRESS status nhưng thiếu handover record -> REJECTED (409 Conflict)
        FixtureContext fixNoHandover = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", false, false);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Báo sự cố cho đơn thiếu bàn giao",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fixNoHandover.bookingId, clock.value.toString())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Chưa có biên bản bàn giao xe."));
    }

    // =========================================================================
    // 2. HTTP Validation Tests (Kind, OccurredAt, Description, EvidenceReference)
    // =========================================================================

    @Test
    void testValidation_InvalidKindAndFields() throws Exception {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);

        // a. Invalid kind ("FIRE") -> 400
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "FIRE",
                        "occurredAt": "%s",
                        "description": "Cháy xe",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));

        // b. Null kind -> 400
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": null,
                        "occurredAt": "%s",
                        "description": "Không có loại sự cố",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));

        // c. Null occurredAt -> 400
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": null,
                        "description": "Không có thời gian",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Thời điểm sự việc phải trong thời gian khách giữ xe thực tế."));

        // d. Blank description -> 400
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "   ",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Cần nội dung có căn cứ, tối đa 1500 ký tự."));

        // e. Oversized description (>1500 ký tự) -> 400
        String longDesc = "a".repeat(1501);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "%s",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString(), longDesc)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Cần nội dung có căn cứ, tối đa 1500 ký tự."));

        // f. Oversized evidenceReference (>2000 ký tự) -> 400
        String longEvidence = "e".repeat(2001);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Mô tả hợp lệ",
                        "evidenceReference": "%s",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString(), longEvidence)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Tham chiếu tài liệu quá dài."));
    }

    // =========================================================================
    // 3. Permissions & Leakage Tests (Foreign User, Unassigned Staff, Guest/No Auth)
    // =========================================================================

    @Test
    void testPermissions_ForeignUserAndUnassignedStaff_Denied404Or401() throws Exception {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);

        // a. Khách lạ (otherUser) POST báo sự cố -> 404 (Không rò rỉ dữ liệu sự tồn tại của đơn hàng)
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", otherUserToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Khách lạ cố tình báo sự cố",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Không tìm thấy dữ liệu."));

        // b. Khách lạ GET list incidents -> 404
        mvc.perform(get("/api/v1/incidents")
                .header("Authorization", otherUserToken)
                .param("bookingId", fix.bookingId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Không tìm thấy dữ liệu."));

        // c. Staff Sài Gòn (staffSgn) không thuộc pickupBranch (hn) hay returnBranch (dn) -> 404 khi truy cập đơn
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", staffSgnToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Staff chi nhánh khác cố báo sự cố",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Không tìm thấy dữ liệu."));

        // d. Guest / Chưa đăng nhập -> 401 Unauthorized
        mvc.perform(post("/api/v1/incidents")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Không có token",
                        "evidenceReference": null,
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isUnauthorized());
    }

    // =========================================================================
    // 4. Vehicle Lock Permissions Tests (USER, STAFF current branch vs historical, ADMIN)
    // =========================================================================

    @Test
    void testBlockVehicle_UserForbidden_StaffCurrentBranchVsHistorical_AdminAllowed() throws Exception {
        // Precondition rõ ràng:
        // pickupBranch = 'hn' (demo-staff-hn phụ trách)
        // returnBranch = 'dn' (demo-staff-dn phụ trách)
        // Nhưng vehicle.currentBranchId = 'sgn' (xe hiện ở Sài Gòn, staff-sgn phụ trách)
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "sgn", true, false);

        // a. USER cố tình blockVehicle=true -> 403 Forbidden, xe KHÔNG đổi trạng thái
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Khách muốn khóa xe",
                        "evidenceReference": null,
                        "blockVehicle": true
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Không có quyền thực hiện thao tác."));

        assertEquals("ACTIVE", vehicleService.get(fix.vehicleId).status, "Xe phải giữ nguyên ACTIVE khi user bị từ chối");

        // b. STAFF Hà Nội (thuộc pickupBranch 'hn', đọc được booking) cố tình blockVehicle=true ->
        // Bị từ chối 403 vì vehicle.currentBranchId = 'sgn' chứ không phải 'hn'!
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", staffHnToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Staff HN cố khóa xe đang ở SGN",
                        "evidenceReference": null,
                        "blockVehicle": true
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message").value("Không có quyền thực hiện thao tác."));

        assertEquals("ACTIVE", vehicleService.get(fix.vehicleId).status, "Xe phải giữ nguyên ACTIVE khi Staff sai chi nhánh hiện tại");

        // c. Ca hợp lệ: Xe có currentBranchId = 'hn', Staff Hà Nội (staffHn) báo sự cố và blockVehicle=true -> THÀNH CÔNG, xe chuyển sang MAINTENANCE
        FixtureContext fixHnVehicle = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", staffHnToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Staff HN khóa xe tại chi nhánh HN",
                        "evidenceReference": "ref-staff-block",
                        "blockVehicle": true
                    }
                    """.formatted(fixHnVehicle.bookingId, fixHnVehicle.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));

        assertEquals("MAINTENANCE", vehicleService.get(fixHnVehicle.vehicleId).status, "Xe phải chuyển sang MAINTENANCE khi Staff đúng chi nhánh khóa");

        // d. Ca hợp lệ: ADMIN blockVehicle=true -> THÀNH CÔNG, xe chuyển sang MAINTENANCE (bất kể chi nhánh của xe)
        FixtureContext fixAdmin = createBookingFixture("IN_PROGRESS", "hn", "dn", "sgn", true, false);
        mvc.perform(post("/api/v1/incidents")
                .header("Authorization", adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "ACCIDENT",
                        "occurredAt": "%s",
                        "description": "Admin khóa xe",
                        "evidenceReference": "ref-admin-block",
                        "blockVehicle": true
                    }
                    """.formatted(fixAdmin.bookingId, fixAdmin.handoverTime.plus(Duration.ofMinutes(10)).toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));

        assertEquals("MAINTENANCE", vehicleService.get(fixAdmin.vehicleId).status, "Xe phải chuyển sang MAINTENANCE khi Admin khóa");
    }

    // =========================================================================
    // 5. Audit, Immutability & Event Invariance Tests
    // =========================================================================

    @Test
    void testAuditAndEventInvariance_SuccessfulReportAndByteFieldInvariance() throws Exception {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);

        int totalCasesBefore = jdbc.queryForObject("select count(*) from incident_cases", Integer.class);
        int totalEventsBefore = jdbc.queryForObject("select count(*) from incident_events", Integer.class);

        // Tạo sự cố thứ 1
        String res1 = mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "DAMAGE",
                        "occurredAt": "%s",
                        "description": "Vết xước cánh cửa",
                        "evidenceReference": "img-01.jpg",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofHours(1)).toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"))
                .andExpect(jsonPath("$.assessedDamage").value(0))
                .andExpect(jsonPath("$.thirdPartyCoverage").value(0))
                .andExpect(jsonPath("$.requestedAmount").value(0))
                .andReturn().getResponse().getContentAsString();

        String case1Id = com.jayway.jsonpath.JsonPath.read(res1, "$.id");

        // Kiểm tra database row của case 1
        var caseRow1 = jdbc.queryForMap("select * from incident_cases where id=?", case1Id);
        assertEquals("OPEN", caseRow1.get("status"));
        assertEquals(0L, ((Number) caseRow1.get("assessed_damage")).longValue());
        assertEquals(0L, ((Number) caseRow1.get("third_party_coverage")).longValue());
        assertEquals(0L, ((Number) caseRow1.get("requested_amount")).longValue());
        assertNull(caseRow1.get("responsibility_basis"));
        assertEquals("demo-user", caseRow1.get("reported_by"));

        // Kiểm tra event row của case 1
        var eventRows1 = jdbc.queryForList("select * from incident_events where case_id=?", case1Id);
        assertEquals(1, eventRows1.size(), "Phải tạo đúng 1 event OPEN khi tạo hồ sơ");
        var ev1 = eventRows1.get(0);
        assertEquals("OPEN", ev1.get("action"));
        assertEquals("demo-user", ev1.get("actor_id"));
        assertEquals("Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.", ev1.get("note"));

        // Lấy snapshot toàn bộ event 1 để kiểm tra tính bất biến (byte/field invariance)
        Map<String, Object> ev1Snapshot = new HashMap<>(ev1);

        // Tạo sự cố thứ 2 cho cùng booking
        String res2 = mvc.perform(post("/api/v1/incidents")
                .header("Authorization", userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "bookingId": "%s",
                        "kind": "VIOLATION",
                        "occurredAt": "%s",
                        "description": "Lỗi quá tốc độ",
                        "evidenceReference": "cam-02.jpg",
                        "blockVehicle": false
                    }
                    """.formatted(fix.bookingId, fix.handoverTime.plus(Duration.ofHours(2)).toString())))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        String case2Id = com.jayway.jsonpath.JsonPath.read(res2, "$.id");
        assertNotEquals(case1Id, case2Id);

        // Khẳng định hàng event 1 hoàn toàn không bị sửa đổi (byte/field identical)
        var ev1After = jdbc.queryForMap("select * from incident_events where id=?", ev1.get("id"));
        for (String col : ev1Snapshot.keySet()) {
            assertEquals(ev1Snapshot.get(col), ev1After.get(col), "Field " + col + " trong event cũ không được thay đổi");
        }

        // Readback GET /api/v1/incidents?bookingId=...
        mvc.perform(get("/api/v1/incidents")
                .header("Authorization", userToken)
                .param("bookingId", fix.bookingId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        // Readback GET /api/v1/incidents/{id}/events
        mvc.perform(get("/api/v1/incidents/" + case1Id + "/events")
                .header("Authorization", userToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].action").value("OPEN"));

        // Khách lạ xem events của case 1 -> 404
        mvc.perform(get("/api/v1/incidents/" + case1Id + "/events")
                .header("Authorization", otherUserToken))
                .andExpect(status().isNotFound());
    }

    // =========================================================================
    // 6. Transaction Rollback Integrity Test
    // =========================================================================

    @Test
    void testTransactionRollback_WhenFaultOccursAfterVehicleMutation() {
        FixtureContext fix = createBookingFixture("IN_PROGRESS", "hn", "dn", "hn", true, false);
        assertEquals("ACTIVE", vehicleService.get(fix.vehicleId).status);

        int casesBefore = jdbc.queryForObject("select count(*) from incident_cases", Integer.class);
        int eventsBefore = jdbc.queryForObject("select count(*) from incident_events", Integer.class);

        // Giả lập giao dịch nghiệp vụ trong đó vehicle bị sửa sang MAINTENANCE,
        // sau đó exception xảy ra trong luồng lưu IncidentCase / IncidentEvent
        Actor staffHn = new Actor("demo-staff-hn", "STAFF", "Staff Hà Nội");
        assertThrows(RuntimeException.class, () -> {
            tx.execute(status -> {
                // Bước 1: Mutate vehicle (giống như trong create())
                var veh = vehicleService.lock(fix.vehicleId);
                veh.status = "MAINTENANCE";

                // Bước 2: Ném lỗi có chủ đích để mô phỏng sự cố sau bước cập nhật xe
                throw new RuntimeException("Simulated unexpected fault inside transaction after vehicle mutation");
            });
        });

        // Xác nhận sau rollback:
        // 1. Vehicle status phải rollback về "ACTIVE"
        assertEquals("ACTIVE", vehicleService.get(fix.vehicleId).status, "Vehicle status must rollback to ACTIVE");

        // 2. Không có hàng IncidentCase hoặc IncidentEvent nào bị lưu lại
        int casesAfter = jdbc.queryForObject("select count(*) from incident_cases", Integer.class);
        int eventsAfter = jdbc.queryForObject("select count(*) from incident_events", Integer.class);
        assertEquals(casesBefore, casesAfter, "Incident cases must not grow on transaction failure");
        assertEquals(eventsBefore, eventsAfter, "Incident events must not grow on transaction failure");
    }
}
