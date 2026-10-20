package com.carrental;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.carrental.modules.ai.routing.OsrmRoutingClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

@SpringBootTest(properties = {
    "app.jwt-secret=itinerary-preview-test-secret-at-least-32-bytes",
    "app.seed-enabled=true",
    "app.seed-password=PilotTestOnly123!"
})
@AutoConfigureMockMvc
public class ItineraryPreviewHttpIntegrationTest {
    private static final String PREVIEW_URL = "/api/v1/ai/itineraries/preview";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    @MockBean
    private OsrmRoutingClient osrmRoutingClient;

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
            ? "jdbc:h2:mem:itinerarypreview;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
            : url);
    }

    private String login(String email, String password) throws Exception {
        var res = mvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("email", email, "password", password))))
            .andReturn();
        JsonNode node = json.readTree(res.getResponse().getContentAsString());
        return node.path("token").asText();
    }

    @Test
    void unauthenticatedRequestIsRejected() throws Exception {
        mvc.perform(post(PREVIEW_URL)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "tripDate", "2026-10-25",
                    "startTime", "08:00",
                    "endTime", "14:00",
                    "startLocationId", "loc-1"
                ))))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void staffAndAdminAreForbiddenFromCustomerItineraryPreview() throws Exception {
        String adminToken = login("admin@example.test", "PilotTestOnly123!");
        mvc.perform(post(PREVIEW_URL)
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "tripDate", "2026-10-25",
                    "startTime", "08:00",
                    "endTime", "14:00",
                    "startLocationId", "loc-1"
                ))))
            .andExpect(status().isForbidden());
    }

    @Test
    void invalidParametersReturnBadRequest() throws Exception {
        String userToken = login("user@example.test", "PilotTestOnly123!");

        // 1. Ngày trong quá khứ
        mvc.perform(post(PREVIEW_URL)
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "tripDate", "2020-01-01",
                    "startTime", "08:00",
                    "endTime", "14:00",
                    "startLocationId", "loc-1"
                ))))
            .andExpect(status().isBadRequest());

        // 2. Định dạng giờ không hợp lệ
        mvc.perform(post(PREVIEW_URL)
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "tripDate", "2026-10-25",
                    "startTime", "8 giờ",
                    "endTime", "14:00",
                    "startLocationId", "loc-1"
                ))))
            .andExpect(status().isBadRequest());

        // 3. Thiếu startLocationId
        mvc.perform(post(PREVIEW_URL)
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "tripDate", "2026-10-25",
                    "startTime", "08:00",
                    "endTime", "14:00"
                ))))
            .andExpect(status().isBadRequest());
    }

    @Test
    void successfulPreviewReturnsValidatedAndFingerprint() throws Exception {
        String adminToken = login("admin@example.test", "PilotTestOnly123!");
        String userToken = login("user@example.test", "PilotTestOnly123!");

        // Tạo category
        var catRes = mvc.perform(post("/api/v1/admin/location-categories")
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Di tích Preview Test\"}"))
            .andExpect(status().isCreated())
            .andReturn();
        String catId = json.readTree(catRes.getResponse().getContentAsString()).path("id").asText();

        // Tạo 2 địa điểm có metadata hợp lệ
        String metaA = """
            {
                "timezone": "Asia/Ho_Chi_Minh",
                "weekly": {
                    "MONDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]},
                    "TUESDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]},
                    "WEDNESDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]},
                    "THURSDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]},
                    "FRIDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]},
                    "SATURDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]},
                    "SUNDAY": {"state": "INTERVALS", "intervals": [{"start": "07:30", "end": "17:00", "nextDay": false}]}
                },
                "exceptions": {},
                "durationMinutes": 60,
                "hoursEvidence": {"url": "https://example.com/a", "verifiedAt": "2026-10-01T00:00:00Z"},
                "durationEvidence": {"url": "https://example.com/a", "verifiedAt": "2026-10-01T00:00:00Z"}
            }
            """;

        String metaB = """
            {
                "timezone": "Asia/Ho_Chi_Minh",
                "weekly": {
                    "MONDAY": {"state": "OPEN_24H", "intervals": []},
                    "TUESDAY": {"state": "OPEN_24H", "intervals": []},
                    "WEDNESDAY": {"state": "OPEN_24H", "intervals": []},
                    "THURSDAY": {"state": "OPEN_24H", "intervals": []},
                    "FRIDAY": {"state": "OPEN_24H", "intervals": []},
                    "SATURDAY": {"state": "OPEN_24H", "intervals": []},
                    "SUNDAY": {"state": "OPEN_24H", "intervals": []}
                },
                "exceptions": {},
                "durationMinutes": 45,
                "hoursEvidence": {"url": "https://example.com/b", "verifiedAt": "2026-10-01T00:00:00Z"},
                "durationEvidence": {"url": "https://example.com/b", "verifiedAt": "2026-10-01T00:00:00Z"}
            }
            """;

        var locRes1 = mvc.perform(post("/api/v1/admin/locations")
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "categoryId", catId,
                    "name", "Điểm A Preview",
                    "latitude", 16.0601,
                    "longitude", 108.2235,
                    "status", "ACTIVE",
                    "metadata", json.readTree(metaA)
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        String locId1 = json.readTree(locRes1.getResponse().getContentAsString()).path("id").asText();

        var locRes2 = mvc.perform(post("/api/v1/admin/locations")
                .header("Authorization", "Bearer " + adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "categoryId", catId,
                    "name", "Điểm B Preview",
                    "latitude", 16.0041,
                    "longitude", 108.2638,
                    "status", "ACTIVE",
                    "metadata", json.readTree(metaB)
                ))))
            .andExpect(status().isCreated())
            .andReturn();
        String locId2 = json.readTree(locRes2.getResponse().getContentAsString()).path("id").asText();

        // Mock OSRM leg routing
        var leg = new OsrmRoutingClient.Leg(12000.0, 1080.0); // 12km, 18 phút
        when(osrmRoutingClient.route(anyList())).thenReturn(
            new OsrmRoutingClient.Estimate(OsrmRoutingClient.Status.VERIFIED, 12000.0, 1080.0, "OSM Test", List.of(leg))
        );

        // Ngày mai hợp lệ
        String tripDate = LocalDate.now().plusDays(2).toString();

        mvc.perform(post(PREVIEW_URL)
                .header("Authorization", "Bearer " + userToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of(
                    "tripDate", tripDate,
                    "startTime", "08:00",
                    "endTime", "13:00",
                    "startLocationId", locId1
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("VALIDATED"))
            .andExpect(jsonPath("$.criteria.startLocationId").value(locId1))
            .andExpect(jsonPath("$.fingerprint").isNotEmpty())
            .andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].locationId").value(locId1))
            .andExpect(jsonPath("$.items[0].arrival").value("08:00"))
            .andExpect(jsonPath("$.items[0].departure").value("09:00"))
            .andExpect(jsonPath("$.items[0].dwellMinutes").value(60))
            .andExpect(jsonPath("$.items[0].travelToNextMinutes").value(18))
            .andExpect(jsonPath("$.items[1].locationId").value(locId2))
            .andExpect(jsonPath("$.items[1].arrival").value("09:18"))
            .andExpect(jsonPath("$.items[1].departure").value("10:03"))
            .andExpect(jsonPath("$.items[1].dwellMinutes").value(45))
            .andExpect(jsonPath("$.totals.totalDwellMinutes").value(105))
            .andExpect(jsonPath("$.totals.totalTravelMinutes").value(18))
            .andExpect(jsonPath("$.totals.locationCount").value(2));
    }
}
