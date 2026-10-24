package com.carrental.modules.operation.service;

import com.carrental.exception.DomainException;
import com.carrental.modules.booking.entity.Booking;
import com.carrental.modules.booking.repository.BookingRepository;
import com.carrental.modules.booking.service.BookingService;
import com.carrental.modules.booking.service.DepositPolicy;
import com.carrental.modules.booking.service.SchedulePolicy;
import com.carrental.modules.branch.service.BranchService;
import com.carrental.modules.contract.service.ContractService;
import com.carrental.modules.payment.repository.PaymentRepository;
import com.carrental.modules.payment.service.*;
import com.carrental.modules.user.service.LicenseService;
import com.carrental.modules.vehicle.service.VehicleService;
import com.carrental.security.Actor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.UUID;
import java.util.ArrayList;
import java.util.Objects;

/** Network calls deliberately execute outside the transaction template. */
@Service
public class DepositWorkflow {
    private final BookingService bookings;
    private final BookingRepository bookingRepo;
    private final ContractService contracts;
    private final PaymentRepository repo;
    private final PaymentService payments;
    private final VnpayGateway gateway;
    private final PaymentSettings settings;
    private final TransactionTemplate tx;
    private final Clock clock;
    private final LicenseService licenses;
    private final VehicleService vehicles;
    private final BranchService branches;
    private final JdbcTemplate jdbc;

    public DepositWorkflow(BookingService bookings, BookingRepository bookingRepo, ContractService contracts, PaymentRepository repo,
                           PaymentService payments, VnpayGateway gateway, PaymentSettings settings,
                           PlatformTransactionManager manager, Clock clock,
                           LicenseService licenses, VehicleService vehicles, BranchService branches, JdbcTemplate jdbc) {
        this.bookings = bookings; this.bookingRepo = bookingRepo; this.contracts = contracts; this.repo = repo;
        this.payments = payments; this.gateway = gateway; this.settings = settings;
        this.tx = new TransactionTemplate(manager); this.clock = clock;
        this.licenses = licenses; this.vehicles = vehicles; this.branches = branches; this.jdbc = jdbc;
    }

    public Object approve(Actor staff, String id, long version) {
        return tx.execute(s -> {
            var b = bookings.approveDeposit(staff, id, version);
            String eventKind = DepositPolicy.isDemoQrMethod(b.deposit().method()) ? "DEPOSIT_APPROVED_QR" : "DEPOSIT_APPROVED";
            String eventNote = DepositPolicy.isDemoQrMethod(b.deposit().method())
                ? "Duyệt hồ sơ và tạo mã QR cọc giả lập"
                : "Duyệt hồ sơ và yêu cầu đóng cọc VNPAY";
            repo.event(id, null, eventKind, eventNote, staff.id(), clock.instant(), null);
            return b;
        });
    }

    public Object noShow(Actor staff, String id, long version, boolean contacted, boolean notDelivered, String reason) {
        return tx.execute(s -> {
            var b = bookings.noShow(staff, id, version, contacted, notDelivered, reason);
            payments.cancellation(b);
            return b;
        });
    }

    public void notification(Map<String, String> fields) {
        settle(payments.receive(gateway.notification(fields)));
    }

    public void settle(PaymentRepository.Payment payment) {
        if (!"SUCCEEDED".equals(payment.status())) return;
        var b = bookings.view(bookings.require(new Actor("system", "ADMIN", "workflow"), payment.bookingId()));
        if (DepositPolicy.isDemoQrMethod(b.deposit().method())) {
            return;
        }
        try {
            tx.executeWithoutResult(s -> {
                bookings.depositLock(payment.bookingId());
                var p = repo.lockPayment(payment.id());
                if (p.applied() || repo.refundForPayment(p.id()).isPresent()) return;
                var b2 = bookings.confirmPaidDeposit(p.bookingId(), p.id());
                contracts.issueDeposit(b2);
                repo.applied(p.id());
                repo.event(b2.id(), p.id(), "DEPOSIT_APPLIED", "Đã xác nhận đơn và phát hành hợp đồng", null, clock.instant(), "applied:" + p.id());
            });
        } catch (DomainException e) {
            payments.queueUnappliedRefund(payment.id());
        }
    }

