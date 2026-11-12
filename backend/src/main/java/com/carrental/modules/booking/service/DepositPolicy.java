package com.carrental.modules.booking.service;

import com.carrental.exception.DomainException;
import java.math.BigInteger;
import java.time.*;

public final class DepositPolicy {
    private DepositPolicy() {}
    public static final String VNPAY_VERSION = "sandbox-deposit-30-v1";
    /** Bookings created before L6: late cancellation and no-show refunds are an Admin decision (0–100%). */
    public static final String QR_VERSION_V1 = "demo-qr-manual-30-v1";
    /**
     * L6 (12/11/2026), new QR bookings: a late customer cancellation (under 24 hours) is refunded in full; on a no-show the
     * deposit applied to the booking is not refunded (money beyond it is). Business cancellations stay a full refund.
     */
    public static final String QR_VERSION = "demo-qr-manual-30-v2";
    public static final long DEPOSIT_RATE_NUMERATOR = 30;
    public static final long DEPOSIT_RATE_DENOMINATOR = 100;
    public static final long DEPOSIT_MIN_AMOUNT = 5000;
    public static final Duration PAYMENT_WINDOW = Duration.ofMinutes(30);
    public static final Duration RECONCILIATION_EXTENSION = Duration.ofMinutes(30);
    public static final Duration INITIAL_HOLD = Duration.ofHours(2);

    public static long amount(long rentalTotal) {
        if (rentalTotal <= 0) throw DomainException.bad("Tiền thuê phải lớn hơn 0.");
        return BigInteger.valueOf(rentalTotal).multiply(BigInteger.valueOf(DEPOSIT_RATE_NUMERATOR)).add(BigInteger.valueOf(DEPOSIT_RATE_DENOMINATOR - 1))
            .divide(BigInteger.valueOf(DEPOSIT_RATE_DENOMINATOR)).longValueExact();
    }

    public static Instant paymentDueAt(Instant now, Instant originalHoldUntil) {
        return now.plus(PAYMENT_WINDOW).isBefore(originalHoldUntil) ? now.plus(PAYMENT_WINDOW) : originalHoldUntil;
    }

    public static Instant reviewDueAt(Instant paymentDueAt, Instant originalHoldUntil) {
        return paymentDueAt.plus(RECONCILIATION_EXTENSION).isBefore(originalHoldUntil) ? paymentDueAt.plus(RECONCILIATION_EXTENSION) : originalHoldUntil;
    }

    public static boolean early(Instant now, Instant pickup) {
        return Duration.between(now, pickup).compareTo(Duration.ofHours(24)) >= 0;
    }

    public static boolean isDemoQrMethod(String method) {
        return "DEMO_QR_MANUAL".equals(method);
    }

    public static boolean isVnpayMethod(String method) {
        return "VNPAY_SANDBOX".equals(method);
    }

    /** True when the booking's saved policy fixes late-cancellation and no-show refunds (no Admin 0–100% decision). */
    public static boolean fixedCancellationRules(String policy) {
        return QR_VERSION.equals(policy);
    }

    /** Cancellation kinds whose refund the Admin decides under the saved policy. */
    public static boolean adminDecides(String policy, String cancellationKind) {
        return !fixedCancellationRules(policy) && ("NO_SHOW".equals(cancellationKind) || "LATE_CUSTOMER".equals(cancellationKind));
    }
}