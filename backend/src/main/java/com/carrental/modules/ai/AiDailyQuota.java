package com.carrental.modules.ai;

import com.carrental.security.Actor;
import java.time.*;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Daily allowance of AI questions per USER, counted on the Vietnam calendar day (resets at 00:00
 * Asia/Ho_Chi_Minh). Kept in memory: a backend restart clears the counters (accepted for the MVP; no table).
 * A question counts only when the model actually answered; a reservation that is closed without
 * {@link Reservation#commit()} gives the slot back. Reserved slots count against the limit so concurrent
 * requests can never exceed it.
 */
@Component
public class AiDailyQuota {
    public static final ZoneId VIETNAM = ZoneId.of("Asia/Ho_Chi_Minh");

    private final int limit;
    private final String hotline;
    private final boolean hotlineSample;
    private final Clock clock;
    private final ConcurrentHashMap<String, Usage> usage = new ConcurrentHashMap<>();
    /** Last Vietnam day on which entries of earlier days were removed. */
    private LocalDate cleanedFor;

    private static final class Usage {
        LocalDate day;
        int used;
        int reserved;
    }

    /** Remaining questions for today, with the contact shown when the allowance is exhausted. */
    public record Status(int limit, int used, int remaining, Instant resetAt, String hotline, boolean hotlineSample) {}

    @Autowired
    public AiDailyQuota(
            @Value("${app.ai-daily-limit:6}") int limit,
            @Value("${app.ai-hotline:10008888}") String hotline,
            @Value("${app.ai-hotline-sample:true}") boolean hotlineSample,
            Clock clock) {
        if (limit < 0) throw new IllegalArgumentException("Hạn mức câu hỏi AI không được âm.");
        this.limit = limit;
        this.hotline = Objects.requireNonNull(hotline);
        this.hotlineSample = hotlineSample;
        this.clock = Objects.requireNonNull(clock);
    }

    /** No limit: for callers constructed outside Spring (existing unit tests, offline tools). */
    public static AiDailyQuota unlimited() {
        return new AiDailyQuota(Integer.MAX_VALUE, "10008888", true, Clock.systemUTC());
    }

    public int limit() { return limit; }

    private LocalDate today() { return LocalDate.now(clock.withZone(VIETNAM)); }

    private Instant resetAt(LocalDate day) { return day.plusDays(1).atStartOfDay(VIETNAM).toInstant(); }

    private Usage current(String userId, LocalDate day) {
        Usage u = usage.computeIfAbsent(userId, id -> new Usage());
        if (!day.equals(u.day)) {
            u.day = day;
            u.used = 0;
            u.reserved = 0;
        }
        return u;
    }

    /** Today's count. {@code remaining} also excludes questions still being answered (R5, REVIEW #15). */
    public Status status(Actor actor) {
        LocalDate day = today();
        Usage u = usage.get(actor.id());
        int used, inFlight;
        synchronized (this) {
            boolean today = u != null && day.equals(u.day);
            used = today ? u.used : 0;
            inFlight = today ? u.reserved : 0;
        }
        return new Status(limit, used, Math.max(0, limit - used - inFlight), resetAt(day), hotline, hotlineSample);
    }

    /** Number of users with an entry kept in memory (for tests). */
    int trackedUsers() { return usage.size(); }

    /** Once per Vietnam day, forget users whose entry belongs to an earlier day and has nothing in flight. */
    private void forgetEarlierDays(LocalDate day) {
        if (day.equals(cleanedFor)) return;
        usage.entrySet().removeIf(e -> !day.equals(e.getValue().day) && e.getValue().reserved == 0);
        cleanedFor = day;
    }

    /**
     * Holds one question for {@code actor}. Throws {@link AiQuotaExceededException} (429) when today's
     * allowance, including questions still in flight, is used up.
     */
    public Reservation reserve(Actor actor) {
        LocalDate day = today();
        synchronized (this) {
            forgetEarlierDays(day);
            Usage u = current(actor.id(), day);
            if (u.used + u.reserved >= limit) {
                throw new AiQuotaExceededException(new Status(limit, u.used, 0, resetAt(day), hotline, hotlineSample));
            }
            u.reserved++;
            return new Reservation(actor.id(), day);
        }
    }

    /** One held question. Commit when the model answered; close without commit to give it back. */
    public final class Reservation implements AutoCloseable {
        private final String userId;
        private final LocalDate day;
        private boolean finished;

        private Reservation(String userId, LocalDate day) {
            this.userId = userId;
            this.day = day;
        }

        public void commit() { finish(true); }

        @Override
        public void close() { finish(false); }

        private void finish(boolean counted) {
            synchronized (AiDailyQuota.this) {
                if (finished) return;
                finished = true;
                Usage u = usage.get(userId);
                if (u == null || !day.equals(u.day)) return; // the day rolled over; nothing to release
                u.reserved = Math.max(0, u.reserved - 1);
                if (counted) u.used++;
            }
        }
    }
}