    public void reconcile(Actor admin, String paymentId) {
        admin.require("ADMIN");
        reconcile(paymentId);
    }

    public void reconcile(String paymentId) {
        var p = repo.payment(paymentId).orElseThrow(DomainException::missing);
        var b = bookings.view(bookings.require(new Actor("system", "ADMIN", "workflow"), p.bookingId()));
        if (DepositPolicy.isDemoQrMethod(b.deposit().method())) {
            return;
        }
        if ("SUCCEEDED".equals(p.status())) {
            settle(p);
            return;
        }
        settle(payments.receive(gateway.query(p, clock.instant())));
    }

    public void processRefund(Actor admin, String id) {
        admin.require("ADMIN");
        processRefund(id);
    }

    public void reconcileRefund(Actor admin, String id) {
        admin.require("ADMIN");
        settings.requireConfigured();
        var r = repo.refund(id);
        if (!Set.of("UNKNOWN", "PROCESSING").contains(r.status())) throw DomainException.conflict("Khoản hoàn không cần đối soát.");
        var p = repo.payment(r.paymentId()).orElseThrow();
        var b = bookings.view(bookings.require(new Actor("system", "ADMIN", "workflow"), r.bookingId()));
        if (DepositPolicy.isDemoQrMethod(b.deposit().method())) {
            throw DomainException.conflict("Khoản QR giả lập không đối soát qua VNPAY; Admin xử lý thủ công.");
        }
        var result = gateway.queryRefund(p, r.amount(), r.requestDate(), clock.instant());
        tx.executeWithoutResult(s -> {
            bookings.depositLock(r.bookingId());
            var current = repo.lockRefund(id);
            if (current.version() != r.version()) throw DomainException.conflict("Khoản hoàn đã thay đổi; tải lại.");
            String status = result.completed() ? "SUCCEEDED" : result.rejected() ? "FAILED" : "UNKNOWN";
            repo.refundStatus(id, status, result.transaction(), r.requestDate());
            repo.event(r.bookingId(), r.paymentId(), "REFUND_RECONCILED", "Kết quả truy vấn khoản hoàn: " + status, admin.id(), clock.instant(), null);
        });
    }

    public void processRefund(String id) {
        settings.requireConfigured();
        var reserved = tx.execute(s -> {
            var first = repo.refund(id);
            bookings.depositLock(first.bookingId());
            var r = repo.lockRefund(id);
            var p = repo.lockPayment(r.paymentId());
            var b = bookings.view(bookings.require(new Actor("system", "ADMIN", "workflow"), r.bookingId()));
            if (DepositPolicy.isDemoQrMethod(b.deposit().method())) {
                throw DomainException.conflict("Khoản QR giả lập không hoàn qua VNPAY; Admin xử lý thủ công.");
            }
            if (!"APPROVED".equals(r.status())) throw DomainException.conflict("Chỉ gửi yêu cầu đã duyệt; không tự gửi lại giao dịch chưa rõ kết quả.");
            if (!"SUCCEEDED".equals(p.status()) || r.amount() <= 0 || r.amount() > p.amount() - repo.reserved(p.id(), r.id()))
                throw DomainException.conflict("Khoản hoàn không hợp lệ.");
            repo.refundStatus(id, "PROCESSING", null, VnpayGateway.date(clock.instant()));
            return repo.refund(id);
        });
        String status = "UNKNOWN", provider = null;
        try {
            var p = repo.payment(reserved.paymentId()).orElseThrow();
            var result = gateway.refund(p, reserved.id(), reserved.amount(), reserved.requestDate());
            status = result.completed() ? "SUCCEEDED" : result.rejected() ? "FAILED" : "UNKNOWN";
            provider = result.transaction();
        } catch (IllegalStateException e) {
        }
        String finalStatus = status, finalProvider = provider;
        tx.executeWithoutResult(s -> {
            bookings.depositLock(reserved.bookingId());
            var r = repo.lockRefund(id);
            if (!"PROCESSING".equals(r.status())) throw DomainException.conflict("Yêu cầu hoàn đã thay đổi.");
            repo.refundStatus(id, finalStatus, finalProvider, r.requestDate());
            repo.event(r.bookingId(), r.paymentId(), "REFUND_" + finalStatus, "Kết quả hoàn VNPAY Sandbox: " + finalStatus, null, clock.instant(), null);
        });
    }

