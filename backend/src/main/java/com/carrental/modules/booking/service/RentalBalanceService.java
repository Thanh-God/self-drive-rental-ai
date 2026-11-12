package com.carrental.modules.booking.service;

import com.carrental.exception.DomainException;
import com.carrental.modules.booking.entity.Booking;
import com.carrental.security.Actor;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * L4 (Q1/Q2): one-time manual record of the remaining rent before handover. Remaining = total − applied deposit
 * (whole total without a deposit). DEMO only: nothing here moves real money, and an invoice still does not prove
 * payment. BookingService owns authorization, locking, version and the transaction; this class owns the rules,
 * the current record and the JSON log that keeps reversed records.
 */
@Service
public class RentalBalanceService {
    public static final String VERSION = "rental-balance-v1";
    static final Set<String> METHODS = Set.of("CASH", "BANK_TRANSFER");

    public record Input(BigDecimal amountVnd, String method, String reference, String idempotencyKey, long expectedVersion, boolean confirmed) {}
    public record ReverseInput(String reason, String idempotencyKey, long expectedVersion, boolean confirmed) {}

    /** Stored log line. actorId stays in the database for audit and is never sent to clients. */
    public record LogEntry(String kind, long amount, String method, String reference, String actorId, String actorName,
                           Instant at, String reason, String key) {}

    public record Recorded(long amount, String method, String reference, Instant recordedAt) {}
    /** Log line as Staff/Admin see it: who (name), what and why, no internal ids or keys. */
    public record HistoryItem(String kind, long amount, String method, String reference, String actorName, Instant at, String reason) {}

    public record Summary(String policy, long dueAmount, String status, boolean demo, Recorded recorded,
                          @JsonInclude(JsonInclude.Include.NON_NULL) String recordedByName,
                          @JsonInclude(JsonInclude.Include.NON_NULL) List<HistoryItem> history) {}

    private final ObjectMapper json;
    private final Clock clock;
    @Value("${app.rental-balance-demo:true}") private boolean demo;

    public RentalBalanceService(ObjectMapper json, Clock clock) {
        this.json = json;
        this.clock = clock;
    }

    /**
     * Remaining rent: total minus the booking's deposit (the deposit is part of the rent, Q1). A booking only reaches
     * CONFIRMED once its deposit is applied in full, so this equals "total − applied deposit" whenever it can be recorded;
     * BookingService refuses to record while the deposit is not fully applied.
     */
    public long due(Booking b) {
        long deposit = b.depositRequired ? Math.max(0, Math.min(b.depositAmount, b.total)) : 0;
        return Math.subtractExact(b.total, deposit);
    }

    /** True when the booking follows the policy, still owes money and has no current record. */
    public boolean missing(Booking b) {
        return b.rentalBalancePolicy != null && b.rentalBalanceAmount == null && due(b) > 0;
    }

    public Summary summary(Booking b, boolean staffView) {
        if (b.rentalBalancePolicy == null) return null;
        long due = due(b);
        Recorded recorded = b.rentalBalanceAmount == null ? null
            : new Recorded(b.rentalBalanceAmount, b.rentalBalanceMethod, b.rentalBalanceReference, b.rentalBalanceRecordedAt);
        String status = recorded != null ? "RECORDED" : due > 0 ? "DUE" : "NOT_DUE";
        boolean demoMode = b.rentalBalanceDemo != null ? b.rentalBalanceDemo : demo;
        List<HistoryItem> history = staffView ? log(b).stream()
            .map(e -> new HistoryItem(e.kind(), e.amount(), e.method(), e.reference(), e.actorName(), e.at(), e.reason())).toList() : null;
        return new Summary(b.rentalBalancePolicy, due, status, demoMode, recorded,
            staffView ? b.rentalBalanceRecordedByName : null, history);
    }

    /** Same key already used: same actor and content returns true (no second write), anything else is a conflict. */
    public boolean duplicateRecord(Actor actor, Booking b, Input input) {
        for (var e : log(b)) {
            if (!Objects.equals(e.key(), input.idempotencyKey())) continue;
            if (!"RECORDED".equals(e.kind()) || !e.actorId().equals(actor.id()) || !input.confirmed()
                || input.amountVnd() == null || e.amount() != exact(input.amountVnd())
                || !Objects.equals(e.method(), input.method()) || !Objects.equals(e.reference(), blankToNull(input.reference())))
                throw DomainException.conflict("Mã thao tác đã dùng cho nội dung khác. Tải lại đơn để kiểm tra.");
            return true;
        }
        return false;
    }

