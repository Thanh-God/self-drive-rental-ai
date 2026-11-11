package com.carrental.modules.ai;

import static org.junit.jupiter.api.Assertions.*;

import com.carrental.security.Actor;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class AiDailyQuotaTest {
    /** A clock the test can move; the quota reads it on every call. */
    static final class MovableClock extends Clock {
        final AtomicReference<Instant> now;
        MovableClock(String instant) { now = new AtomicReference<>(Instant.parse(instant)); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return Clock.fixed(now.get(), zone); }
        @Override public Instant instant() { return now.get(); }
    }

    final Actor user = new Actor("u1", "USER", "Renter");
    final Actor other = new Actor("u2", "USER", "Other renter");

    static void ask(AiDailyQuota quota, Actor actor) {
        try (var held = quota.reserve(actor)) { held.commit(); }
    }

    @Test
    void sixQuestionsPassAndTheSeventhIsRefusedWithResetTimeAndSampleHotline() {
        var quota = new AiDailyQuota(6, "10008888", true, new MovableClock("2026-11-11T03:00:00Z"));
        for (int i = 1; i <= 6; i++) {
            ask(quota, user);
            assertEquals(6 - i, quota.status(user).remaining());
        }
        var refused = assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));
        assertEquals(429, refused.status.value());
        assertEquals(6, refused.quota.limit());
        assertEquals(6, refused.quota.used());
        assertEquals(0, refused.quota.remaining());
        // 00:00 on 12/11 in Asia/Ho_Chi_Minh is 17:00 UTC on 11/11.
        assertEquals(Instant.parse("2026-11-11T17:00:00Z"), refused.quota.resetAt());
        assertEquals("10008888", refused.quota.hotline());
        assertTrue(refused.quota.hotlineSample());
        assertTrue(refused.getMessage().contains("6 lượt"), refused.getMessage());
        assertTrue(refused.getMessage().contains("10008888 (số mẫu dùng cho bản demo)"), refused.getMessage());
    }

    @Test
    void allowanceResetsAtMidnightVietnamTimeNotUtcMidnight() {
        var clock = new MovableClock("2026-11-11T16:59:59Z"); // 23:59:59 on 11/11 in Vietnam
        var quota = new AiDailyQuota(2, "10008888", true, clock);
        ask(quota, user);
        ask(quota, user);
        assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));

        clock.now.set(Instant.parse("2026-11-11T17:00:00Z")); // 00:00 on 12/11 in Vietnam
        assertEquals(2, quota.status(user).remaining());
        assertEquals(Instant.parse("2026-11-12T17:00:00Z"), quota.status(user).resetAt());
        ask(quota, user);
        assertEquals(1, quota.status(user).remaining());
    }

    @Test
    void utcMidnightInsideTheVietnamDayDoesNotReset() {
        var clock = new MovableClock("2026-11-11T23:59:00Z"); // 06:59 on 12/11 in Vietnam
        var quota = new AiDailyQuota(1, "10008888", true, clock);
        ask(quota, user);
        clock.now.set(Instant.parse("2026-11-12T00:01:00Z")); // still 12/11 in Vietnam
        assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));
    }

    @Test
    void eachRenterHasTheirOwnAllowance() {
        var quota = new AiDailyQuota(1, "10008888", true, new MovableClock("2026-11-11T03:00:00Z"));
        ask(quota, user);
        assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));
        assertEquals(1, quota.status(other).remaining());
        ask(quota, other);
        assertEquals(0, quota.status(other).remaining());
    }

    @Test
    void closingWithoutCommitGivesTheQuestionBackAndCommitCountsOnce() {
        var quota = new AiDailyQuota(1, "10008888", true, new MovableClock("2026-11-11T03:00:00Z"));
        for (int i = 0; i < 5; i++) {
            try (var held = quota.reserve(user)) { assertNotNull(held); } // failed call: no commit
        }
        assertEquals(1, quota.status(user).remaining());
        var held = quota.reserve(user);
        held.commit();
        held.commit();
        held.close();
        assertEquals(1, quota.status(user).used());
        assertEquals(0, quota.status(user).remaining());
    }

    @Test
    void questionsInFlightCountAgainstTheLimit() {
        var quota = new AiDailyQuota(2, "10008888", true, new MovableClock("2026-11-11T03:00:00Z"));
        var first = quota.reserve(user);
        var second = quota.reserve(user);
        var refused = assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));
        assertEquals(0, refused.quota.used(), "Nothing answered yet; the refusal comes from the two in flight");
        second.close(); // the second one failed
        var third = quota.reserve(user);
        first.commit();
        third.commit();
        assertEquals(0, quota.status(user).remaining());
        assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));
    }

    @Test
    void concurrentRequestsNeverExceedTheLimit() throws Exception {
        var quota = new AiDailyQuota(6, "10008888", true, new MovableClock("2026-11-11T03:00:00Z"));
        var granted = new java.util.concurrent.atomic.AtomicInteger();
        var refused = new java.util.concurrent.atomic.AtomicInteger();
        var start = new java.util.concurrent.CountDownLatch(1);
        var threads = new ArrayList<Thread>();
        for (int i = 0; i < 40; i++) {
            var t = new Thread(() -> {
                try {
                    start.await();
                    try (var held = quota.reserve(user)) { held.commit(); granted.incrementAndGet(); }
                } catch (AiQuotaExceededException e) {
                    refused.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            threads.add(t);
            t.start();
        }
        start.countDown();
        for (var t : threads) t.join(10_000);
        assertEquals(6, granted.get());
        assertEquals(34, refused.get());
        assertEquals(6, quota.status(user).used());
    }

    @Test
    void limitAndHotlineComeFromConfigurationAndAReleasedNumberIsNotMarkedSample() {
        var quota = new AiDailyQuota(3, "19001234", false, new MovableClock("2026-11-11T03:00:00Z"));
        for (int i = 0; i < 3; i++) ask(quota, user);
        var refused = assertThrows(AiQuotaExceededException.class, () -> quota.reserve(user));
        assertEquals(3, refused.quota.limit());
        assertEquals("19001234", refused.quota.hotline());
        assertFalse(refused.quota.hotlineSample());
        assertTrue(refused.getMessage().endsWith("hotline 19001234."), refused.getMessage());
        assertThrows(IllegalArgumentException.class, () -> new AiDailyQuota(-1, "1", true, Clock.systemUTC()));
    }

    /** R5 (REVIEW #15): what the UI shows as remaining also leaves out questions still being answered. */
    @Test
    void statusRemainingExcludesQuestionsInFlight() {
        var quota = new AiDailyQuota(3, "10008888", true, new MovableClock("2026-11-11T03:00:00Z"));
        ask(quota, user);
        var held = quota.reserve(user);
        assertEquals(1, quota.status(user).used());
        assertEquals(1, quota.status(user).remaining(), "3 - 1 answered - 1 in flight");
        held.close();
        assertEquals(2, quota.status(user).remaining(), "a released question is available again");
    }

    /** R5: entries of earlier days are dropped once the Vietnam day changes, unless a question is still in flight. */
    @Test
    void earlierDaysAreForgottenWhenANewDayStarts() {
        var clock = new MovableClock("2026-11-11T03:00:00Z");
        var quota = new AiDailyQuota(6, "10008888", true, clock);
        var third = new Actor("u3", "USER", "Third");
        ask(quota, user);
        ask(quota, other);
        var slow = quota.reserve(third);
        assertEquals(3, quota.trackedUsers());
        clock.now.set(Instant.parse("2026-11-11T17:00:01Z")); // 00:00:01 on 12/11 in Vietnam
        ask(quota, user);
        assertEquals(2, quota.trackedUsers(), "other is forgotten; third still has a question in flight");
        slow.commit(); // finishing yesterday's question does not count today
        assertEquals(6, quota.status(third).remaining());
        assertEquals(5, quota.status(user).remaining());
    }
}
