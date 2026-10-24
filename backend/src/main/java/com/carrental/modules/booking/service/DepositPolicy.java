package com.carrental.modules.booking.service;

import com.carrental.exception.DomainException;
import java.math.BigInteger;
import java.time.*;

public final class DepositPolicy {
    private DepositPolicy() {}
    public static final String VERSION = "sandbox-deposit-30-v1";
    public static long amount(long rentalTotal) {
        if (rentalTotal <= 0) throw DomainException.bad("Tiền thuê phải lớn hơn 0.");
        return BigInteger.valueOf(rentalTotal).multiply(BigInteger.valueOf(30)).add(BigInteger.valueOf(99))
            .divide(BigInteger.valueOf(100)).longValueExact();
    }
    public static Instant deadline(Instant now, Instant currentHold) {
        return now.plus(Duration.ofMinutes(30)).isBefore(currentHold) ? now.plus(Duration.ofMinutes(30)) : currentHold;
    }
    public static boolean early(Instant now, Instant pickup) { return Duration.between(now,pickup).compareTo(Duration.ofHours(24)) >= 0; }
}
