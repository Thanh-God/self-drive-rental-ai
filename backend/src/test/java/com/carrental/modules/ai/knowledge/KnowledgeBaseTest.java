package com.carrental.modules.ai.knowledge;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class KnowledgeBaseTest {
    final ObjectMapper json = new ObjectMapper();

    @Test
    void approvedFileLoadsEveryGroupAThroughHWithSampleHotline() {
        var kb = new KnowledgeBase(json);
        assertEquals("2026-11-12-v2", kb.version());
        assertEquals("2026-11-11", kb.approvedOn().toString());
        assertEquals(37, kb.entries().size());
        Map<String, Long> perGroup = kb.entries().stream()
            .collect(Collectors.groupingBy(KnowledgeBase.Entry::group, TreeMap::new, Collectors.counting()));
        assertEquals(Map.of("A", 4L, "B", 7L, "C", 4L, "D", 6L, "E", 2L, "F", 3L, "G", 3L, "H", 8L), perGroup);
        assertEquals("10008888", kb.hotline());
        assertTrue(kb.hotlineSample());
        assertTrue(kb.fallbackReply().contains("10008888 (số mẫu"));
        assertEquals(List.of("K-B07", "K-D05", "K-E02"),
            kb.entries().stream().filter(KnowledgeBase.Entry::experimental).map(KnowledgeBase.Entry::id).toList());
        assertEquals(List.of("K-G01", "K-G02", "K-G03"), kb.entries().stream()
            .filter(e -> e.kind() == KnowledgeBase.Kind.REFUSAL).map(KnowledgeBase.Entry::id).toList());
        for (var e : kb.entries()) {
            assertTrue(e.questions().size() >= 2, e.id());
            assertFalse(e.sources().isEmpty(), e.id());
            for (String internal : List.of("PLAN-CHAT", "DRAFT", ".runtime", "D3 chưa"))
                assertFalse((e.answer() + e.sources()).contains(internal), e.id() + " leaks internal reference " + internal);
        }
        // Approved wording is carried over unchanged.
        assertTrue(kb.find("K-B04").orElseThrow().answer().startsWith("Yêu cầu thuê được giữ lịch tối đa 2 giờ"));
        assertTrue(kb.find("K-H02").orElseThrow().answer().contains("50% nhiên liệu"));
        assertTrue(kb.find("K-X01").isEmpty());
        assertTrue(kb.contentHash().matches("[0-9a-f]{64}"));
    }

    ObjectNode valid() {
        ObjectNode root = json.createObjectNode();
        root.put("version", "test-v1").put("approvedOn", "2026-11-11").put("fallbackReply", "Gọi hotline 10008888 (số mẫu).");
        root.putObject("hotline").put("number", "10008888").put("sample", true);
        ArrayNode entries = root.putArray("entries");
        entries.add(entry("K-A01", "A"));
        entries.add(entry("K-B01", "B"));
        return root;
    }

    ObjectNode entry(String id, String group) {
        ObjectNode e = json.createObjectNode();
        e.put("id", id).put("group", group).put("kind", "ANSWER").put("status", "APPROVED").put("experimental", false);
        e.putArray("questions").add("Câu hỏi?").add("Hỏi cách khác?");
        e.put("answer", "Trả lời.");
        e.putArray("sources").add("docs/x.md");
        return e;
    }

    byte[] bytes(ObjectNode root) { return root.toString().getBytes(StandardCharsets.UTF_8); }

    String rejected(Consumer<ObjectNode> change) {
        var root = valid();
        change.accept(root);
        return assertThrows(IllegalStateException.class, () -> new KnowledgeBase(json, bytes(root))).getMessage();
    }

    ObjectNode first(ObjectNode root) { return (ObjectNode) root.path("entries").get(0); }

    @Test
    void validFixtureLoads() {
        assertEquals(2, new KnowledgeBase(json, bytes(valid())).entries().size());
    }

    @Test
    void draftEntriesAreSkippedAndAFileWithoutApprovedEntriesIsRejected() {
        var root = valid();
        first(root).put("status", "DRAFT");
        var kb = new KnowledgeBase(json, bytes(root));
        assertEquals(List.of("K-B01"), kb.entries().stream().map(KnowledgeBase.Entry::id).toList());
        assertTrue(kb.find("K-A01").isEmpty());
        assertTrue(rejected(r -> r.path("entries").forEach(e -> ((ObjectNode) e).put("status", "DRAFT"))).contains("không có mục APPROVED"));
    }

    @Test
    void duplicateMalformedOrMismatchedIdsAreRejected() {
        assertTrue(rejected(r -> ((ArrayNode) r.path("entries")).add(entry("K-A01", "A"))).contains("ID trùng K-A01"));
        assertTrue(rejected(r -> first(r).put("id", "A01")).contains("không đúng dạng"));
        assertTrue(rejected(r -> first(r).put("id", "K-Z01")).contains("không đúng dạng"));
        assertTrue(rejected(r -> first(r).put("group", "B")).contains("không khớp ID"));
    }

    @Test
    void missingOrEmptyRequiredFieldsAreRejected() {
        for (String field : List.of("id", "group", "kind", "status", "answer"))
            assertTrue(rejected(r -> first(r).remove(field)).contains("thiếu " + field), field);
        assertTrue(rejected(r -> first(r).put("answer", "   ")).contains("thiếu answer"));
        assertTrue(rejected(r -> first(r).putArray("questions")).contains("thiếu questions"));
        assertTrue(rejected(r -> first(r).putArray("sources").add("")).contains("phần tử rỗng"));
        assertTrue(rejected(r -> first(r).remove("experimental")).contains("experimental"));
        assertTrue(rejected(r -> r.remove("version")).contains("thiếu version"));
        assertTrue(rejected(r -> r.put("approvedOn", "11/11/2026")).contains("approvedOn"));
        assertTrue(rejected(r -> r.remove("fallbackReply")).contains("thiếu fallbackReply"));
        assertTrue(rejected(r -> r.putArray("entries")).contains("entries"));
        assertTrue(rejected(r -> first(r).put("answer", "x".repeat(1201))).contains("dài quá"));
    }

    @Test
    void unknownKindOrStatusIsRejected() {
        assertTrue(rejected(r -> first(r).put("kind", "PROMPT")).contains("kind lạ"));
        assertTrue(rejected(r -> first(r).put("status", "ĐỀ XUẤT")).contains("status lạ"));
    }

    @Test
    void aSampleHotlineMustBeLabelledAsSampleEverywhere() {
        assertTrue(rejected(r -> first(r).put("answer", "Gọi hotline 10008888.")).contains("không ghi là số mẫu"));
        assertTrue(rejected(r -> r.put("fallbackReply", "Gọi 10008888.")).contains("fallbackReply"));
        assertTrue(rejected(r -> ((ObjectNode) r.path("hotline")).put("number", "1000-8888")).contains("chữ số"));
        assertTrue(rejected(r -> ((ObjectNode) r.path("hotline")).put("sample", "yes")).contains("hotline.sample"));
        // A real (non-sample) number needs no label.
        var real = valid();
        ((ObjectNode) real.path("hotline")).put("sample", false);
        first(real).put("answer", "Gọi hotline 10008888.");
        assertFalse(new KnowledgeBase(json, bytes(real)).hotlineSample());
    }

    @Test
    void brokenJsonIsRejected() {
        var message = assertThrows(IllegalStateException.class,
            () -> new KnowledgeBase(json, "{\"version\":".getBytes(StandardCharsets.UTF_8))).getMessage();
        assertTrue(message.contains("không đọc được JSON"));
        assertThrows(IllegalStateException.class, () -> new KnowledgeBase(json, "[]".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void contentHashIsStableAndChangesWithContent() {
        byte[] a = bytes(valid());
        assertEquals(new KnowledgeBase(json, a).contentHash(), new KnowledgeBase(json, a.clone()).contentHash());
        var changed = valid();
        first(changed).put("answer", "Trả lời khác.");
        assertNotEquals(new KnowledgeBase(json, a).contentHash(), new KnowledgeBase(json, bytes(changed)).contentHash());
    }
}
