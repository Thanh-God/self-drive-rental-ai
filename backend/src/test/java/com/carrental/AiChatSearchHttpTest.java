package com.carrental;

import static com.carrental.AssistantReviewQuoteFlowSupport.DN;
import static org.junit.jupiter.api.Assertions.*;

import com.carrental.modules.ai.AiDiagnostics;
import com.carrental.modules.ai.AiProviderCapacity;
import com.carrental.modules.ai.chat.QwenChatModel;
import com.carrental.modules.ai.recommendation.RecommendationModels;
import com.carrental.modules.ai.recommendation.RecommendationService;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * C3.1 vehicle search in the chat over HTTP: a scripted model (loopback Ollama stub) drafts criteria; the
 * backend re-checks them against the customer's text, merges the criteria the client carries, asks one
 * missing field at a time and searches with the rule-based recommendation. Not evidence of model quality.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.jwt-secret=ai-chat-search-test-secret-at-least-32-bytes",
    "app.ai-recommendation-enabled=true", "app.qwen-parser-enabled=false", "app.gemini-parser-enabled=false",
    "app.seed-enabled=true", "app.seed-password=AiChatSearchOnly123!",
    // One renter sends many messages across these scenarios; AiChatHttpTest covers the allowance.
    "app.ai-daily-limit=1000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@Import(AiChatSearchHttpTest.Config.class)
class AiChatSearchHttpTest {
    static final Instant NOW = Instant.parse("2026-10-20T08:00:00Z");
    static final ObjectMapper JSON = new ObjectMapper();
    static final Map<String, String> SCRIPT = new ConcurrentHashMap<>();
    static final List<JsonNode> PROVIDER_REQUESTS = new CopyOnWriteArrayList<>();
    static HttpServer stub;

    @TestConfiguration static class Config {
        @Bean @Primary Clock searchClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
        @Bean QwenChatModel scriptedQwenChat(ObjectMapper mapper, AiProviderCapacity capacity, AiDiagnostics diagnostics) throws Exception {
            stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            stub.createContext("/api/chat", exchange -> {
                var request = mapper.readTree(exchange.getRequestBody().readAllBytes());
                PROVIDER_REQUESTS.add(request);
                var messages = request.path("messages");
                String content = SCRIPT.get(messages.get(messages.size() - 1).path("content").asText());
                byte[] reply = content == null ? new byte[0] : mapper.writeValueAsBytes(Map.of(
                    "model", "qwen3:8b", "done", true, "done_reason", "stop",
                    "message", Map.of("role", "assistant", "content", content)));
                exchange.sendResponseHeaders(content == null ? 500 : 200, content == null ? -1 : reply.length);
                try (var out = exchange.getResponseBody()) { out.write(reply); }
            });
            stub.start();
            return new QwenChatModel(mapper, URI.create("http://127.0.0.1:" + stub.getAddress().getPort() + "/api/chat"),
                Duration.ofSeconds(10), "qwen3:8b", capacity, diagnostics);
        }
    }
    @AfterAll static void stopStub() { if (stub != null) stub.stop(0); }

    @DynamicPropertySource static void database(DynamicPropertyRegistry r) { AssistantReviewQuoteFlowSupport.database(r, "ai_chat_search"); }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    @Autowired LicenseService licenses;
    @Autowired RecommendationService recommendations;
    final Actor user = new Actor("demo-user", "USER", "Flow fixture");
    AssistantReviewQuoteFlowSupport flow;

    @BeforeEach void setup() {
        flow = new AssistantReviewQuoteFlowSupport(http, jdbc, tokens, accounts);
        flow.resetFixture(licenses, user);
        PROVIDER_REQUESTS.clear();
        SCRIPT.clear();
    }

