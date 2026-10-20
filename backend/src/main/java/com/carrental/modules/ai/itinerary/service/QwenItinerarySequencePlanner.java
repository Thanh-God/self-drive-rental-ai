package com.carrental.modules.ai.itinerary.service;

import com.carrental.exception.DomainException;
import com.carrental.modules.ai.LocalHttp;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class QwenItinerarySequencePlanner {
    private final ObjectMapper json;
    private final URI endpoint;
    private final Duration timeout;
    private final String model;
    private final boolean enabled;
    private final java.util.concurrent.Semaphore capacity = new java.util.concurrent.Semaphore(1);
    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(2))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

    public record Candidate(String id, String name, String categoryName) {}
    public record SequenceResult(List<String> orderedLocationIds, String reasonCode) {}

    @org.springframework.beans.factory.annotation.Autowired
    public QwenItinerarySequencePlanner(
            ObjectMapper mapper,
            @Value("${app.qwen-model:qwen3:8b}") String model,
            @Value("${app.qwen-parser-enabled:false}") boolean enabled) {
        this(mapper, URI.create("http://127.0.0.1:11434/api/chat"), Duration.ofSeconds(60), model, enabled);
    }

    QwenItinerarySequencePlanner(ObjectMapper mapper, URI endpoint, Duration timeout, String model, boolean enabled) {
        if (!Set.of("qwen3:8b", "qwen3:4b").contains(model)) {
            throw new IllegalArgumentException("Chỉ hỗ trợ Qwen3 cục bộ 4B/8B.");
        }
        this.model = model;
        if (!"http".equals(endpoint.getScheme()) || !"127.0.0.1".equals(endpoint.getHost())
                || endpoint.getUserInfo() != null || endpoint.getQuery() != null || endpoint.getFragment() != null) {
            throw new IllegalArgumentException("Qwen chỉ được chạy trên loopback.");
        }
        this.endpoint = endpoint;
        this.timeout = timeout;
        this.enabled = enabled;
        this.json = mapper.copy().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
    }

    public SequenceResult planSequence(String startId, List<Candidate> candidates, int targetCount) {
        if (candidates == null || candidates.isEmpty()) {
            throw DomainException.bad("Danh sách địa điểm ứng viên không được để trống.");
        }
        if (candidates.stream().noneMatch(c -> c.id().equals(startId))) {
            throw DomainException.bad("Điểm bắt đầu phải nằm trong danh sách ứng viên.");
        }

        // Nếu Qwen không được bật hoặc gặp sự cố, thực hiện sắp xếp suy diễn tất định (Deterministic fallback)
        if (!enabled) {
            return deterministicPlan(startId, candidates, targetCount);
        }

        if (!capacity.tryAcquire()) {
            // Khi đang tải cao, fallback sang thuật toán nội bộ để không chặn preview của người dùng
            return deterministicPlan(startId, candidates, targetCount);
        }

        try {
            var candidateIds = candidates.stream().map(Candidate::id).toList();
            var properties = new LinkedHashMap<String, Object>();
            properties.put("orderedLocationIds", Map.of(
                "type", "array",
                "items", Map.of("type", "string", "enum", candidateIds),
                "minItems", Math.min(2, candidates.size()),
                "maxItems", Math.min(4, candidates.size())
            ));
            properties.put("reasonCode", Map.of("type", "string", "maxLength", 50));
            var schema = Map.of(
                "type", "object",
                "properties", properties,
                "additionalProperties", false,
                "required", List.of("orderedLocationIds", "reasonCode")
            );

            var candidateText = candidates.stream()
                .map(c -> String.format("- ID: %s | Tên: %s | Loại: %s", c.id(), c.name(), c.categoryName()))
                .reduce("", (a, b) -> a + "\n" + b);

            var prompt = String.format(
                "Hãy chọn một chuỗi gồm %d địa điểm từ danh sách ứng viên sau, bắt đầu tại ID '%s'.\n" +
                "Chỉ trả về JSON tuân thủ schema, không thêm giải thích ngoài JSON.\nDanh sách ứng viên:\n%s",
                Math.min(targetCount, candidates.size()), startId, candidateText
            );

            var body = Map.of(
                "model", model,
                "think", false,
                "stream", false,
                "keep_alive", "2m",
                "format", schema,
                "options", Map.of("num_ctx", 4096, "num_predict", 512, "temperature", 0.1),
                "messages", List.of(
                    Map.of("role", "system", "content", "You are an itinerary sequence planner for Da Nang - Hoi An. Select 2-4 location IDs starting strictly with the chosen start ID. Return JSON only."),
                    Map.of("role", "user", "content", prompt)
                )
            );

            var request = HttpRequest.newBuilder(endpoint)
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build();

            var response = LocalHttp.send(client, request, timeout, 16384);
            if (response.status() != 200) {
                return deterministicPlan(startId, candidates, targetCount);
            }

            var envelope = json.readTree(response.body());
            var message = envelope.path("message");
            if (!envelope.path("done").asBoolean() || !"assistant".equals(message.path("role").asText())) {
                return deterministicPlan(startId, candidates, targetCount);
            }

            String content = message.path("content").textValue();
            var node = json.readTree(content);
            List<String> ids = new ArrayList<>();
            for (var elem : node.path("orderedLocationIds")) {
                ids.add(elem.asText());
            }

            // Kiểm tra tính hợp lệ nghiêm ngặt:
            // 1. Phải bắt đầu bằng startId
            // 2. Không được có ID trùng lặp
            // 3. Toàn bộ ID phải thuộc candidate pool
            // 4. Số lượng từ 2 đến 4
            if (ids.size() >= 2 && ids.size() <= 4 && ids.get(0).equals(startId)
                    && new HashSet<>(ids).size() == ids.size()
                    && candidateIds.containsAll(ids)) {
                return new SequenceResult(ids, node.path("reasonCode").asText("QWEN_OPTIMIZED"));
            }

            return deterministicPlan(startId, candidates, targetCount);
        } catch (Exception e) {
            return deterministicPlan(startId, candidates, targetCount);
        } finally {
            capacity.release();
        }
    }

    private SequenceResult deterministicPlan(String startId, List<Candidate> candidates, int targetCount) {
        List<String> list = new ArrayList<>();
        list.add(startId);
        for (Candidate c : candidates) {
            if (!c.id().equals(startId) && list.size() < targetCount) {
                list.add(c.id());
            }
        }
        return new SequenceResult(list, "DETERMINISTIC_FALLBACK");
    }
}