    /**
     * QR DEMO verification: persist money first, then try to apply and confirm.
     * Money is persisted with applied_amount=0; if confirmation succeeds, applied_amount is updated.
     * If confirmation fails, money remains recorded and refund is queued for unapplied amount.
     */
    public Object verifyQrDeposit(Actor staff, String bookingId, BookingService.VerifyInput input) {
        return tx.execute(s -> {
            var b = bookings.lockDepositBooking(bookingId);
            branches.requireStaff(staff, b.pickupBranchId);
            if (b.version != input.expectedVersion()) throw DomainException.conflict("Đơn đã thay đổi. Vui lòng tải lại.");
            if (!b.depositRequired) throw DomainException.conflict("Đơn không yêu cầu cọc.");
            if (!DepositPolicy.isDemoQrMethod(b.depositMethod)) throw DomainException.conflict("Đơn không dùng phương thức QR giả lập.");
            if (input.amountVnd() <= 0) throw DomainException.bad("Số tiền thực nhận phải lớn hơn 0.");
            if (input.transferTime().isAfter(clock.instant())) throw DomainException.bad("Thời điểm chuyển không được ở tương lai.");
            if (input.idempotencyKey() == null || input.idempotencyKey().isBlank()) throw DomainException.bad("Thiếu khóa idempotency.");
            if (input.transactionRef() == null || input.transactionRef().isBlank()) throw DomainException.bad("Thiếu mã tham chiếu giao dịch.");
            if (input.transferNote() == null || input.transferNote().isBlank()) throw DomainException.bad("Thiếu nội dung chuyển khoản.");
            if (input.sourceAccount() == null || input.sourceAccount().isBlank()) throw DomainException.bad("Thiếu tài khoản nguồn.");

            boolean isLate = input.transferTime().isAfter(b.paymentDueAt);
            boolean isExpired = !"PENDING".equals(bookings.effective(b));

            // Check idempotency
            boolean exists = jdbc.queryForObject(
                "select count(*) > 0 from payment_transactions where booking_id=? and idempotency_key=?",
                Boolean.class, b.id, input.idempotencyKey()
            );
            if (Boolean.TRUE.equals(exists)) throw DomainException.conflict("Khoản này đã được ghi nhận (trùng idempotency key).");

            Instant now = clock.instant();
            String paymentId = UUID.randomUUID().toString().replace("-", "");
            Instant transferTime = input.transferTime() != null ? input.transferTime() : now;
            String providerPayDate = VnpayGateway.date(transferTime);

            // Step 1: Persist money with applied_amount=0 (separate from confirmation)
            jdbc.update("""
                insert into payment_transactions(id, booking_id, amount, status, created_at, expires_at,
                    provider_transaction, provider_pay_date, applied, version,
                    verifier_id, verified_at, transfer_time, transfer_note, source_account, applied_amount, idempotency_key)
                values(?,?,?,'SUCCEEDED',?,?,?,?,false,0,?,?,?,?,?,?,?)
                """,
                paymentId, b.id, input.amountVnd(),
                java.sql.Timestamp.from(now), java.sql.Timestamp.from(b.paymentDueAt),
                input.transactionRef(), VnpayGateway.date(transferTime),
                staff.id(), java.sql.Timestamp.from(now), java.sql.Timestamp.from(transferTime),
                input.transferNote(), input.sourceAccount(), 0L, input.idempotencyKey()
            );

            // Step 2: If late or expired, create refund for unapplied amount immediately
            if (isExpired || isLate) {
                String refundId = UUID.randomUUID().toString().replace("-", "");
                String kind = isExpired ? "UNAPPLIED_EXPIRED" : "UNAPPLIED_LATE";
                String reason = isExpired
                    ? "Đơn đã hết hạn tại thời điểm xác minh; hoàn toàn bộ tiền đã nhận."
                    : "Chuyển khoản sau hạn thanh toán; hoàn toàn bộ tiền đã nhận.";
                jdbc.update("""
                    insert into payment_refunds(id, payment_id, booking_id, amount, status, kind, reason, created_at)
                    values(?,?,?,?,?,?,?,?)
                    """,
                    refundId, paymentId, b.id, input.amountVnd(),
                    "APPROVED", kind, reason, java.sql.Timestamp.from(now)
                );
                repo.event(b.id, paymentId, "REFUND_REQUESTED", reason, staff.id(), now, "refund:" + refundId);
                repo.event(b.id, paymentId, "REFUND_DECIDED", reason, staff.id(), now, null);
                return bookings.view(b);
            }

            // Step 3: Try to apply and confirm (FIFO allocation)
            return applyAndConfirmQr(b, paymentId, staff.id(), now);
        });
    }