    public boolean duplicateReverse(Actor actor, Booking b, ReverseInput input) {
        for (var e : log(b)) {
            if (!Objects.equals(e.key(), input.idempotencyKey())) continue;
            if (!"REVERSED".equals(e.kind()) || !e.actorId().equals(actor.id()) || !input.confirmed()
                || !Objects.equals(e.reason(), input.reason()))
                throw DomainException.conflict("Mã thao tác đã dùng cho nội dung khác. Tải lại đơn để kiểm tra.");
            return true;
        }
        return false;
    }

    public void record(Actor actor, Booking b, long due, Input input) {
        if (!input.confirmed()) throw DomainException.bad("Cần xác nhận đã đối chiếu khoản thu trước khi ghi nhận.");
        required(input.idempotencyKey(), 80, "mã thao tác");
        if (b.rentalBalanceAmount != null)
            throw DomainException.conflict("Phần tiền thuê còn lại đã được ghi nhận. Tải lại đơn; nếu ghi sai, đề nghị Admin đảo bản ghi.");
        if (due <= 0) throw DomainException.conflict("Đơn không còn phần tiền thuê phải ghi nhận.");
        if (input.amountVnd() == null) throw DomainException.bad("Nhập số tiền đã thu.");
        long amount = exact(input.amountVnd());
        if (amount != due)
            throw DomainException.conflict("Số tiền phải đúng bằng phần còn lại " + due + " đ (ghi nhận một lần). Tải lại đơn.");
        if (!METHODS.contains(Objects.toString(input.method(), ""))) throw DomainException.bad("Chọn phương thức thu: tiền mặt hoặc chuyển khoản.");
        String reference = blankToNull(input.reference());
        if (reference != null) required(reference, 120, "tham chiếu");
        if ("BANK_TRANSFER".equals(input.method()) && reference == null)
            throw DomainException.bad("Chuyển khoản cần mã tham chiếu giao dịch.");
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        b.rentalBalanceAmount = amount;
        b.rentalBalanceMethod = input.method();
        b.rentalBalanceReference = reference;
        b.rentalBalanceRecordedBy = actor.id();
        b.rentalBalanceRecordedByName = actor.fullName();
        b.rentalBalanceRecordedAt = now;
        b.rentalBalanceKey = input.idempotencyKey();
        b.rentalBalanceDemo = demo;
        append(b, new LogEntry("RECORDED", amount, input.method(), reference, actor.id(), actor.fullName(), now, null, input.idempotencyKey()));
    }

    public void reverse(Actor admin, Booking b, ReverseInput input) {
        if (!input.confirmed()) throw DomainException.bad("Cần xác nhận đảo bản ghi.");
        required(input.idempotencyKey(), 80, "mã thao tác");
        required(input.reason(), 1000, "lý do đảo");
        if (b.rentalBalanceAmount == null) throw DomainException.conflict("Không có bản ghi hiện hành để đảo. Tải lại đơn.");
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        append(b, new LogEntry("REVERSED", b.rentalBalanceAmount, b.rentalBalanceMethod, b.rentalBalanceReference,
            admin.id(), admin.fullName(), now, input.reason(), input.idempotencyKey()));
        b.rentalBalanceAmount = null;
        b.rentalBalanceMethod = null;
        b.rentalBalanceReference = null;
        b.rentalBalanceRecordedBy = null;
        b.rentalBalanceRecordedByName = null;
        b.rentalBalanceRecordedAt = null;
        b.rentalBalanceKey = null;
        b.rentalBalanceDemo = null;
    }

    public List<LogEntry> log(Booking b) {
        if (b.rentalBalanceLog == null || b.rentalBalanceLog.isBlank()) return List.of();
        try {
            return json.readValue(b.rentalBalanceLog, new TypeReference<List<LogEntry>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Rental balance log is unreadable for booking " + b.id, e);
        }
    }

    private void append(Booking b, LogEntry entry) {
        var entries = new ArrayList<>(log(b));
        entries.add(entry);
        try {
            b.rentalBalanceLog = json.writeValueAsString(entries);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static long exact(BigDecimal value) {
        try {
            long amount = value.longValueExact();
            if (amount <= 0) throw new ArithmeticException();
            return amount;
        } catch (ArithmeticException e) {
            throw DomainException.bad("Số tiền phải là VND nguyên dương.");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }

    private static void required(String value, int max, String label) {
        if (value == null || value.isBlank() || value.length() > max || !value.equals(value.trim()))
            throw DomainException.bad("Kiểm tra " + label + " (không để trống, tối đa " + max + " ký tự, không thêm khoảng trắng đầu/cuối).");
    }
}
