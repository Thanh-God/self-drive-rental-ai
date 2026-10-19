package com.carrental;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = {
    "app.jwt-secret=location-route-http-test-secret-32-bytes",
    "app.ai-routing-enabled=true",
    "app.seed-enabled=true",
    "app.seed-password=LocationRouteTestOnly123!"
})
@AutoConfigureMockMvc
class LocationRouteHttpServerTest {
    private static final String PREVIEW = "/api/v1/ai/routes/preview";
    private static final String ADMIN_LOCATIONS = "/api/v1/admin/locations";
    private static final String ADMIN_CATEGORIES = "/api/v1/admin/location-categories";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String url = System.getenv("KDRIVE_TEST_DB_URL");
        if (url != null && !url.isBlank()) {
            CancelBoundaryTest.verifySafeIsolatedDatabase(
                url,
                System.getenv("KDRIVE_TEST_REQUIRED_SCHEMA_PREFIX"),
                System.getenv("KDRIVE_TEST_FIXTURE_MARKER_TOKEN"),
                System.getenv("KDRIVE_TEST_DB_USER"),
                System.getenv("KDRIVE_TEST_DB_PASSWORD")
            );
        }
        registry.add("spring.datasource.url", () -> url == null
            ? "jdbc:h2:mem:locationroutehttp;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
            : url);
        registry.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        registry.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    private String token(String email) throws Exception {
        String request = json.writeValueAsString(Map.of("email", email, "password", "LocationRouteTestOnly123!"));
        String response = mvc.perform(post("/api/v1/auth/login").contentType("application/json").content(request))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("token").asText();
    }

    private MockHttpServletRequestBuilder authorized(MockHttpServletRequestBuilder request, String token) {
        return request.header("Authorization", "Bearer " + token);
    }

    private String body(Object input) throws Exception {
        return json.writeValueAsString(input);
    }

