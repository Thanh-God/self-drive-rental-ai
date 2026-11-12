package com.carrental.modules.ai.chat;

import java.util.ArrayDeque;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * R7 (REVIEW #17): where the time of one chat question goes. Durations, counts and the outcome label only; never the
 * question, the reply, criteria values or who asked. One log line per question, and the most recent records in memory
 * for tests and the evaluation runner.
 */
@Component
public class ChatTimings {
    static final int KEPT = 200;
    private static final Logger LOGGER = LoggerFactory.getLogger(ChatTimings.class);

    /**
     * One question. {@code intent} is null when the request ended in an error ({@code status} then says which);
     * {@code modelMs}, {@code usage} and {@code searchMs} are null when that stage did not run.
     */
    public record Timing(String intent, int status, boolean modelCalled, boolean answeredWithoutModel, long retrieveMs,
                         Long branchesMs, int branchReads, Long modelMs, QwenChatModel.Usage usage, Long searchMs,
                         long totalMs) {}

    private final ArrayDeque<Timing> recent = new ArrayDeque<>();

    public void add(Timing t) {
        synchronized (recent) {
            if (recent.size() == KEPT) recent.removeFirst();
            recent.addLast(t);
        }
        var u = t.usage();
        LOGGER.info("ai_chat_timing intent={} status={} model_called={} without_model={} retrieve_ms={} branches_ms={} "
                + "branch_reads={} model_ms={} ollama_total_ms={} ollama_load_ms={} prompt_tokens={} prompt_ms={} "
                + "output_tokens={} output_ms={} search_ms={} total_ms={}",
            t.intent(), t.status(), t.modelCalled(), t.answeredWithoutModel(), t.retrieveMs(), t.branchesMs(),
            t.branchReads(), t.modelMs(), u == null ? null : u.totalMs(), u == null ? null : u.loadMs(),
            u == null ? null : u.promptTokens(), u == null ? null : u.promptMs(), u == null ? null : u.outputTokens(),
            u == null ? null : u.outputMs(), t.searchMs(), t.totalMs());
    }

    /** Oldest first. */
    public List<Timing> recent() {
        synchronized (recent) { return List.copyOf(recent); }
    }

    /** Collects one question's stages; not thread-safe, one per request. */
    static final class Clock {
        private final long started = System.nanoTime();
        long retrieveNanos;
        Long branchesNanos;
        int branchReads;
        Long modelNanos;
        QwenChatModel.Usage usage;
        Long searchNanos;
        boolean modelCalled;
        boolean answeredWithoutModel;

        static long since(long start) { return System.nanoTime() - start; }

        Timing finish(String intent, int status) {
            return new Timing(intent, status, modelCalled, answeredWithoutModel, ms(retrieveNanos), ms(branchesNanos),
                branchReads, ms(modelNanos), usage, ms(searchNanos), ms(since(started)));
        }

        private static Long ms(Long nanos) { return nanos == null ? null : Math.max(0, nanos) / 1_000_000; }
        private static long ms(long nanos) { return Math.max(0, nanos) / 1_000_000; }
    }
}
