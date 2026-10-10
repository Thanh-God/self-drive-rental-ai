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
import com.carrental.security.TokenService;
import com.carrental.modules.user.service.AccountService;

import java.time.Instant;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={
    "app.jwt-secret=integration-test-only-secret-at-least-32-bytes",
    "app.seed-enabled=true",
    "app.seed-password=kdrive_seed_pw_c6_review_20261010",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@AutoConfigureMockMvc
@Import(ReviewHttpIntegrationTest.TimeConfig.class)
public class ReviewHttpIntegrationTest {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry r) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null && !url.isBlank()) {
            CancelBoundaryTest.verifySafeIsolatedDatabase(url, System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"), System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"), System.getenv("KDRIVE_TEST_DB_USER"), System.getenv("KDRIVE_TEST_DB_PASSWORD"));
        }
        r.add("spring.datasource.url", () -> url == null ? "jdbc:h2:mem:reviewhttp;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" : url);
        r.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        r.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
    }

    static class MutableClock extends java.time.Clock {
        Instant value = Instant.now();
        public java.time.ZoneId getZone() { return java.time.ZoneOffset.UTC; }
        public java.time.Clock withZone(java.time.ZoneId z) { return this; }
        public Instant instant() { return value; }
    }

    @TestConfiguration
    static class TimeConfig {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokenService;
    @Autowired AccountService accountService;
    @Autowired MutableClock clock;

    private String tokenUser;
    private String tokenOtherUser;
    private String tokenStaff;
    private String tokenAdmin;

    private final String userId = "demo-user";
    private final String otherUserId = "user-other-test";
    private final String staffId = "demo-staff-dn";
    private final String adminId = "demo-admin";

    private final String vehicle1Id = "v1";
    private final String vehicle2Id = "v2";

    @BeforeEach
    void setUp() {
        clock.value = Instant.parse("2026-10-10T10:00:00Z");
        jdbc.update("DELETE FROM reviews");

        // Ensure otherUser exists
        Integer otherUserCount = jdbc.queryForObject("SELECT count(*) FROM users WHERE id=?", Integer.class, otherUserId);
        if (otherUserCount == null || otherUserCount == 0) {
            jdbc.update("INSERT INTO users(id,email,password_hash,full_name,role,status,token_version,version) VALUES(?,?,?,?,?,?,0,0)",
                otherUserId, "otheruser@example.test", "hash", "Khách hàng khác", "USER", "ACTIVE");
        }

        tokenUser = "Bearer " + tokenService.issue(accountService.require(userId));
        tokenOtherUser = "Bearer " + tokenService.issue(accountService.require(otherUserId));
        tokenStaff = "Bearer " + tokenService.issue(accountService.require(staffId));
        tokenAdmin = "Bearer " + tokenService.issue(accountService.require(adminId));
    }

    private String createBooking(String uId, String vehicleId, String status) {
        String bookingId = UUID.randomUUID().toString();
        Instant start = clock.value.minus(Duration.ofDays(5));
        Instant end = clock.value.minus(Duration.ofDays(2));
        jdbc.update(
            "INSERT INTO bookings(id,user_id,vehicle_id,customer_name,vehicle_name,pickup_branch_id,return_branch_id,pickup_name,return_name,actual_return_branch_id,start_at,end_at,expires_at,status,daily_price,rental_days,rental_total,one_way_fee,total,policy_version,created_at,version) " +
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)",
            bookingId, uId, vehicleId, "Khách test", "Xe test", "dn", "dn", "Đà Nẵng · mẫu", "Đà Nẵng · mẫu", "dn",
            java.sql.Timestamp.from(start), java.sql.Timestamp.from(end), java.sql.Timestamp.from(start.plus(Duration.ofHours(2))),
            status, 800000L, 3, 2400000L, 0L, 2400000L, "v1_policy", java.sql.Timestamp.from(start.minus(Duration.ofDays(1)))
        );
        return bookingId;
    }

    private int countReviews() {
        return jdbc.queryForObject("SELECT count(*) FROM reviews", Integer.class);
    }

    @Test
    void testC6_04_RBAC_Http_Security_Endpoints() throws Exception {
        String bookingId = createBooking(userId, vehicle1Id, "COMPLETED");
        String createJson = "{\"bookingId\":\"" + bookingId + "\",\"rating\":5,\"content\":\"Dịch vụ tốt\"}";

        // 1. Guest POST /api/v1/reviews -> 401 Unauthorized
        mockMvc.perform(post("/api/v1/reviews")
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson))
                .andExpect(status().isUnauthorized());

        // 2. Staff POST /api/v1/reviews -> 403 Forbidden
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenStaff)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson))
                .andExpect(status().isForbidden());

        // 3. Admin POST /api/v1/reviews -> 403 Forbidden
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenAdmin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(createJson))
                .andExpect(status().isForbidden());

        // 4. Admin reviews listing:
        // Guest GET /api/v1/admin/reviews -> 401
        mockMvc.perform(get("/api/v1/admin/reviews"))
                .andExpect(status().isUnauthorized());

        // User GET /api/v1/admin/reviews -> 403
        mockMvc.perform(get("/api/v1/admin/reviews")
                .header("Authorization", tokenUser))
                .andExpect(status().isForbidden());

        // Staff GET /api/v1/admin/reviews -> 403
        mockMvc.perform(get("/api/v1/admin/reviews")
                .header("Authorization", tokenStaff))
                .andExpect(status().isForbidden());

        // Admin GET /api/v1/admin/reviews -> 200 OK
        mockMvc.perform(get("/api/v1/admin/reviews")
                .header("Authorization", tokenAdmin))
                .andExpect(status().isOk());

        // 5. Admin moderation:
        // User PATCH /api/v1/admin/reviews/any -> 403
        mockMvc.perform(patch("/api/v1/admin/reviews/any-id")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"hidden\":true,\"version\":0}"))
                .andExpect(status().isForbidden());

        // No review created during RBAC probes
        assertEquals(0, countReviews());
    }

    @Test
    void testC6_01_User_Create_And_Readback_Http() throws Exception {
        String bookingId = createBooking(userId, vehicle1Id, "COMPLETED");

        // Before creation: GET /api/v1/bookings/{id}/review returns 200 with empty body (null)
        mockMvc.perform(get("/api/v1/bookings/" + bookingId + "/review")
                .header("Authorization", tokenUser))
                .andExpect(status().isOk())
                .andExpect(content().string(""));

        // User creates review via HTTP POST
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + bookingId + "\",\"rating\":5,\"content\":\"   Xe sạch sẽ và êm ái.   \"}"))
                .andExpect(status().isOk());

        // After creation: readback via GET /api/v1/bookings/{id}/review
        mockMvc.perform(get("/api/v1/bookings/" + bookingId + "/review")
                .header("Authorization", tokenUser))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.booking_id").value(bookingId))
                .andExpect(jsonPath("$.rating").value(5))
                .andExpect(jsonPath("$.content").value("Xe sạch sẽ và êm ái.")) // content is trimmed
                .andExpect(jsonPath("$.hidden").value(false))
                .andExpect(jsonPath("$.version").value(0));

        assertEquals(1, countReviews());
    }

    @Test
    void testC6_02_Duplicate_Sequential_And_Concurrent_Http() throws Exception {
        String bookingId = createBooking(userId, vehicle1Id, "COMPLETED");

        // First POST succeeds
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + bookingId + "\",\"rating\":5,\"content\":\"Winner content\"}"))
                .andExpect(status().isOk());

        // Sequential duplicate POST fails with 409 Conflict
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + bookingId + "\",\"rating\":4,\"content\":\"Attempt overwrite\"}"))
                .andExpect(status().isConflict());

        // Winner content is NOT overwritten
        Map<String,Object> row = jdbc.queryForMap("SELECT content, rating, version FROM reviews WHERE booking_id=?", bookingId);
        assertEquals("Winner content", row.get("content"));
        assertEquals(5, ((Number) row.get("rating")).intValue());
        assertEquals(0L, ((Number) row.get("version")).longValue());

        // Concurrency test on fresh booking via HTTP
        String concurrentBookingId = createBooking(userId, vehicle1Id, "COMPLETED");
        int threads = 2;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger successCount = new AtomicInteger(0);
        AtomicInteger conflictCount = new AtomicInteger(0);

        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            final int idx = i;
            futures.add(executor.submit(() -> {
                ready.countDown();
                try {
                    start.await();
                    int status = mockMvc.perform(post("/api/v1/reviews")
                            .header("Authorization", tokenUser)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"bookingId\":\"" + concurrentBookingId + "\",\"rating\":5,\"content\":\"Concurrent thread " + idx + "\"}"))
                            .andReturn().getResponse().getStatus();
                    if (status == 200) successCount.incrementAndGet();
                    else if (status == 409) conflictCount.incrementAndGet();
                } catch (Exception ignored) {
                }
            }));
        }

        ready.await();
        start.countDown();
        for (Future<?> f : futures) f.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        assertEquals(1, successCount.get(), "Chính xác 1 HTTP request trả về 200 OK");
        assertEquals(1, conflictCount.get(), "Request còn lại trả về 409 Conflict");
        Integer finalRows = jdbc.queryForObject("SELECT count(*) FROM reviews WHERE booking_id=?", Integer.class, concurrentBookingId);
        assertEquals(1, finalRows, "DB chỉ có đúng 1 row duy nhất cho booking");
    }

    @Test
    void testC6_03_Boundary_Input_And_State_Http_With_Invariance() throws Exception {
        String completedId = createBooking(userId, vehicle1Id, "COMPLETED");

        // Capture initial DB state
        int initialReviews = countReviews();

        // 1. Foreign booking: Other user attempts to review User's booking -> 404 NOT_FOUND
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenOtherUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":5,\"content\":\"Đánh giá trái phép\"}"))
                .andExpect(status().isNotFound());
        assertEquals(initialReviews, countReviews());

        // Other user attempts to read User's booking review -> 404 NOT_FOUND
        mockMvc.perform(get("/api/v1/bookings/" + completedId + "/review")
                .header("Authorization", tokenOtherUser))
                .andExpect(status().isNotFound());

        // 2. Booking status negative cases: all non-COMPLETED statuses must be rejected with 400 Bad Request
        String[] nonCompletedStatuses = {"PENDING", "CONFIRMED", "IN_PROGRESS", "RETURNED", "CANCELLED", "EXPIRED"};
        for (String st : nonCompletedStatuses) {
            String bId = createBooking(userId, vehicle1Id, st);
            mockMvc.perform(post("/api/v1/reviews")
                    .header("Authorization", tokenUser)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"bookingId\":\"" + bId + "\",\"rating\":5,\"content\":\"Đánh giá đơn " + st + "\"}"))
                    .andExpect(status().isBadRequest());
            assertEquals(initialReviews, countReviews(), "Không được tạo review cho đơn ở trạng thái " + st);
        }

        // 3. Rating boundary: 0 and 6 -> 400 Bad Request
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":0,\"content\":\"Sao 0\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":6,\"content\":\"Sao 6\"}"))
                .andExpect(status().isBadRequest());
        assertEquals(initialReviews, countReviews());

        // 4. Content boundary: null, blank, > 1000 characters -> 400 Bad Request
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":5,\"content\":null}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":5,\"content\":\"     \"}"))
                .andExpect(status().isBadRequest());
        String tooLong = "C".repeat(1001);
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":5,\"content\":\"" + tooLong + "\"}"))
                .andExpect(status().isBadRequest());
        assertEquals(initialReviews, countReviews());

        // 5. Malformed JSON / missing fields -> 400 Bad Request
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{malformed-json"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"rating\":5,\"content\":\"Thiếu bookingId\"}"))
                .andExpect(status().isBadRequest());
        assertEquals(initialReviews, countReviews());

        // 6. Valid exact boundary: rating 1, 5 and 1000 chars -> 200 OK
        String exact1000 = "D".repeat(1000);
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + completedId + "\",\"rating\":1,\"content\":\"" + exact1000 + "\"}"))
                .andExpect(status().isOk());
        assertEquals(initialReviews + 1, countReviews());
        Map<String,Object> r = jdbc.queryForMap("SELECT rating, length(content) as len FROM reviews WHERE booking_id=?", completedId);
        assertEquals(1, ((Number) r.get("rating")).intValue());
        assertEquals(1000, ((Number) r.get("len")).intValue());
    }

    @Test
    void testC6_05_And_06_Admin_Moderation_OptimisticLocking_Public_Http() throws Exception {
        String bookingA = createBooking(userId, vehicle1Id, "COMPLETED");
        String bookingB = createBooking(otherUserId, vehicle2Id, "COMPLETED");

        // User A and User Other create reviews
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + bookingA + "\",\"rating\":5,\"content\":\"Xe 1 chạy tốt\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/reviews")
                .header("Authorization", tokenOtherUser)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"bookingId\":\"" + bookingB + "\",\"rating\":4,\"content\":\"Xe 2 êm\"}"))
                .andExpect(status().isOk());

        // Public vehicle 1 has 1 review; verify no booking_id or user_id exposed
        mockMvc.perform(get("/api/v1/vehicles/" + vehicle1Id + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].content").value("Xe 1 chạy tốt"))
                .andExpect(jsonPath("$[0].booking_id").doesNotExist())
                .andExpect(jsonPath("$[0].user_id").doesNotExist());

        String reviewAId = jdbc.queryForObject("SELECT id FROM reviews WHERE booking_id=?", String.class, bookingA);
        Map<String,Object> initialRow = jdbc.queryForMap("SELECT * FROM reviews WHERE id=?", reviewAId);

        // Admin 1 hides review using version 0 -> 200 OK
        mockMvc.perform(patch("/api/v1/admin/reviews/" + reviewAId)
                .header("Authorization", tokenAdmin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"hidden\":true,\"version\":0}"))
                .andExpect(status().isOk());

        // Public vehicle 1 now has 0 reviews
        mockMvc.perform(get("/api/v1/vehicles/" + vehicle1Id + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // Public vehicle 2 is completely isolated and unaffected
        mockMvc.perform(get("/api/v1/vehicles/" + vehicle2Id + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].content").value("Xe 2 êm"));

        // Admin 2 attempts moderation with stale version 0 -> 409 Conflict
        Map<String,Object> beforeStale = jdbc.queryForMap("SELECT * FROM reviews WHERE id=?", reviewAId);
        mockMvc.perform(patch("/api/v1/admin/reviews/" + reviewAId)
                .header("Authorization", tokenAdmin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"hidden\":false,\"version\":0}"))
                .andExpect(status().isConflict());

        // Invariance check: full row equality before and after stale attempt
        Map<String,Object> afterStale = jdbc.queryForMap("SELECT * FROM reviews WHERE id=?", reviewAId);
        assertEquals(beforeStale.get("hidden"), afterStale.get("hidden"));
        assertEquals(beforeStale.get("version"), afterStale.get("version"));
        assertEquals(beforeStale.get("moderated_by"), afterStale.get("moderated_by"));
        assertEquals(beforeStale.get("moderated_at"), afterStale.get("moderated_at"));
        assertEquals(beforeStale.get("created_at"), afterStale.get("created_at"));
        assertEquals(beforeStale.get("content"), afterStale.get("content"));

        // Admin moderation with null wrapper values -> 400 Bad Request
        mockMvc.perform(patch("/api/v1/admin/reviews/" + reviewAId)
                .header("Authorization", tokenAdmin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"hidden\":null,\"version\":null}"))
                .andExpect(status().isBadRequest());

        // Admin shows review using valid version 1 -> 200 OK
        mockMvc.perform(patch("/api/v1/admin/reviews/" + reviewAId)
                .header("Authorization", tokenAdmin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"hidden\":false,\"version\":1}"))
                .andExpect(status().isOk());

        // Public vehicle 1 sees review again
        mockMvc.perform(get("/api/v1/vehicles/" + vehicle1Id + "/reviews"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].content").value("Xe 1 chạy tốt"));

        // Owner still sees own review even when hidden or shown
        mockMvc.perform(get("/api/v1/bookings/" + bookingA + "/review")
                .header("Authorization", tokenUser))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(reviewAId))
                .andExpect(jsonPath("$.version").value(2));
    }
}