    private Object applyAndConfirmQr(Booking b, String newPaymentId, String verifierId, Instant now) {
        // FIFO allocation: apply to oldest payments first
        var payments = jdbc.query("""
            select id, amount, applied_amount from payment_transactions
            where booking_id=? and status='SUCCEEDED'
            order by transfer_time, id
            """, (rs, rowNum) -> new PaymentRow(rs.getString("id"), rs.getLong("amount"), rs.getLong("applied_amount")), b.id);

        long depositAmount = b.depositAmount;
        long totalAlreadyApplied = payments.stream().mapToLong(p -> p.appliedAmount).sum();
        long remainingToApply = depositAmount - totalAlreadyApplied;
        if (remainingToApply < 0) remainingToApply = 0;

        for (PaymentRow p : payments) {
            if (remainingToApply <= 0) break;
            long canApply = Math.min(p.amount - p.appliedAmount, remainingToApply);
            if (canApply > 0) {
                jdbc.update("update payment_transactions set applied_amount=applied_amount+?, version=version+1 where id=?",
                    canApply, p.id);
                remainingToApply -= canApply;
            }
        }

        long totalApplied = depositAmount - remainingToApply;
        if (totalApplied >= depositAmount) {
            // Check GPLX, schedule, license before confirming
            if (!Objects.equals(b.depositLicenseVersion, licenses.forBooking(b.userId).version()))
                throw DomainException.conflict("GPLX đã thay đổi sau duyệt. Cần nhân viên kiểm tra lại; hạn cọc không được kéo dài.");
            var v = vehicles.lock(b.vehicleId);
            if (!"ACTIVE".equals(v.status)) throw DomainException.conflict("Xe không còn sẵn sàng.");
            licenses.eligible(b.userId, v.transmission, v.seats, b.endAt);
            licenses.requirePhotos(b.userId, true);
            // Schedule validation
            var existing = bookingRepo.lockScheduleByVehicleId(v.id);
            var rows = new ArrayList<>(existing.stream().filter(x -> !x.id.equals(b.id)).map(bookings::slot).toList());
            rows.add(bookings.slot(b));
            SchedulePolicy.validate(v.currentBranchId, rows, clock.instant());

            b.depositTxnRef = newPaymentId;
            b.status = "CONFIRMED";
            b.depositMode = "FULL";
            // No repo.flush() needed - using direct JDBC
            bookings.history(b, "PENDING", null, "QR DEMO xác minh đủ cọc: " + newPaymentId);

            // Update applied_amount for the new payment
            long appliedThisPayment = depositAmount - totalAlreadyApplied;
            jdbc.update("update payment_transactions set applied_amount=applied_amount+?, version=version+1 where id=?",
                appliedThisPayment, newPaymentId);

            // Issue contract and record event
            var view = bookings.view(b);
            contracts.issueDeposit(view);
            jdbc.update("insert into payment_events(id,booking_id,payment_id,kind,note,actor_id,created_at,event_key) values(?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(), b.id, newPaymentId, "DEPOSIT_APPLIED",
                "Đã xác nhận đơn và phát hành hợp đồng từ QR DEMO", null, java.sql.Timestamp.from(clock.instant()), "applied:" + newPaymentId);

            return bookings.view(b);
        } else {
            // Partial - update mode and expiry
            b.depositMode = "PARTIAL";
            b.expiresAt = b.reviewDueAt;
            // No repo.flush() needed
            return bookings.view(b);
        }
    }

    private record PaymentRow(String id, long amount, long appliedAmount) {}
}