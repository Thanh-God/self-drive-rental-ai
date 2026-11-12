package com.carrental;

import static com.carrental.AssistantReviewQuoteFlowSupport.DN;
import static org.junit.jupiter.api.Assertions.*;

import com.carrental.modules.ai.AiDiagnostics;
import com.carrental.modules.ai.AiProviderCapacity;
import com.carrental.modules.ai.chat.QwenChatModel;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
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
 * R3 / D2 (REVIEW #8) with the default allowance of 6: an opening request answered by the model, then six messages
 * that each answer only the field the backend asked for. The search must finish with cards, the model must be
 * called once and only one question may be counted.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.jwt-secret=ai-chat-minimal-search-secret-at-least-32-bytes",
    "app.ai-recommendation-enabled=true", "app.qwen-parser-enabled=false", "app.gemini-parser-enabled=false",
    "app.seed-enabled=true", "app.seed-password=AiChatMinimalOnly123!",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@Import(AiChatMinimalSearchHttpTest.Config.class)
class AiChatMinimalSearchHttpTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final List<JsonNode> PROVIDER_REQUESTS = new CopyOnWriteArrayList<>();
    static HttpServer stub;

    @TestConfiguration static class Config {
        @Bean @Primary Clock minimalClock() { return Clock.fixed(Instant.parse("2026-10-20T08:00:00Z"), ZoneOffset.UTC); }
        @Bean QwenChatModel scriptedQwenChat(ObjectMapper mapper, AiProviderCapacity capacity, AiDiagnostics diagnostics) throws Exception {
            stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            stub.createContext("/api/chat", exchange -> {
                PROVIDER_REQUESTS.add(mapper.readTree(exchange.getRequestBody().readAllBytes()));
                var criteria = new LinkedHashMap<String, Object>();
                for (String k : List.of("pickupDate", "returnDate", "pickupBranchName", "returnBranchName", "passengers", "budgetVndTotal", "transmission"))
                    criteria.put(k, null);
                criteria.put("unresolvedFields", List.of());
                byte[] reply = mapper.writeValueAsBytes(Map.of("model", "qwen3:8b", "done", true, "done_reason", "stop",
                    "message", Map.of("role", "assistant", "content", mapper.writeValueAsString(
                        Map.of("intent", "ASK_MISSING", "reply", "Bạn nhận xe ngày nào?", "criteria", criteria)))));
                exchange.sendResponseHeaders(200, reply.length);
                try (var out = exchange.getResponseBody()) { out.write(reply); }
            });
            stub.start();
            return new QwenChatModel(mapper, URI.create("http://127.0.0.1:" + stub.getAddress().getPort() + "/api/chat"),
                Duration.ofSeconds(10), "qwen3:8b", capacity, diagnostics);
        }
    }
    @AfterAll static void stopStub() { if (stub != null) stub.stop(0); }

    @DynamicPropertySource static void database(DynamicPropertyRegistry r) { AssistantReviewQuoteFlowSupport.database(r, "ai_chat_minimal"); }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    @Autowired LicenseService licenses;

    @Test void oneFieldPerMessageReachesCardsWithOneCountedQuestion() {
        var flow = new AssistantReviewQuoteFlowSupport(http, jdbc, tokens, accounts);
        flow.resetFixture(licenses, new Actor("demo-user", "USER", "Flow fixture"));
        JsonNode criteria = null;
        var asked = new ArrayList<String>();
        JsonNode last = null;
        for (String message : List.of("Mình muốn tìm một chiếc xe để đi chơi.", "22/10/2026", "Ngày trả là 26/10/2026.",
                "Nhận ở " + DN + ".", "Trả cũng ở " + DN + ".", "4", "3 triệu")) {
            var body = JSON.createObjectNode().put("message", message);
            if (criteria != null && !criteria.isNull()) body.set("criteria", criteria);
            var r = http.exchange("/api/v1/ai/chat", HttpMethod.POST, new HttpEntity<>(body, flow.headers("demo-user")), JsonNode.class);
            assertEquals(200, r.getStatusCode().value(), message);
            last = r.getBody();
            criteria = last.path("criteria");
            asked.add(criteria.path("askedField").asText(null));
        }
        assertEquals(Arrays.asList("pickupDate", "returnDate", "pickupBranchId", "returnBranchId", "passengers", "budgetVndTotal", null), asked);
        assertEquals("SEARCH_VEHICLES", last.path("intent").asText());
        assertTrue(last.path("cards").size() >= 1, last.toString());
        assertEquals(1, PROVIDER_REQUESTS.size(), "only the opening message needed the model");
        assertEquals(1, last.path("quota").path("used").asInt(), "six field answers used no allowance");
        assertEquals(5, last.path("quota").path("remaining").asInt());
    }
}
