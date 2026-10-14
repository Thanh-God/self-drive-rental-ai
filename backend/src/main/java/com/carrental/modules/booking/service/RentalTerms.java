package com.carrental.modules.booking.service;

import com.carrental.exception.DomainException;
import java.time.Duration;
import java.time.Instant;

public final class RentalTerms {
    private RentalTerms() {}

    public static int days(Instant start, Instant end, Instant now) {
        if (start == null || end == null || !start.isAfter(now) || !end.isAfter(start)
                || Duration.between(start, end).compareTo(Duration.ofDays(90)) > 0) {
            throw DomainException.bad("Khoảng thuê phải ở tương lai, thời lượng dương và không quá 90 ngày.");
        }
        Duration duration = Duration.between(start, end);
        long seconds = duration.getSeconds();
        return Math.toIntExact(seconds / 86400 + (seconds % 86400 != 0 || duration.getNano() != 0 ? 1 : 0));
    }

    public static long rent(long dailyPrice, int days) { return Math.multiplyExact(dailyPrice, days); }
    public static long total(long rent, long routeFee) { return Math.addExact(rent, routeFee); }
    public static Instant holdUntil(Instant start, Instant now) {
        Instant limit = now.plus(Duration.ofHours(2));
        return limit.isBefore(start) ? limit : start;
    }
}