    /** Script the model's search draft for exactly this customer message. */
    static void draft(String message, String intent, String pickupDate, String returnDate, String pickupBranch, String returnBranch,
                      Integer passengers, Long budget, String transmission, String... unresolved) throws Exception {
        var c = new LinkedHashMap<String, Object>();
        c.put("pickupDate", pickupDate);
        c.put("returnDate", returnDate);
        c.put("pickupBranchName", pickupBranch);
        c.put("returnBranchName", returnBranch);
        c.put("passengers", passengers);
        c.put("budgetVndTotal", budget);
        c.put("transmission", transmission);
        c.put("unresolvedFields", List.of(unresolved));
        SCRIPT.put(message, JSON.writeValueAsString(Map.of("intent", intent, "reply", "Model text the backend replaces 9.999.999đ", "criteria", c)));
    }

    ResponseEntity<JsonNode> chat(String message, JsonNode criteria) {
        var body = JSON.createObjectNode().put("message", message);
        if (criteria != null && !criteria.isNull()) body.set("criteria", criteria);
        return http.exchange("/api/v1/ai/chat", HttpMethod.POST, new HttpEntity<>(body, flow.headers("demo-user")), JsonNode.class);
    }

    @Test void askOneMissingFieldThenSearchWithCarriedCriteriaAndNeverWriteRecords() throws Exception {
        var before = flow.baseline();
        String first = "Tôi muốn thuê xe số tự động, nhận tại " + DN + " ngày 22/10/2026.";
        draft(first, "ASK_MISSING", "2026-10-22", null, DN, null, null, null, "AUTO");
        var asked = chat(first, null).getBody();
        assertEquals("ASK_MISSING", asked.path("intent").asText());
        assertEquals(List.of("returnDate", "returnBranchId", "passengers", "budgetVndTotal"), texts(asked.path("missing")));
        assertTrue(asked.path("reply").asText().contains("trả xe ngày nào"), asked.path("reply").asText());
        assertFalse(asked.path("reply").asText().contains("9.999.999"), "model wording is never shown in a search turn");
        assertEquals("2026-10-22", asked.path("criteria").path("pickupDate").asText());
        assertEquals("dn", asked.path("criteria").path("pickupBranchId").asText());
        assertEquals("AUTO", asked.path("criteria").path("transmission").asText());
        assertEquals(0, asked.path("cards").size());
        assertEquals(1, PROVIDER_REQUESTS.size());
        var schema = PROVIDER_REQUESTS.get(0).path("format").path("oneOf").get(1).path("properties").path("criteria").path("properties");
        assertEquals(List.of(DN), texts(schema.path("pickupBranchName").path("enum")).stream().filter(Objects::nonNull).toList());

        String second = "Trả tại " + DN + " ngày 26/10/2026, đi 4 người, tổng ngân sách 3 triệu.";
        draft(second, "SEARCH_VEHICLES", null, "2026-10-26", null, DN, 4, 3_000_000L, null);
        var found = chat(second, asked.path("criteria")).getBody();
        assertEquals(2, PROVIDER_REQUESTS.size(), "one model call per message");
        assertEquals("SEARCH_VEHICLES", found.path("intent").asText());
        assertEquals(0, found.path("missing").size());
        var criteria = found.path("criteria");
        assertEquals("2026-10-22", criteria.path("pickupDate").asText(), "carried from the first turn");
        assertEquals("2026-10-26", criteria.path("returnDate").asText());
        assertEquals("dn", criteria.path("returnBranchId").asText());
        assertEquals(4, criteria.path("passengers").asInt());
        assertEquals(3_000_000L, criteria.path("budgetVndTotal").asLong());
        var expected = recommendations.recommend(user, new RecommendationModels.Request("expected", new RecommendationModels.Criteria(
            LocalDate.parse("2026-10-22"), LocalDate.parse("2026-10-26"), "dn", "dn", 4, 3_000_000L,
            new RecommendationModels.Preferences("AUTO", List.of()))));
        assertEquals("OK", expected.status());
        var cards = found.path("cards");
        assertEquals(Math.min(3, expected.results().size()), cards.size());
        for (int i = 0; i < cards.size(); i++) {
            var want = expected.results().get(i);
            assertEquals(want.vehicleId(), cards.get(i).path("vehicleId").asText());
            assertEquals(want.total(), cards.get(i).path("total").asLong(), "total comes from the backend, fee included");
            assertEquals(want.oneWayFee(), cards.get(i).path("oneWayFee").asLong());
            assertTrue(cards.get(i).path("total").asLong() <= 3_000_000L);
        }
        assertTrue(found.path("reply").asText().contains("22/10/2026"));
        assertFalse(found.path("reply").asText().contains("9.999.999"));
        flow.assertUnchangedSince(before);
    }

