package com.carrental;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
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
    "app.jwt-secret=location-api-test-secret-at-least-32-bytes",
    "app.seed-enabled=true",
    "app.seed-password=LocationApiTestOnly123!"
})
@AutoConfigureMockMvc
class LocationIntegrationTest {
    private static final String CATEGORIES = "/api/v1/admin/location-categories";
    private static final String LOCATIONS = "/api/v1/admin/locations";

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
            ? "jdbc:h2:mem:locationapi;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1"
            : url);
        registry.add("spring.datasource.username", () -> url == null ? "sa" : System.getenv("KDRIVE_TEST_DB_USER"));
        registry.add("spring.datasource.password", () -> url == null ? "" : System.getenv("KDRIVE_TEST_DB_PASSWORD"));
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    private String token(String email) throws Exception {
        String request = json.writeValueAsString(Map.of("email", email, "password", "LocationApiTestOnly123!"));
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
        String name = "Location type " + UUID.randomUUID();
        String response = mvc.perform(authorized(post(CATEGORIES), admin)
                .contentType("application/json").content(body(Map.of("name", name))))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("id").asText();
    }

    private Map<String, Object> input(String categoryId, String name, String latitude, String longitude, String state) {
        return Map.of(
            "categoryId", categoryId,
            "name", name,
            "latitude", new BigDecimal(latitude),
            "longitude", new BigDecimal(longitude),
            "status", state
        );
    }

    @Test
    void adminCanCreateReadUpdateCategoryCoordinatesAndStatus() throws Exception {
        String admin = token("admin@example.test");
        String firstCategory = createCategory(admin);
        String secondCategory = createCategory(admin);
        String name = "Park " + UUID.randomUUID();

        String createdBody = mvc.perform(authorized(post(LOCATIONS), admin)
                .contentType("application/json").content(body(input(firstCategory, " " + name + " ", "0", "0", "INACTIVE"))))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value(name))
            .andExpect(jsonPath("$.categoryId").value(firstCategory))
            .andExpect(jsonPath("$.categoryName").isString())
            .andExpect(jsonPath("$.latitude").value(0))
            .andExpect(jsonPath("$.longitude").value(0))
            .andExpect(jsonPath("$.status").value("INACTIVE"))
            .andReturn().getResponse().getContentAsString();
        JsonNode created = json.readTree(createdBody);
        String id = created.path("id").asText();
        String oldRevision = created.path("revision").asText();

        mvc.perform(authorized(get(LOCATIONS + "/" + id), admin))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(id))
            .andExpect(jsonPath("$.status").value("INACTIVE"));

        String updatedBody = mvc.perform(authorized(put(LOCATIONS + "/" + id), admin)
                .contentType("application/json")
                .content(body(Map.of(
                    "categoryId", secondCategory,
                    "name", name + " updated",
                    "latitude", new BigDecimal("90"),
                    "longitude", new BigDecimal("180"),
                    "status", "ACTIVE",
                    "expectedRevision", oldRevision
                ))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.categoryId").value(secondCategory))
            .andExpect(jsonPath("$.name").value(name + " updated"))
            .andExpect(jsonPath("$.latitude").value(90))
            .andExpect(jsonPath("$.longitude").value(180))
            .andExpect(jsonPath("$.status").value("ACTIVE"))
            .andReturn().getResponse().getContentAsString();
        String currentRevision = json.readTree(updatedBody).path("revision").asText();

        mvc.perform(authorized(put(LOCATIONS + "/" + id), admin)
                .contentType("application/json")
                .content(body(Map.of(
                    "categoryId", firstCategory,
                    "name", name + " stale",
                    "latitude", new BigDecimal("1"),
                    "longitude", new BigDecimal("2"),
                    "status", "INACTIVE",
                    "expectedRevision", oldRevision
                ))))
            .andExpect(status().isConflict());

        mvc.perform(authorized(get(LOCATIONS), admin))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.id == '%s')].name".formatted(id)).value(org.hamcrest.Matchers.hasItem(name + " updated")))
            .andExpect(jsonPath("$[?(@.id == '%s')].revision".formatted(id)).value(org.hamcrest.Matchers.hasItem(currentRevision)));

        assertEquals(1, jdbc.queryForObject("select count(*) from locations where id=? and category_id=? and name=? and status='ACTIVE'", Integer.class, id, secondCategory, name + " updated"));
        assertEquals(0, jdbc.queryForObject("select count(*) from locations where id=? and category_id=?", Integer.class, id, firstCategory));
    }

    @Test
    void locationInputsAreValidatedBeforeAnyRowIsWritten() throws Exception {
        String admin = token("admin@example.test");
        String category = createCategory(admin);
        String unknownCategory = UUID.randomUUID().toString();
        int before = jdbc.queryForObject("select count(*) from locations", Integer.class);
        String name = "Invalid location " + UUID.randomUUID();

        mvc.perform(authorized(post(LOCATIONS), admin).contentType("application/json")
                .content(body(input(category, name, "-90.0000001", "0", "ACTIVE"))))
            .andExpect(status().isBadRequest());
        mvc.perform(authorized(post(LOCATIONS), admin).contentType("application/json")
                .content(body(input(category, name, "0", "180.0000001", "ACTIVE"))))
            .andExpect(status().isBadRequest());
        mvc.perform(authorized(post(LOCATIONS), admin).contentType("application/json")
                .content(body(input(category, name, "1.12345678", "0", "ACTIVE"))))
            .andExpect(status().isBadRequest());
        mvc.perform(authorized(post(LOCATIONS), admin).contentType("application/json")
                .content(body(input(category, name, "0", "0", "UNKNOWN"))))
            .andExpect(status().isBadRequest());
        mvc.perform(authorized(post(LOCATIONS), admin).contentType("application/json")
                .content(body(input(unknownCategory, name, "0", "0", "ACTIVE"))))
            .andExpect(status().isBadRequest());
        mvc.perform(authorized(post(LOCATIONS), admin).contentType("application/json")
                .content(body(input(category, "x".repeat(201), "0", "0", "ACTIVE"))))
            .andExpect(status().isBadRequest());

        assertEquals(before, jdbc.queryForObject("select count(*) from locations", Integer.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from locations where name=?", Integer.class, name));
    }

    @Test
    void locationEndpointsRequireAdminAndDoNotProvideDelete() throws Exception {
        String user = token("user@example.test");
        String staff = token("staff.dn@example.test");
        String admin = token("admin@example.test");
        String id = UUID.randomUUID().toString();
        Map<String, Object> update = Map.of(
            "categoryId", UUID.randomUUID().toString(),
            "name", "No write",
            "latitude", BigDecimal.ZERO,
            "longitude", BigDecimal.ZERO,
            "status", "ACTIVE",
            "expectedRevision", "0".repeat(64)
        );

        mvc.perform(get(LOCATIONS)).andExpect(status().isUnauthorized());
        mvc.perform(authorized(get(LOCATIONS), user)).andExpect(status().isForbidden());
        mvc.perform(authorized(get(LOCATIONS + "/" + id), staff)).andExpect(status().isForbidden());
        mvc.perform(authorized(post(LOCATIONS), user).contentType("application/json")
                .content(body(input(UUID.randomUUID().toString(), "No write", "0", "0", "ACTIVE"))))
            .andExpect(status().isForbidden());
        mvc.perform(authorized(put(LOCATIONS + "/" + id), staff).contentType("application/json").content(body(update)))
            .andExpect(status().isForbidden());
        mvc.perform(authorized(delete(LOCATIONS + "/" + id), admin)).andExpect(status().isMethodNotAllowed());
        mvc.perform(authorized(get(LOCATIONS + "/" + id), admin)).andExpect(status().isNotFound());
    }
}