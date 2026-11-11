package com.carrental.modules.ai.chat;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.AiDiagnostics;
import com.carrental.modules.ai.AiProviderCapacity;
import com.carrental.modules.ai.AiProviderCapacity.Provider;
import com.carrental.modules.ai.AiRequestDeadline;
import com.carrental.modules.ai.LocalHttp;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Local Qwen for the KDrive chat, loopback only. Returns the model's structured reply exactly as validated
 * against the schema; grounding and safety checks happen in {@link ChatService}. Enabled with the same flag
 * as the other local Qwen features.
 */
@Component
@ConditionalOnProperty(name = "app.qwen-parser-enabled", havingValue = "true")
public class QwenChatModel {
    public static final int MAX_REPLY = 800;
    public static final List<String> INTENTS = List.of("ANSWER", "SEARCH_VEHICLES", "ASK_MISSING", "OUT_OF_SCOPE");
    static final String FORMAT_RULES = """

        Chọn intent: ANSWER khi trả lời câu hỏi về KDrive (kể cả khi trả lời đúng câu "chưa có thông tin");
        SEARCH_VEHICLES khi khách muốn tìm/gợi ý xe và đã nêu nhu cầu; ASK_MISSING khi khách muốn tìm xe nhưng còn thiếu
        ngày nhận/trả, điểm nhận/trả, số người hoặc ngân sách (reply hỏi phần còn thiếu); OUT_OF_SCOPE khi không liên quan KDrive.
        citations chỉ gồm ID đoạn kiến thức đã dùng; để [] nếu không dùng đoạn nào.
        """;

    /** The model's answer after schema validation, before backend grounding checks. */
    public record Reply(String intent, String reply, List<String> citations) {}

