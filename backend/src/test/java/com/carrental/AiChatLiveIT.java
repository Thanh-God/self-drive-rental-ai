package com.carrental;

import static com.carrental.AssistantReviewQuoteFlowSupport.DN;
import static org.junit.jupiter.api.Assertions.*;

import com.carrental.modules.ai.recommendation.RecommendationModels;
import com.carrental.modules.ai.recommendation.RecommendationService;
import com.carrental.modules.user.service.AccountService;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.security.Actor;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.*;
import java.util.*;
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
 * C3.2: chat and in-chat vehicle search over HTTP with the real local Qwen (qwen3:8b) and the database the
 * runner provides (a marked MySQL schema). Never part of the default suite; the runner requires
 * KDRIVE_AI_LIVE_FLOW=true. Each turn is asked once; the full transcript is printed before any assertion.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.jwt-secret=ai-chat-live-secret-at-least-32-bytes-long",
    "app.ai-recommendation-enabled=true", "app.qwen-parser-enabled=true", "app.qwen-model=qwen3:8b",
    "app.gemini-parser-enabled=false", "app.ai-routing-enabled=false",
    "app.seed-enabled=true", "app.seed-password=AiChatLiveOnly123!",
    "app.ai-daily-limit=100",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
@Import(AiChatLiveIT.Config.class)
class AiChatLiveIT {
    static final ObjectMapper JSON = new ObjectMapper();

    @TestConfiguration static class Config {
        @Bean @Primary Clock liveClock() { return Clock.fixed(Instant.parse("2026-10-20T08:00:00Z"), ZoneOffset.UTC); }
    }

    @DynamicPropertySource static void database(DynamicPropertyRegistry r) { AssistantReviewQuoteFlowSupport.database(r, "ai_chat_live"); }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    @Autowired LicenseService licenses;
    @Autowired RecommendationService recommendations;
    final Actor user = new Actor("demo-user", "USER", "Flow fixture");

    record Turn(String message, JsonNode body, int status, long elapsedMs) {}

    @Test void multiTurnSearchAndAPolicyQuestionWithRealQwen() throws Exception {
        var flow = new AssistantReviewQuoteFlowSupport(http, jdbc, tokens, accounts);
        flow.resetFixture(licenses, user);
        var before = flow.baseline();

        var transcript = new ArrayList<Turn>();
        var history = JSON.createArrayNode();
        JsonNode criteria = null;
        for (String message : List.of(
                "Mình muốn thuê xe tự lái, nhận tại " + DN + " ngày 22/10/2026.",
                "Trả xe tại " + DN + " ngày 26/10/2026.",
                "4 người, tổng ngân sách 3 triệu.")) {
            var turn = ask(flow, message, history, criteria);
            transcript.add(turn);
            if (turn.status() != 200) break;
            criteria = turn.body().path("criteria");
            history.add(JSON.createObjectNode().put("role", "user").put("text", message));
            history.add(JSON.createObjectNode().put("role", "assistant").put("text", turn.body().path("reply").asText()));
        }
        var deposit = ask(flow, "Có phải đặt cọc không?", JSON.createArrayNode(), null);
        transcript.add(deposit);

        var report = JSON.createArrayNode();
        for (var t : transcript) {
            var row = report.addObject().put("message", t.message()).put("status", t.status()).put("elapsedMs", t.elapsedMs());
            if (t.body() != null) row.set("response", t.body());
        }
        System.out.println("C3.2-LIVE-TRANSCRIPT " + JSON.writeValueAsString(report));

        assertEquals(4, transcript.size(), "every turn answered");
        for (var t : transcript) assertEquals(200, t.status(), t.message());
        var t1 = transcript.get(0).body();
        assertEquals("ASK_MISSING", t1.path("intent").asText());
        assertEquals("2026-10-22", t1.path("criteria").path("pickupDate").asText());
        assertEquals("dn", t1.path("criteria").path("pickupBranchId").asText());
        var t2 = transcript.get(1).body();
        assertEquals("ASK_MISSING", t2.path("intent").asText());
        assertEquals("2026-10-26", t2.path("criteria").path("returnDate").asText());
        assertEquals("dn", t2.path("criteria").path("returnBranchId").asText());
        assertTrue(texts(t2.path("missing")).containsAll(List.of("passengers", "budgetVndTotal")), t2.toString());
        var t3 = transcript.get(2).body();
        assertEquals("SEARCH_VEHICLES", t3.path("intent").asText(), "the short follow-up continues the search");
        assertEquals(4, t3.path("criteria").path("passengers").asInt());
        assertEquals(3_000_000L, t3.path("criteria").path("budgetVndTotal").asLong());
        var cards = t3.path("cards");
        assertTrue(cards.size() >= 1, t3.toString());
        var expected = recommendations.recommend(user, new RecommendationModels.Request("expected", new RecommendationModels.Criteria(
            LocalDate.parse("2026-10-22"), LocalDate.parse("2026-10-26"), "dn", "dn", 4, 3_000_000L,
            new RecommendationModels.Preferences(t3.path("criteria").path("transmission").isNull() ? null
                : t3.path("criteria").path("transmission").asText(), List.of()))));
        for (int i = 0; i < cards.size(); i++) {
            assertEquals(expected.results().get(i).vehicleId(), cards.get(i).path("vehicleId").asText());
            assertEquals(expected.results().get(i).total(), cards.get(i).path("total").asLong());
            assertTrue(cards.get(i).path("total").asLong() <= 3_000_000L);
        }
        var d = transcript.get(3).body();
        assertEquals("ANSWER", d.path("intent").asText());
        assertEquals("K-B07", d.path("citations").get(0).path("id").asText());
        flow.assertUnchangedSince(before);
    }

    Turn ask(AssistantReviewQuoteFlowSupport flow, String message, ArrayNode history, JsonNode criteria) {
        ObjectNode body = JSON.createObjectNode().put("message", message);
        if (!history.isEmpty()) body.set("messages", history.deepCopy());
        if (criteria != null && !criteria.isNull()) body.set("criteria", criteria);
        long t = System.nanoTime();
        var r = http.exchange("/api/v1/ai/chat", HttpMethod.POST, new HttpEntity<>(body, flow.headers("demo-user")), JsonNode.class);
        return new Turn(message, r.getBody(), r.getStatusCode().value(), (System.nanoTime() - t) / 1_000_000);
    }

    static List<String> texts(JsonNode array) {
        var out = new ArrayList<String>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }
}
