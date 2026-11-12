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
        Nếu lịch sử cho thấy khách đang tìm xe và tin nhắn bổ sung ngày, chi nhánh, số người hoặc ngân sách thì chọn
        ASK_MISSING hoặc SEARCH_VEHICLES.
        Với SEARCH_VEHICLES/ASK_MISSING điền criteria chỉ từ tin nhắn hiện tại: ngày dạng YYYY-MM-DD chỉ khi khách ghi đủ năm;
        budgetVndTotal là tổng tiền VND cho cả chuyến; passengers gồm tài xế; tên chi nhánh chỉ lấy từ danh sách cho phép;
        giá trị không có trong tin nhắn để null; trường khách nêu nhưng còn lưỡng lự thì để null và ghi vào unresolvedFields.
        Không tự nêu giá, xe còn trống hay số tiền; hệ thống sẽ tìm xe.
        """;
    /** Fields the model may leave undecided in a vehicle-search draft. */
    public static final List<String> CRITERIA_FIELDS = List.of("pickupDate", "returnDate", "pickupBranchName",
        "returnBranchName", "passengers", "budgetVndTotal");

    /** What the text allows the model to fill: the ACTIVE branch names it mentions and the gearbox it states. */
    public record SearchHints(List<String> branchNames, String transmission) {
        public static final SearchHints NONE = new SearchHints(List.of(), null);
    }

    /** A vehicle-search draft from the current message only; the backend re-checks every value against the text. */
    public record Criteria(String pickupDate, String returnDate, String pickupBranchName, String returnBranchName,
                           Integer passengers, Long budgetVndTotal, String transmission, List<String> unresolvedFields) {}

    /** The model's answer after schema validation, before backend grounding checks. */
    public record Reply(String intent, String reply, List<String> citations, Criteria criteria, Usage usage) {
        public Reply(String intent, String reply, List<String> citations) { this(intent, reply, citations, null, null); }
        public Reply(String intent, String reply, List<String> citations, Criteria criteria) {
            this(intent, reply, citations, criteria, null);
        }
        Reply withUsage(Usage u) { return new Reply(intent, reply, citations, criteria, u); }
    }

    /**
     * R7: Ollama's own figures for one call (load, prompt evaluation, generation), in ms and tokens. Each is null
     * when the envelope does not carry it as a non-negative integer.
     */
    public record Usage(Long totalMs, Long loadMs, Long promptTokens, Long promptMs, Long outputTokens, Long outputMs) {
        static Usage from(JsonNode envelope) {
            return new Usage(nanosToMs(envelope.get("total_duration")), nanosToMs(envelope.get("load_duration")),
                count(envelope.get("prompt_eval_count")), nanosToMs(envelope.get("prompt_eval_duration")),
                count(envelope.get("eval_count")), nanosToMs(envelope.get("eval_duration")));
        }

        private static Long count(JsonNode v) {
            return v != null && v.isIntegralNumber() && v.canConvertToLong() && v.asLong() >= 0 ? v.asLong() : null;
        }

        private static Long nanosToMs(JsonNode v) {
            Long n = count(v);
            return n == null ? null : n / 1_000_000;
        }
    }

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
    static Map<String, Object> schema(List<String> passageIds) { return schema(passageIds, SearchHints.NONE); }

    /** One of two shapes: an answer with citations, or a vehicle-search turn with a criteria draft. */
    static Map<String, Object> schema(List<String> passageIds, SearchHints hints) {
        var answer = answerSchema(passageIds);
        var criteria = new LinkedHashMap<String, Object>();
        for (String date : List.of("pickupDate", "returnDate"))
            criteria.put(date, Map.of("type", List.of("string", "null"), "pattern", "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"));
        var names = new ArrayList<Object>(hints.branchNames());
        names.add(null);
        for (String branch : List.of("pickupBranchName", "returnBranchName"))
            criteria.put(branch, hints.branchNames().isEmpty() ? Map.of("type", "null")
                : Map.of("type", List.of("string", "null"), "enum", names));
        criteria.put("passengers", Map.of("type", List.of("integer", "null")));
        criteria.put("budgetVndTotal", Map.of("type", List.of("integer", "null")));
        criteria.put("transmission", hints.transmission() == null ? Map.of("type", "null")
            : Map.of("type", List.of("string", "null"), "enum", Arrays.asList(hints.transmission(), null)));
        criteria.put("unresolvedFields", Map.of("type", "array", "maxItems", CRITERIA_FIELDS.size(),
            "items", Map.of("type", "string", "enum", CRITERIA_FIELDS)));
        var search = new LinkedHashMap<String, Object>();
        search.put("intent", Map.of("type", "string", "enum", List.of("SEARCH_VEHICLES", "ASK_MISSING")));
        search.put("reply", Map.of("type", "string", "minLength", 1, "maxLength", MAX_REPLY));
        search.put("criteria", Map.of("type", "object", "properties", criteria, "required", List.copyOf(criteria.keySet()),
            "additionalProperties", false));
        return Map.of("oneOf", List.of(answer, Map.of("type", "object", "properties", search,
            "required", List.copyOf(search.keySet()), "additionalProperties", false)));
    }

    private static Map<String, Object> answerSchema(List<String> passageIds) {
        var citations = new LinkedHashMap<String, Object>();
        citations.put("type", "array");
        citations.put("maxItems", passageIds.size());
        citations.put("items", passageIds.isEmpty() ? Map.of("type", "string")
            : Map.of("type", "string", "enum", passageIds));
        var properties = new LinkedHashMap<String, Object>();
        properties.put("intent", Map.of("type", "string", "enum", List.of("ANSWER", "OUT_OF_SCOPE")));
        properties.put("reply", Map.of("type", "string", "minLength", 1, "maxLength", MAX_REPLY));
        properties.put("citations", citations);
        return Map.of("type", "object", "properties", properties, "required", List.copyOf(properties.keySet()),
            "additionalProperties", false);
    }

    public Reply ask(ChatPromptBuilder.Prompt prompt, AiRequestDeadline deadline) {
        return ask(prompt, deadline, SearchHints.NONE);
    }

    public Reply ask(ChatPromptBuilder.Prompt prompt, AiRequestDeadline deadline, SearchHints hints) {
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
                String content = "system".equals(m.role()) ? m.content() + FORMAT_RULES + branchLine(hints) : m.content();
                messages.add(Map.of("role", m.role(), "content", content));
            }
            var body = Map.of("model", model, "think", false, "stream", false, "keep_alive", "2m",
                "format", schema(prompt.passageIds(), hints),
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
            var reply = validate(json.readTree(content), prompt.passageIds(), hints).withUsage(Usage.from(envelope));
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
    static Reply validate(JsonNode node, List<String> offered) { return validate(node, offered, SearchHints.NONE); }

    static Reply validate(JsonNode node, List<String> offered, SearchHints hints) {
        if (node == null || !node.isObject() || node.size() != 3) throw unavailable();
        var intent = node.path("intent");
        var reply = node.path("reply");
        if (!intent.isTextual() || !INTENTS.contains(intent.textValue())) throw unavailable();
        if (!reply.isTextual() || reply.textValue().isBlank() || reply.textValue().length() > MAX_REPLY) throw unavailable();
        if (Set.of("SEARCH_VEHICLES", "ASK_MISSING").contains(intent.textValue())) {
            if (!node.has("criteria")) throw unavailable();
            return new Reply(intent.textValue(), reply.textValue().strip(), List.of(), criteria(node.get("criteria"), hints));
        }
        var citations = node.path("citations");
        if (!citations.isArray() || citations.size() > Math.max(4, offered.size())) throw unavailable();
        var ids = new ArrayList<String>();
        for (JsonNode c : citations) {
            if (!c.isTextual() || c.textValue().isBlank() || c.textValue().length() > 10) throw unavailable();
            if (!ids.contains(c.textValue())) ids.add(c.textValue());
        }
        return new Reply(intent.textValue(), reply.textValue().strip(), List.copyOf(ids));
    }

    private static String branchLine(SearchHints hints) {
        return hints.branchNames().isEmpty() ? "Tin nhắn không nêu chi nhánh đang hoạt động nào; để tên chi nhánh là null.\n"
            : "Chi nhánh cho phép: " + String.join("; ", hints.branchNames()) + ".\n";
    }

    /**
     * Strict types; values the schema allows but the business does not (party size, budget, dates out of order,
     * names not offered) become null so the backend asks for them again.
     */
    static Criteria criteria(JsonNode c, SearchHints hints) {
        var keys = List.of("pickupDate", "returnDate", "pickupBranchName", "returnBranchName", "passengers",
            "budgetVndTotal", "transmission", "unresolvedFields");
        if (c == null || !c.isObject() || c.size() != keys.size()) throw unavailable();
        for (String k : keys) if (!c.has(k)) throw unavailable();
        String start = isoDate(c.get("pickupDate")), end = isoDate(c.get("returnDate"));
        if (start != null && end != null && end.compareTo(start) <= 0) { start = null; end = null; }
        Integer people = null;
        var p = c.get("passengers");
        if (!p.isNull()) {
            if (!p.isIntegralNumber()) throw unavailable();
            if (p.asLong() >= 2 && p.asLong() <= 9) people = p.asInt();
        }
        Long budget = null;
        var b = c.get("budgetVndTotal");
        if (!b.isNull()) {
            if (!b.isIntegralNumber()) throw unavailable();
            if (b.asLong() >= 0 && b.asLong() <= 9007199254740991L) budget = b.asLong();
        }
        String gearbox = text(c.get("transmission"));
        if (gearbox != null && !gearbox.equals(hints.transmission())) gearbox = null;
        var unresolved = new ArrayList<String>();
        var u = c.get("unresolvedFields");
        if (!u.isArray() || u.size() > CRITERIA_FIELDS.size()) throw unavailable();
        for (JsonNode f : u) {
            if (!f.isTextual() || !CRITERIA_FIELDS.contains(f.textValue())) throw unavailable();
            if (!unresolved.contains(f.textValue())) unresolved.add(f.textValue());
        }
        return new Criteria(start, end, branch(c.get("pickupBranchName"), hints), branch(c.get("returnBranchName"), hints),
            people, budget, gearbox, List.copyOf(unresolved));
    }

    private static String text(JsonNode v) {
        if (v.isNull()) return null;
        if (!v.isTextual()) throw unavailable();
        return v.textValue();
    }

    private static String branch(JsonNode v, SearchHints hints) {
        String name = text(v);
        return name != null && hints.branchNames().contains(name) ? name : null;
    }

    private static String isoDate(JsonNode v) {
        String s = text(v);
        if (s == null) return null;
        try { return java.time.LocalDate.parse(s).toString(); } catch (java.time.format.DateTimeParseException e) { return null; }
    }

    private static DomainException unavailable() {
        return new DomainException(HttpStatus.SERVICE_UNAVAILABLE, "Trợ lý chưa trả lời được lúc này; vui lòng thử lại sau.");
    }
}
