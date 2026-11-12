package com.carrental.modules.ai.knowledge;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;

/**
 * R6 (REVIEW #12): retrieval measured without a model on question sets that may be looked at — the C2.2 sets and
 * the chat-v1 knowledge questions (regression, already seen) and chat-v2 dev. chat-v2 heldout is never read here.
 * The minimums are the measured baseline before R6; a change may not lower them.
 */
class RetrievalMetricsTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final KnowledgeBase KB = new KnowledgeBase(JSON);
    static final Path EVAL = Path.of("..", "scripts", "ai", "evaluation");

    record Case(String expected, String question) {}
    record Metrics(int n, int at1, int at4, int none) {
        String line(String name) { return name + ": n=" + n + " recall@1=" + at1 + " recall@4=" + at4 + " noPassage=" + none; }
    }

    static List<Case> tsv(String name) throws IOException {
        try (var in = RetrievalMetricsTest.class.getClassLoader().getResourceAsStream("ai/retrieval/" + name)) {
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).lines().filter(l -> l.contains("\t"))
                .map(l -> l.split("\t", 2)).map(p -> new Case(p[0], p[1])).toList();
        }
    }

    /** Knowledge questions of a chat evaluation split: first turn, first expected citation. */
    static List<Case> chat(String dataset, String split) throws IOException {
        var out = new ArrayList<Case>();
        for (JsonNode c : JSON.readTree(EVAL.resolve(dataset).resolve(split + ".json").toFile()).path("cases")) {
            if (!"knowledge".equals(c.path("category").asText())) continue;
            var t = c.path("turns").get(0);
            out.add(new Case(t.path("expect").path("anyOf").get(0).path("citationsAny").get(0).asText(), t.path("message").asText()));
        }
        return out;
    }

    static Metrics measure(KnowledgeRetriever retriever, List<Case> cases) {
        int at1 = 0, at4 = 0, none = 0;
        for (var c : cases) {
            var ids = retriever.retrieve(c.question()).stream().map(m -> m.entry().id()).toList();
            if (ids.isEmpty()) none++;
            if (!ids.isEmpty() && ids.get(0).equals(c.expected())) at1++;
            if (ids.contains(c.expected())) at4++;
        }
        return new Metrics(cases.size(), at1, at4, none);
    }

    @Test
    void retrievalDoesNotFallBelowTheMeasuredBaseline() throws IOException {
        var retriever = new KnowledgeRetriever(KB);
        var sets = new LinkedHashMap<String, List<Case>>();
        sets.put("c22-dev", tsv("dev.tsv"));
        sets.put("c22-heldout(regression)", tsv("heldout.tsv"));
        var v1 = new ArrayList<Case>(chat("chat-v1", "dev"));
        v1.addAll(chat("chat-v1", "heldout"));
        sets.put("chat-v1(regression)", v1);
        sets.put("chat-v2-dev", chat("chat-v2", "dev"));
        // Minimum recall@4. Baseline at 54cf623 was 34 / 31 / 32 / 4; knowledge 2026-11-12-v2 (owner-approved sample
        // questions, R6) reaches 34 / 34 / 34 / 10 on these already-seen sets and may not fall below that.
        var baseline = Map.of("c22-dev", 34, "c22-heldout(regression)", 34, "chat-v1(regression)", 34, "chat-v2-dev", 10);
        var report = new StringBuilder();
        for (var e : sets.entrySet()) {
            var m = measure(retriever, e.getValue());
            report.append(m.line(e.getKey())).append('\n');
            assertTrue(m.at4() >= baseline.get(e.getKey()), e.getKey() + " fell below baseline: " + m);
        }
        System.out.println("R6-RETRIEVAL\n" + report);
    }

    /**
     * Report only: measures a candidate knowledge file given with -Dai.kb.candidate=<path> on the same sets, plus
     * how many off-topic questions get a passage (must stay 0). Used to show the owner the effect of new sample
     * questions before they are approved; never asserts and never reads chat-v2 heldout.
     */
    @Test
    void candidateKnowledgeReport() throws IOException {
        String path = System.getProperty("ai.kb.candidate");
        org.junit.jupiter.api.Assumptions.assumeTrue(path != null, "no candidate given");
        var candidate = new KnowledgeRetriever(new KnowledgeBase(JSON, Files.readAllBytes(Path.of(path))));
        var current = new KnowledgeRetriever(KB);
        var sets = new LinkedHashMap<String, List<Case>>();
        sets.put("c22-dev", tsv("dev.tsv"));
        sets.put("c22-heldout(regression)", tsv("heldout.tsv"));
        var v1 = new ArrayList<Case>(chat("chat-v1", "dev"));
        v1.addAll(chat("chat-v1", "heldout"));
        sets.put("chat-v1(regression)", v1);
        sets.put("chat-v2-dev", chat("chat-v2", "dev"));
        var report = new StringBuilder();
        for (var e : sets.entrySet())
            report.append("current   ").append(measure(current, e.getValue()).line(e.getKey())).append('\n')
                .append("candidate ").append(measure(candidate, e.getValue()).line(e.getKey())).append('\n');
        List<String> offTopic;
        try (var in = getClass().getClassLoader().getResourceAsStream("ai/retrieval/offtopic.txt")) {
            offTopic = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).lines().filter(l -> !l.isBlank()).toList();
        }
        long leaked = offTopic.stream().filter(q -> !candidate.retrieve(q).isEmpty()).count();
        report.append("candidate off-topic with a passage: ").append(leaked).append('/').append(offTopic.size()).append('\n');
        System.out.println("R6-CANDIDATE\n" + report);
    }
}