    @Test void theCustomersEditWinsAndAnUnaffordableBudgetGivesNoCards() throws Exception {
        var carried = (ObjectNode) JSON.readTree("{\"pickupDate\":\"2026-10-22\",\"returnDate\":\"2026-10-26\",\"pickupBranchId\":\"dn\","
            + "\"returnBranchId\":\"hn\",\"passengers\":4,\"budgetVndTotal\":5000000,\"transmission\":null}");
        String edit = "Đổi ngân sách thành tổng 1 triệu thôi.";
        draft(edit, "SEARCH_VEHICLES", null, null, null, null, null, 1_000_000L, null);
        var r = chat(edit, carried).getBody();
        assertEquals(1_000_000L, r.path("criteria").path("budgetVndTotal").asLong());
        assertEquals("hn", r.path("criteria").path("returnBranchId").asText());
        assertEquals(0, r.path("cards").size());
        assertTrue(r.path("reply").asText().startsWith("Chưa có xe phù hợp"), r.path("reply").asText());

        String undecided = "Mình chưa chắc đi mấy người.";
        draft(undecided, "ASK_MISSING", null, null, null, null, null, null, null, "passengers");
        var cleared = chat(undecided, carried).getBody();
        assertTrue(cleared.path("criteria").path("passengers").isNull(), "a field the customer now leaves open is asked again");
        assertEquals(List.of("passengers"), texts(cleared.path("missing")));
    }

    @Test void valuesTheTextDoesNotSupportAndForgedCarriedCriteriaAreDropped() throws Exception {
        String noYear = "Nhận xe ngày 22/10, trả ngày 26/10, 4 người, 3 triệu.";
        // The model invents years and a branch the text never names.
        draft(noYear, "SEARCH_VEHICLES", "2026-10-22", "2026-10-26", DN, DN, 4, 3_000_000L, "MANUAL");
        var r = chat(noYear, null).getBody();
        assertEquals("ASK_MISSING", r.path("intent").asText());
        assertTrue(r.path("criteria").path("pickupDate").isNull());
        assertTrue(r.path("criteria").path("returnDate").isNull());
        assertTrue(r.path("criteria").path("pickupBranchId").isNull());
        assertTrue(r.path("criteria").path("transmission").isNull(), "a gearbox the text does not state is not taken");
        assertEquals(List.of("pickupDate", "returnDate", "pickupBranchId", "returnBranchId"), texts(r.path("missing")));
        assertTrue(r.path("reply").asText().contains("ghi đủ ngày/tháng/năm"));

        var forged = (ObjectNode) JSON.readTree("{\"pickupDate\":\"2026-13-01\",\"returnDate\":\"2026-10-26\",\"pickupBranchId\":\"zz\","
            + "\"returnBranchId\":\"' or 1=1\",\"passengers\":99,\"budgetVndTotal\":-5,\"transmission\":\"ROCKET\"}");
        String more = "Tôi cần xe.";
        draft(more, "ASK_MISSING", null, null, null, null, null, null, null);
        var cleaned = chat(more, forged).getBody().path("criteria");
        assertTrue(cleaned.path("pickupDate").isNull());
        assertEquals("2026-10-26", cleaned.path("returnDate").asText(), "a valid carried value is kept");
        assertTrue(cleaned.path("pickupBranchId").isNull());
        assertTrue(cleaned.path("returnBranchId").isNull());
        assertTrue(cleaned.path("passengers").isNull());
        assertTrue(cleaned.path("budgetVndTotal").isNull());
        assertTrue(cleaned.path("transmission").isNull());
        assertEquals(400, chat(more, JSON.readTree("{\"passengers\":\"bốn\"}")).getStatusCode().value());
    }

    static List<String> texts(JsonNode array) {
        var out = new ArrayList<String>();
        array.forEach(n -> out.add(n.isNull() ? null : n.asText()));
        return out;
    }
}
