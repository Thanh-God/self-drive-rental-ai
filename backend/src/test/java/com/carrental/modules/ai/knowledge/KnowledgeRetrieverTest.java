package com.carrental.modules.ai.knowledge;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * C2.2 acceptance for passage selection. The dev set was used to tune the parameters; the held-out set was
 * written and hashed before the first measurement and is not used for tuning (criterion: at least 90%).
 */
class KnowledgeRetrieverTest {
    static final KnowledgeBase KB = new KnowledgeBase(new ObjectMapper());
    final KnowledgeRetriever retriever = new KnowledgeRetriever(KB);

    record Case(String id, String text) {}

    static List<String> lines(String name) throws IOException {
        try (InputStream in = KnowledgeRetrieverTest.class.getClassLoader().getResourceAsStream("ai/retrieval/" + name)) {
            assertNotNull(in, name);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().filter(l -> !l.isBlank()).toList();
        }
    }

    static List<Case> cases(String name) throws IOException {
        return lines(name).stream().map(l -> l.split("\t", 2)).map(p -> new Case(p[0], p[1])).toList();
    }

    List<String> ids(String text) {
        return retriever.retrieve(text).stream().map(m -> m.entry().id()).toList();
    }

    @Test
    void everySampleQuestionRanksItsOwnEntryFirst() {
        for (var e : KB.entries()) {
            if (e.kind() != KnowledgeBase.Kind.ANSWER) continue;
            for (String q : e.questions()) {
                var got = ids(q);
                assertFalse(got.isEmpty(), q);
                assertEquals(e.id(), got.get(0), q);
            }
        }
    }

    @Test
    void devParaphrasesFindTheirEntryInTheTopFour() throws IOException {
        var cases = cases("dev.tsv");
        assertEquals(34, cases.size());
        for (var c : cases) assertTrue(ids(c.text()).contains(c.id()), c.id() + " " + c.text() + " -> " + ids(c.text()));
    }

    @Test
    void heldOutParaphrasesMeetTheNinetyPercentCriterion() throws IOException {
        var cases = cases("heldout.tsv");
        assertEquals(34, cases.size());
        var misses = new ArrayList<String>();
        for (var c : cases) if (!ids(c.text()).contains(c.id())) misses.add(c.id());
        int hits = cases.size() - misses.size();
        System.out.println("C2.2 held-out top-4: " + hits + "/" + cases.size() + " misses=" + misses);
        assertTrue(hits >= Math.ceil(0.9 * cases.size()), "held-out " + hits + "/" + cases.size() + " misses " + misses);
    }

    @Test
    void unrelatedQuestionsAndInjectionAttemptsGetNoPassage() throws IOException {
        var off = lines("offtopic.txt");
        assertTrue(off.size() >= 10);
        for (String q : off) assertEquals(List.of(), ids(q), q);
        for (String q : List.of("", "   ", "???", "a b c")) assertEquals(List.of(), ids(q), q);
        assertEquals(List.of(), retriever.retrieve(null));
    }

    @Test
    void refusalEntriesAreNeverRetrievedAndResultsAreBoundedAndOrdered() {
        for (var e : KB.entries()) {
            if (e.kind() != KnowledgeBase.Kind.REFUSAL) continue;
            for (String q : e.questions()) assertTrue(ids(q).stream().noneMatch(id -> id.startsWith("K-G")), q);
        }
        var got = retriever.retrieve("Hủy đơn, hoàn tiền cọc, phí tuyến và trả xe muộn thế nào?");
        assertFalse(got.isEmpty());
        assertTrue(got.size() <= KnowledgeRetriever.TOP_K);
        for (int i = 1; i < got.size(); i++) assertTrue(got.get(i - 1).score() >= got.get(i).score());
        assertTrue(got.get(got.size() - 1).score()
            >= Math.max(KnowledgeRetriever.THRESHOLD, got.get(0).score() * KnowledgeRetriever.RELATIVE));
        assertEquals(ids("Đặt cọc như thế nào?"), ids("dat coc nhu the nao"), "diacritics and case are folded");
    }

    @Test
    void foldingKeepsVietnameseSyllablesComparable() {
        assertEquals(List.of("dat", "coc", "gplx", "2025"), KnowledgeRetriever.syllables("Đặt CỌC, GPLX-2025?"));
        assertTrue(KnowledgeRetriever.features("phí tuyến").containsAll(List.of("phi", "tuyen", "phi_tuyen")));
        assertFalse(KnowledgeRetriever.features("có không").contains("co_khong"), "pairs of function words are dropped");
    }
}
