package com.carrental.modules.ai.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The approved KDrive knowledge the assistant may answer from, loaded once from
 * {@code classpath:ai/kdrive-knowledge.json}. An invalid file stops startup: the assistant must never run
 * on knowledge that has not passed these checks. Only APPROVED entries are kept; DRAFT entries are skipped.
 */
@Component
public class KnowledgeBase {
    public static final String RESOURCE = "ai/kdrive-knowledge.json";
    private static final Pattern ID = Pattern.compile("K-([A-H])(\\d{2})");
    private static final Pattern HOTLINE = Pattern.compile("[0-9]{3,20}");
    private static final Set<String> KINDS = Set.of("ANSWER", "REFUSAL");
    private static final Set<String> STATUSES = Set.of("APPROVED", "DRAFT");
    private static final int MAX_ANSWER = 1200;
    private static final int MAX_QUESTION = 300;

    public enum Kind { ANSWER, REFUSAL }

    /** One approved entry. {@code questions} are sample phrasings used to find the entry, not content. */
    public record Entry(String id, String group, Kind kind, boolean experimental, List<String> questions,
                        String answer, List<String> sources) {}

    private final String version;
    private final LocalDate approvedOn;
    private final String hotline;
    private final boolean hotlineSample;
    private final String fallbackReply;
    private final List<Entry> entries;
    private final Map<String, Entry> byId;
    private final String contentHash;

    @Autowired
    public KnowledgeBase(ObjectMapper json) {
        this(json, read());
    }

    public KnowledgeBase(ObjectMapper json, byte[] content) {
        JsonNode root;
        try {
            root = json.readTree(content);
        } catch (IOException e) {
            throw invalid("không đọc được JSON");
        }
        if (root == null || !root.isObject()) throw invalid("gốc phải là object");
        version = text(root, "version", "gốc", 40);
        try {
            approvedOn = LocalDate.parse(text(root, "approvedOn", "gốc", 10));
        } catch (DateTimeParseException e) {
            throw invalid("approvedOn phải là ngày YYYY-MM-DD");
        }
        JsonNode line = root.path("hotline");
        hotline = text(line, "number", "hotline", 20);
        if (!HOTLINE.matcher(hotline).matches()) throw invalid("hotline.number chỉ gồm chữ số");
        if (!line.path("sample").isBoolean()) throw invalid("hotline.sample phải là true/false");
        hotlineSample = line.path("sample").asBoolean();
        fallbackReply = text(root, "fallbackReply", "gốc", MAX_ANSWER);
        checkHotline(fallbackReply, "fallbackReply");

        JsonNode list = root.path("entries");
        if (!list.isArray() || list.isEmpty()) throw invalid("entries phải là mảng không rỗng");
        var kept = new ArrayList<Entry>();
        var seen = new HashSet<String>();
        for (JsonNode node : list) {
            if (!node.isObject()) throw invalid("mỗi mục phải là object");
            String id = text(node, "id", "mục", 10);
            var m = ID.matcher(id);
            if (!m.matches()) throw invalid("ID " + id + " không đúng dạng K-[A-H]NN");
            if (!seen.add(id)) throw invalid("ID trùng " + id);
            String group = text(node, "group", id, 1);
            if (!group.equals(m.group(1))) throw invalid(id + " có nhóm " + group + " không khớp ID");
            String kind = text(node, "kind", id, 10);
            if (!KINDS.contains(kind)) throw invalid(id + " có kind lạ " + kind);
            String status = text(node, "status", id, 10);
            if (!STATUSES.contains(status)) throw invalid(id + " có status lạ " + status);
            if (!node.path("experimental").isBoolean()) throw invalid(id + " thiếu experimental true/false");
            List<String> questions = texts(node, "questions", id, MAX_QUESTION);
            String answer = text(node, "answer", id, MAX_ANSWER);
            List<String> sources = texts(node, "sources", id, 300);
            checkHotline(answer, id);
            if ("APPROVED".equals(status)) {
                kept.add(new Entry(id, group, Kind.valueOf(kind), node.path("experimental").asBoolean(),
                    questions, answer, sources));
            }
        }
        if (kept.isEmpty()) throw invalid("không có mục APPROVED");
        entries = List.copyOf(kept);
        var index = new LinkedHashMap<String, Entry>();
        for (Entry e : entries) index.put(e.id(), e);
        byId = Collections.unmodifiableMap(index);
        contentHash = sha256(content);
    }

    private static byte[] read() {
        try (InputStream in = KnowledgeBase.class.getClassLoader().getResourceAsStream(RESOURCE)) {
            if (in == null) throw invalid("thiếu " + RESOURCE);
            return in.readAllBytes();
        } catch (IOException e) {
            throw invalid("không đọc được " + RESOURCE);
        }
    }

    /** A sample hotline must never be presented as a real one. */
    private void checkHotline(String text, String where) {
        if (hotlineSample && text.contains(hotline) && !text.toLowerCase(Locale.ROOT).contains("mẫu"))
            throw invalid(where + " nhắc hotline " + hotline + " nhưng không ghi là số mẫu");
    }

    private static String text(JsonNode node, String field, String where, int max) {
        JsonNode v = node.path(field);
        if (!v.isTextual() || v.asText().isBlank()) throw invalid(where + " thiếu " + field);
        String s = v.asText().strip();
        if (s.length() > max) throw invalid(where + "." + field + " dài quá " + max + " ký tự");
        return s;
    }

    private static List<String> texts(JsonNode node, String field, String where, int max) {
        JsonNode v = node.path(field);
        if (!v.isArray() || v.isEmpty()) throw invalid(where + " thiếu " + field);
        var out = new ArrayList<String>();
        for (JsonNode item : v) {
            if (!item.isTextual() || item.asText().isBlank()) throw invalid(where + "." + field + " có phần tử rỗng");
            String s = item.asText().strip();
            if (s.length() > max) throw invalid(where + "." + field + " có phần tử dài quá " + max + " ký tự");
            out.add(s);
        }
        return List.copyOf(out);
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static IllegalStateException invalid(String why) {
        return new IllegalStateException("Kho kiến thức trợ lý không hợp lệ: " + why);
    }

    public String version() { return version; }
    public LocalDate approvedOn() { return approvedOn; }
    public String hotline() { return hotline; }
    public boolean hotlineSample() { return hotlineSample; }
    public String fallbackReply() { return fallbackReply; }
    public List<Entry> entries() { return entries; }
    public Optional<Entry> find(String id) { return Optional.ofNullable(byId.get(id)); }
    /** SHA-256 of the loaded file, so answers can be traced to the exact knowledge version. */
    public String contentHash() { return contentHash; }
}
