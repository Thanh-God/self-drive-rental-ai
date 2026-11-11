package com.carrental;

import static org.junit.jupiter.api.Assertions.*;

import com.carrental.modules.ai.AiDiagnostics;
import com.carrental.modules.ai.AiProviderCapacity;
import com.carrental.modules.ai.parser.QwenCriteriaParser;
import com.carrental.modules.user.service.AccountService;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * C1.1 over HTTP with the default allowance (6 questions a day): the production QwenCriteriaParser talks to a
 * loopback stub. Proves the 429 contract the client relies on and that refused or failed calls are free.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.jwt-secret=ai-daily-quota-test-secret-at-least-32-bytes",
    "app.qwen-parser-enabled=false", "app.gemini-parser-enabled=false",
    "app.seed-enabled=true", "app.seed-password=AiQuotaOnly123!",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@Import(AiDailyQuotaHttpTest.Config.class)
class AiDailyQuotaHttpTest {
    static final Instant NOW = Instant.parse("2026-11-11T03:00:00Z"); // 10:00 in Vietnam
    static final String FAILING = "Câu này làm provider trả 500.";
    static final List<String> PROVIDER_REQUESTS = new CopyOnWriteArrayList<>();
    static HttpServer stub;

    @TestConfiguration static class Config {
        @Bean @Primary Clock quotaClock() { return Clock.fixed(NOW, ZoneOffset.UTC); }
        @Bean QwenCriteriaParser scriptedQwen(ObjectMapper mapper, AiProviderCapacity capacity, AiDiagnostics diagnostics) throws Exception {
            stub = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            stub.createContext("/api/chat", exchange -> {
                String request = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                PROVIDER_REQUESTS.add(request);
                String text = mapper.readTree(request).path("messages").get(1).path("content").asText();
                byte[] reply = FAILING.equals(text) ? new byte[0] : mapper.writeValueAsBytes(Map.of(
                    "model", "qwen3:8b", "done", true, "done_reason", "stop",
                    "message", Map.of("role", "assistant", "content", "{\"decision\":\"OUT_OF_SCOPE\"}")));
                exchange.sendResponseHeaders(reply.length == 0 ? 500 : 200, reply.length == 0 ? -1 : reply.length);
                try (var out = exchange.getResponseBody()) { out.write(reply); }
            });
            stub.start();
            return new QwenCriteriaParser(mapper, URI.create("http://127.0.0.1:" + stub.getAddress().getPort() + "/api/chat"),
                Duration.ofSeconds(10), "qwen3:8b", capacity, diagnostics);
        }
    }
    @AfterAll static void stopStub() { if (stub != null) stub.stop(0); }

    @DynamicPropertySource static void database(DynamicPropertyRegistry r) { AssistantReviewQuoteFlowSupport.database(r, "ai_daily_quota"); }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;

    @Test void sixAnsweredQuestionsThenA429WithCodeResetTimeAndSampleHotline() {
        var flow = new AssistantReviewQuoteFlowSupport(http, jdbc, tokens, accounts);
        // Free: refused input, wrong role, and a provider failure.
        assertEquals(400, flow.parse("demo-user", "Gọi 0901234567").getStatusCode().value());
        assertEquals(403, flow.parse("demo-staff-dn", "Thuê xe").getStatusCode().value());
        assertEquals(503, flow.parse("demo-user", FAILING).getStatusCode().value());
        assertEquals(1, PROVIDER_REQUESTS.size());
        // C1.2: reading the allowance needs a USER token and never uses a question.
        assertEquals(401, quota(flow, null).getStatusCode().value());
        assertEquals(403, quota(flow, "demo-staff-dn").getStatusCode().value());
        assertEquals(403, quota(flow, "demo-admin").getStatusCode().value());
        for (int i = 0; i < 3; i++) assertQuota(flow, 0, 6);

        for (int i = 1; i <= 6; i++) {
            var answered = flow.parse("demo-user", "Câu hỏi số " + i);
            assertEquals(200, answered.getStatusCode().value(), "question " + i);
            assertEquals("OUT_OF_SCOPE", answered.getBody().path("status").asText());
        }
        assertEquals(7, PROVIDER_REQUESTS.size());
        assertQuota(flow, 6, 0);

        var refused = flow.parse("demo-user", "Câu hỏi số 7");
        assertEquals(429, refused.getStatusCode().value());
        var body = refused.getBody();
        assertEquals("AI_DAILY_LIMIT", body.path("code").asText());
        assertEquals(6, body.path("limit").asInt());
        assertEquals(0, body.path("remaining").asInt());
        assertEquals("2026-11-11T17:00:00Z", body.path("resetAt").asText());
        assertEquals("10008888", body.path("hotline").path("number").asText());
        assertTrue(body.path("hotline").path("sample").asBoolean());
        assertTrue(body.path("message").asText().contains("10008888 (số mẫu dùng cho bản demo)"), body.toString());
        assertEquals(7, PROVIDER_REQUESTS.size(), "The refused question must not reach the model");
        for (String forbidden : List.of("demo-user", "Bearer"))
            assertFalse(body.toString().contains(forbidden), "429 body must not echo account data: " + forbidden);
        assertQuota(flow, 6, 0);
    }

    org.springframework.http.ResponseEntity<com.fasterxml.jackson.databind.JsonNode> quota(AssistantReviewQuoteFlowSupport flow, String accountId) {
        return http.exchange("/api/v1/ai/quota", org.springframework.http.HttpMethod.GET,
            new org.springframework.http.HttpEntity<>(flow.headers(accountId)), com.fasterxml.jackson.databind.JsonNode.class);
    }

    void assertQuota(AssistantReviewQuoteFlowSupport flow, int used, int remaining) {
        var response = quota(flow, "demo-user");
        assertEquals(200, response.getStatusCode().value());
        var body = response.getBody();
        assertEquals(6, body.path("limit").asInt());
        assertEquals(used, body.path("used").asInt());
        assertEquals(remaining, body.path("remaining").asInt());
        assertEquals("2026-11-11T17:00:00Z", body.path("resetAt").asText());
        assertEquals("10008888", body.path("hotline").path("number").asText());
        assertTrue(body.path("hotline").path("sample").asBoolean());
    }
}