    private final ObjectMapper json;
    private final URI endpoint;
    private final Duration timeout;
    private final String model;
    private final AiProviderCapacity capacity;
    private final AiDiagnostics diagnostics;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NEVER).build();

    @Autowired
    public QwenChatModel(ObjectMapper mapper, @Value("${app.qwen-model:qwen3:8b}") String model,
                         ObjectProvider<AiProviderCapacity> capacity, AiDiagnostics diagnostics) {
        this(mapper, URI.create("http://127.0.0.1:11434/api/chat"), Duration.ofSeconds(60), model,
            capacity.getIfAvailable(AiProviderCapacity::new), diagnostics);
    }

    public QwenChatModel(ObjectMapper mapper, URI endpoint, Duration timeout, String model,
                         AiProviderCapacity capacity, AiDiagnostics diagnostics) {
        if (!Set.of("qwen3:8b", "qwen3:4b").contains(model)) throw new IllegalArgumentException("Chỉ hỗ trợ Qwen3 cục bộ 4B/8B.");
        if (!"http".equals(endpoint.getScheme()) || !"127.0.0.1".equals(endpoint.getHost())
            || endpoint.getUserInfo() != null || endpoint.getQuery() != null || endpoint.getFragment() != null)
            throw new IllegalArgumentException("Qwen chỉ được chạy trên loopback.");
        this.model = model;
        this.endpoint = endpoint;
        this.timeout = timeout;
        this.capacity = capacity;
        this.diagnostics = diagnostics;
        this.json = mapper.copy().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    public String model() { return model; }

    /** Response schema: citations can only name the passages offered in this prompt. */
    static Map<String, Object> schema(List<String> passageIds) {
        var citations = new LinkedHashMap<String, Object>();
        citations.put("type", "array");
        citations.put("maxItems", passageIds.size());
        citations.put("items", passageIds.isEmpty() ? Map.of("type", "string")
            : Map.of("type", "string", "enum", passageIds));
        var properties = new LinkedHashMap<String, Object>();
        properties.put("intent", Map.of("type", "string", "enum", INTENTS));
        properties.put("reply", Map.of("type", "string", "minLength", 1, "maxLength", MAX_REPLY));
        properties.put("citations", citations);
        return Map.of("type", "object", "properties", properties, "required", List.copyOf(properties.keySet()),
            "additionalProperties", false);
    }

    public Reply ask(ChatPromptBuilder.Prompt prompt, AiRequestDeadline deadline) {
        try {
            deadline.requireRemaining();
        } catch (AiRequestDeadline.DeadlineExceededException error) {
            diagnostics.record(deadline.operation(), AiDiagnostics.Provider.QWEN, model, AiDiagnostics.Cause.DEADLINE, deadline.elapsedNanos());
            throw unavailable();
        }
        AiProviderCapacity.Permit permit;
        try {
            permit = capacity.acquire(Provider.QWEN);
        } catch (AiProviderCapacity.CapacityExceededException error) {
            diagnostics.record(deadline.operation(), AiDiagnostics.Provider.QWEN, model, AiDiagnostics.Cause.CAPACITY, deadline.elapsedNanos());
            throw new DomainException(HttpStatus.TOO_MANY_REQUESTS, "Trợ lý đang trả lời câu hỏi khác; vui lòng thử lại.");
        }
        AiDiagnostics.Cause cause = AiDiagnostics.Cause.UNKNOWN;
        try (permit) {
            var messages = new ArrayList<Map<String, String>>();
            for (var m : prompt.messages()) {
                String content = "system".equals(m.role()) ? m.content() + FORMAT_RULES : m.content();
                messages.add(Map.of("role", m.role(), "content", content));
            }
            var body = Map.of("model", model, "think", false, "stream", false, "keep_alive", "2m",
                "format", schema(prompt.passageIds()),
                "options", Map.of("num_ctx", 4096, "num_predict", 512, "temperature", 0.1),
                "messages", messages);
            var request = HttpRequest.newBuilder(endpoint).timeout(deadline.timeoutFor(timeout))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
            deadline.requireRemaining();
            var response = LocalHttp.send(client, request, timeout, 32768, deadline);
            if (response.status() != 200) {
                cause = AiDiagnostics.Cause.PROVIDER_HTTP;
                throw unavailable();
            }
            cause = AiDiagnostics.Cause.ENVELOPE_INVALID;
            var envelope = json.readTree(response.body());
            var message = envelope.path("message");
            if (!envelope.path("done").asBoolean() || !"stop".equals(envelope.path("done_reason").asText())
                || !"assistant".equals(message.path("role").asText()) || message.has("tool_calls")
                || !message.path("content").isTextual()) throw unavailable();
            String content = message.path("content").textValue();
            if (content.length() > 8192) throw unavailable();
            cause = AiDiagnostics.Cause.SCHEMA_INVALID;
            var reply = validate(json.readTree(content), prompt.passageIds());
            deadline.requireRemaining();
            cause = AiDiagnostics.Cause.SUCCESS;
            return reply;
        } catch (DomainException error) {
            throw error;
        } catch (InterruptedException error) {
            cause = AiDiagnostics.Cause.INTERRUPTED;
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (Exception error) {
            var transport = AiDiagnostics.transportCause(error);
            if (transport != AiDiagnostics.Cause.UNKNOWN) cause = transport;
            throw unavailable();
        } finally {
            diagnostics.record(deadline.operation(), AiDiagnostics.Provider.QWEN, model, cause, deadline.elapsedNanos());
        }
    }

    /**
     * Strict shape check. Citations outside the offered passages are kept here so that {@link ChatService}
     * can record that the model tried to cite something it was not given.
     */
    static Reply validate(JsonNode node, List<String> offered) {
        if (node == null || !node.isObject() || node.size() != 3) throw unavailable();
        var intent = node.path("intent");
        var reply = node.path("reply");
        var citations = node.path("citations");
        if (!intent.isTextual() || !INTENTS.contains(intent.textValue())) throw unavailable();
        if (!reply.isTextual() || reply.textValue().isBlank() || reply.textValue().length() > MAX_REPLY) throw unavailable();
        if (!citations.isArray() || citations.size() > Math.max(4, offered.size())) throw unavailable();
        var ids = new ArrayList<String>();
        for (JsonNode c : citations) {
            if (!c.isTextual() || c.textValue().isBlank() || c.textValue().length() > 10) throw unavailable();
            if (!ids.contains(c.textValue())) ids.add(c.textValue());
        }
        return new Reply(intent.textValue(), reply.textValue().strip(), List.copyOf(ids));
    }

    private static DomainException unavailable() {
        return new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "Trợ lý chưa trả lời được lúc này; vui lòng thử lại sau.");
    }
}
