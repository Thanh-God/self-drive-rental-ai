package com.carrental;

import static org.junit.jupiter.api.Assertions.*;

import com.carrental.modules.user.service.AccountService;
import com.carrental.security.TokenService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.Objects;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * C5.2 live chat evaluation (never part of the default suite; needs KDRIVE_EVAL_LIVE=1). Reads chat-v1 cases whose
 * dates run_chat_evaluation.py has already resolved, asks every turn exactly once over HTTP against the real local
 * Qwen, and records what came back. Scoring happens in Python; this test only refuses to run unsafely.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.jwt-secret=ai-chat-eval-secret-at-least-32-bytes-long",
    "app.ai-recommendation-enabled=true", "app.qwen-parser-enabled=true", "app.qwen-model=${ai.eval.model:qwen3:8b}",
    "app.gemini-parser-enabled=false", "app.ai-routing-enabled=false",
    "app.seed-enabled=true", "app.seed-password=AiChatEvalOnly123!",
    // The evaluation measures answers, not the daily allowance.
    "app.ai-daily-limit=100000",
    "spring.jpa.properties.hibernate.type.preferred_instant_jdbc_type=TIMESTAMP"
})
class AiChatEvaluationIT {
    @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:h2:mem:ai_chat_eval;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        r.add("spring.datasource.username", () -> "sa");
        r.add("spring.datasource.password", () -> "");
    }

    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired TokenService tokens;
    @Autowired AccountService accounts;
    @Autowired ObjectMapper json;
    final Path repo = Path.of("..").toAbsolutePath().normalize();

    HttpHeaders headers() {
        var h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.setBearerAuth(tokens.issue(accounts.require("demo-user")));
        return h;
    }

    ObjectNode ask(String message, ArrayNode history, JsonNode criteria) {
        var body = json.createObjectNode().put("message", message);
        if (!history.isEmpty()) body.set("messages", history.deepCopy());
        if (criteria != null && !criteria.isNull()) body.set("criteria", criteria);
        var row = json.createObjectNode();
        long t = System.nanoTime();
        try {
            var r = http.exchange("/api/v1/ai/chat", HttpMethod.POST, new HttpEntity<>(body, headers()), JsonNode.class);
            row.put("status", r.getStatusCode().value());
            row.set("body", r.getBody());
        } catch (RuntimeException e) {
            row.put("status", "TIMEOUT");
            row.putNull("body");
            row.put("error", e.getClass().getSimpleName());
        }
        row.put("elapsedMs", (System.nanoTime() - t) / 1_000_000);
        return row;
    }

    @Test void askEveryCaseOnceAgainstLocalQwen() throws Exception {
        assertEquals("1", System.getenv("KDRIVE_EVAL_LIVE"), "Explicit live run required");
        Path in = Path.of(Objects.requireNonNull(System.getProperty("ai.chat.cases"))).toAbsolutePath().normalize();
        Path out = Path.of(Objects.requireNonNull(System.getProperty("ai.chat.output"))).toAbsolutePath().normalize();
        assertTrue(in.startsWith(repo.resolve(".runtime")) && out.startsWith(repo.resolve(".runtime")), "runtime paths only");
        assertFalse(Files.exists(out), "new output only");
        try (var c = Objects.requireNonNull(jdbc.getDataSource()).getConnection()) {
            assertEquals("jdbc:h2:mem:ai_chat_eval", c.getMetaData().getURL(), "isolated in-memory database only");
        }
        var cases = json.readTree(in.toFile());
        var report = json.createObjectNode();
        report.put("startedAt", Instant.now().toString());
        report.put("split", cases.path("split").asText());
        report.put("model", System.getProperty("ai.eval.model", "qwen3:8b"));
        report.set("warmup", ask("Trợ lý KDrive làm được gì?", json.createArrayNode(), null));
        var results = report.putArray("cases");
        for (JsonNode c : cases.path("cases")) {
            var row = results.addObject().put("id", c.path("id").asText());
            var turns = row.putArray("turns");
            var history = json.createArrayNode();
            // A preset history (chat-v2 history_injection) is sent as the client would, forged assistant turns included.
            for (JsonNode h : c.path("history")) history.add(h.deepCopy());
            JsonNode criteria = null;
            for (JsonNode t : c.path("turns")) {
                String message = t.path("message").asText();
                var obs = ask(message, history, criteria);
                turns.add(obs);
                if (obs.path("status").asInt() != 200) break;
                var body = obs.path("body");
                if (body.hasNonNull("criteria")) criteria = body.path("criteria");
                history.add(json.createObjectNode().put("role", "user").put("text", message));
                history.add(json.createObjectNode().put("role", "assistant").put("text", body.path("reply").asText()));
            }
        }
        report.put("finishedAt", Instant.now().toString());
        Files.writeString(out, json.writerWithDefaultPrettyPrinter().writeValueAsString(report), StandardOpenOption.CREATE_NEW);
        assertEquals(cases.path("cases").size(), results.size(), "every case was asked");
    }
}