    private String createCategory(String admin) throws Exception {
        String name = "Category " + UUID.randomUUID();
        String response = mvc.perform(authorized(post(ADMIN_CATEGORIES), admin)
                .contentType("application/json").content(body(Map.of("name", name))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("id").asText();
    }

    private String createLocation(String admin, String categoryId, String name, String lat, String lng, String statusValue) throws Exception {
        String response = mvc.perform(authorized(post(ADMIN_LOCATIONS), admin)
                .contentType("application/json")
                .content(body(Map.of(
                    "categoryId", categoryId,
                    "name", name,
                    "latitude", new BigDecimal(lat),
                    "longitude", new BigDecimal(lng),
                    "status", statusValue
                ))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("id").asText();
    }

    @Test
    void routePreviewFullLifecycleWithPermissionsNegativeCasesAndNoBusinessWrites() throws Exception {
        String admin = token("admin@example.test");
        String staff = token("staff.dn@example.test");
        String user = token("user@example.test");

        String cat = createCategory(admin);

        // Tạo 3 điểm thực tế tại Đà Nẵng - Hội An (trong vùng phủ của OSRM central graph)
        // Point 1: Cầu Rồng Đà Nẵng (16.0611, 108.2232)
        String p1 = createLocation(admin, cat, "Cầu Rồng " + UUID.randomUUID(), "16.0611000", "108.2232000", "ACTIVE");
        // Point 2: Phố cổ Hội An (15.8801, 108.3380)
        String p2 = createLocation(admin, cat, "Phố cổ Hội An " + UUID.randomUUID(), "15.8801000", "108.3380000", "ACTIVE");
        // Point 3: Bán đảo Sơn Trà (16.1130, 108.2750)
        String p3 = createLocation(admin, cat, "Sơn Trà " + UUID.randomUUID(), "16.1130000", "108.2750000", "ACTIVE");
        // Point 4: Địa điểm không hoạt động (INACTIVE)
        String pInactive = createLocation(admin, cat, "Điểm đóng cửa " + UUID.randomUUID(), "16.0500000", "108.2200000", "INACTIVE");
        // Point 5: Địa điểm nằm ngoài mạng lưới giao thông (0, 0)
        String pOffNetwork = createLocation(admin, cat, "Điểm ngoài đảo " + UUID.randomUUID(), "0.0000000", "0.0000000", "ACTIVE");

        // Đếm số bản ghi trước khi thực hiện các request preview
        int bookingsBefore = jdbc.queryForObject("select count(*) from bookings", Integer.class);
        int itinerariesBefore = jdbc.queryForObject("select count(*) from itineraries", Integer.class);
        int locationsBefore = jdbc.queryForObject("select count(*) from locations", Integer.class);

        // 1. Phân quyền HTTP (Permissions):
        // Guest (unauthenticated) -> 401 Unauthorized
        mvc.perform(post(PREVIEW).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, p2)))))
            .andExpect(status().isUnauthorized());

        // STAFF -> 403 Forbidden
        mvc.perform(authorized(post(PREVIEW), staff).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, p2)))))
            .andExpect(status().isForbidden());

        // ADMIN -> 403 Forbidden (chức năng AI chỉ dành riêng cho USER theo role matrix)
        mvc.perform(authorized(post(PREVIEW), admin).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, p2)))))
            .andExpect(status().isForbidden());

        // 2. Ca âm về Dữ liệu đầu vào (Input Validation Negatives) với role USER:
        // Thiếu điểm (< 2 điểm)
        mvc.perform(authorized(post(PREVIEW), user).contentType("application/json").content(body(Map.of("locationIds", List.of(p1)))))
            .andExpect(status().isBadRequest());

        // Quá nhiều điểm (> 8 điểm)
        mvc.perform(authorized(post(PREVIEW), user).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, p2, p3, p1, p2, p3, p1, p2, p3)))))
            .andExpect(status().isBadRequest());

        // Điểm trùng lặp
        mvc.perform(authorized(post(PREVIEW), user).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, p1)))))
            .andExpect(status().isBadRequest());

        // ID không tồn tại
        mvc.perform(authorized(post(PREVIEW), user).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, UUID.randomUUID().toString())))))
            .andExpect(status().isBadRequest());

        // ID là địa điểm INACTIVE (không cho phép tính tuyến qua địa điểm ngừng hoạt động)
        mvc.perform(authorized(post(PREVIEW), user).contentType("application/json").content(body(Map.of("locationIds", List.of(p1, pInactive)))))
            .andExpect(status().isBadRequest());

        // Payload rỗng / malformed
        mvc.perform(authorized(post(PREVIEW), user).contentType("application/json").content("{}"))
            .andExpect(status().isBadRequest());

        // 3. Tuyến dương trên OSRM hoặc xử lý lỗi khi OSRM offline/NoRoute:
        // Gọi tuyến hợp lệ p1 -> p2 (Đà Nẵng -> Hội An)
        String validRouteRes = mvc.perform(authorized(post(PREVIEW), user).contentType("application/json")
                .content(body(Map.of("locationIds", List.of(p1, p2)))))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();

        JsonNode validNode = json.readTree(validRouteRes);
        String statusStr = validNode.path("status").asText();
        // Nếu OSRM container đang chạy ở port 5000:
        if ("VERIFIED".equals(statusStr)) {
            double meters = validNode.path("distanceMeters").asDouble();
            double seconds = validNode.path("durationSeconds").asDouble();
            assertTrue(meters > 10000 && meters < 100000, "Distance Da Nang - Hoi An should be between 10km and 100km: " + meters);
            assertTrue(seconds > 300 && seconds < 10000, "Duration should be reasonable: " + seconds);
            assertTrue(validNode.path("attribution").asText().contains("OpenStreetMap"));

            // Thử tuyến 3 điểm: p1 -> p2 -> p3
            String multiRouteRes = mvc.perform(authorized(post(PREVIEW), user).contentType("application/json")
                    .content(body(Map.of("locationIds", List.of(p1, p2, p3)))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            JsonNode multiNode = json.readTree(multiRouteRes);
            assertEquals("VERIFIED", multiNode.path("status").asText());
            assertTrue(multiNode.path("distanceMeters").asDouble() > meters, "3-point route distance should exceed 2-point leg");

            // Thử tuyến có điểm ngoài mạng lưới đường bộ (0, 0)
            String offRouteRes = mvc.perform(authorized(post(PREVIEW), user).contentType("application/json")
                    .content(body(Map.of("locationIds", List.of(p1, pOffNetwork)))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
            JsonNode offNode = json.readTree(offRouteRes);
            assertEquals("NO_ROUTE", offNode.path("status").asText(), "Off-network point must result in NO_ROUTE");
            assertTrue(offNode.path("distanceMeters").isNull());
            assertTrue(offNode.path("durationSeconds").isNull());
        } else {
            // Khi OSRM không khởi động hoặc offline: status phải là UNAVAILABLE và distance/duration phải là null, tuyệt đối không bịa số
            assertEquals("UNAVAILABLE", statusStr);
            assertTrue(validNode.path("distanceMeters").isNull());
            assertTrue(validNode.path("durationSeconds").isNull());
        }

        // 4. Bất biến cơ sở dữ liệu: Không có booking, itinerary hay địa điểm mới nào bị ghi nhận
        assertEquals(bookingsBefore, jdbc.queryForObject("select count(*) from bookings", Integer.class), "Route preview must never create bookings");
        assertEquals(itinerariesBefore, jdbc.queryForObject("select count(*) from itineraries", Integer.class), "Route preview must never create itineraries");
        assertEquals(locationsBefore, jdbc.queryForObject("select count(*) from locations", Integer.class), "Route preview must not alter location count");
    }
}

