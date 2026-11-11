package com.carrental.modules.ai.knowledge;

import java.text.Normalizer;
import java.util.*;
import org.springframework.stereotype.Component;

/**
 * Picks the approved passages relevant to a customer question, deterministically and without a model.
 * Vietnamese text is folded (no diacritics, đ→d, lower case) and split into syllables; features are content
 * syllables plus adjacent syllable pairs, weighted by IDF over the entries' sample questions. An entry scores
 * the share of the question's weight that its sample questions cover (its answer text counts at
 * {@value #ANSWER_WEIGHT}). Words the knowledge never uses still count in the total, so an unrelated question
 * cannot reach the threshold through one incidental word. Only ANSWER entries are retrievable; refusal
 * replies (group G) are fixed rules in the system prompt.
 *
 * <p>Parameters were tuned on a development set and then frozen before a held-out measurement (C2.2).
 */
@Component
public class KnowledgeRetriever {
    public static final int TOP_K = 4;
    static final double ANSWER_WEIGHT = 0.3;
    static final double THRESHOLD = 0.2;
    static final double RELATIVE = 0.5;
    private static final Set<String> STOP = Set.of((
        "toi ban minh co khong the nao la gi duoc thi sao cua va o khi nhu cho oi a nhe voi mot nhung cac de "
        + "vay ai chu roi nay do kia hay hoac neu ma lam can phai se da dang muon nhieu bao lau").split(" "));

    public record Match(KnowledgeBase.Entry entry, double score) {}

    private final List<KnowledgeBase.Entry> entries;
    private final Map<String, Set<String>> questionFeatures = new HashMap<>();
    private final Map<String, Set<String>> answerFeatures = new HashMap<>();
    private final Map<String, Integer> documentFrequency = new HashMap<>();

    public KnowledgeRetriever(KnowledgeBase knowledge) {
        entries = knowledge.entries().stream().filter(e -> e.kind() == KnowledgeBase.Kind.ANSWER).toList();
        for (var e : entries) {
            var q = new HashSet<String>();
            e.questions().forEach(text -> q.addAll(features(text)));
            questionFeatures.put(e.id(), q);
            answerFeatures.put(e.id(), features(e.answer()));
            q.forEach(f -> documentFrequency.merge(f, 1, Integer::sum));
        }
    }

    /** At most {@link #TOP_K} passages, best first; empty when nothing in the knowledge is relevant. */
    public List<Match> retrieve(String text) {
        var query = features(text == null ? "" : text);
        double total = 0;
        for (String f : query) total += idf(f);
        if (total == 0) return List.of();
        var scored = new ArrayList<Match>();
        for (var e : entries) {
            var q = questionFeatures.get(e.id());
            var a = answerFeatures.get(e.id());
            double s = 0;
            for (String f : query) {
                if (q.contains(f)) s += idf(f);
                else if (a.contains(f)) s += ANSWER_WEIGHT * idf(f);
            }
            scored.add(new Match(e, s / total));
        }
        scored.sort(Comparator.comparingDouble(Match::score).reversed().thenComparing(m -> m.entry().id()));
        double best = scored.get(0).score();
        if (best < THRESHOLD) return List.of();
        double floor = Math.max(THRESHOLD, best * RELATIVE);
        return scored.stream().limit(TOP_K).filter(m -> m.score() >= floor).toList();
    }

    private double idf(String feature) {
        return Math.log((entries.size() + 1) / (documentFrequency.getOrDefault(feature, 0) + 0.5));
    }

    /** Folded syllables: "Đặt cọc?" → [dat, coc]. */
    static List<String> syllables(String text) {
        String folded = Normalizer.normalize(text.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
            .replace('đ', 'd').replaceAll("\\p{M}", "");
        var out = new ArrayList<String>();
        for (String w : folded.split("[^a-z0-9]+")) if (!w.isEmpty()) out.add(w);
        return out;
    }

    static Set<String> features(String text) {
        var t = syllables(text);
        var f = new LinkedHashSet<String>();
        for (String w : t) if (!STOP.contains(w) && w.length() > 1) f.add(w);
        for (int i = 0; i + 1 < t.size(); i++) {
            if (STOP.contains(t.get(i)) && STOP.contains(t.get(i + 1))) continue;
            f.add(t.get(i) + "_" + t.get(i + 1));
        }
        return f;
    }
}
