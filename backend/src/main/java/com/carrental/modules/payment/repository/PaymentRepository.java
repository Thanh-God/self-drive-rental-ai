package com.carrental.modules.payment.repository;

import java.time.Instant;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;
import com.carrental.exception.DomainException;

@Repository
public class PaymentRepository {
    private final JdbcTemplate jdbc;
    public PaymentRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public record Payment(String id, String bookingId, long amount, String status, Instant createdAt, Instant expiresAt,
                          String providerTransaction, String providerPayDate, boolean applied, long version,
                          String verifierId, Instant verifiedAt, Instant transferTime, String transferNote,
                          String sourceAccount, long appliedAmount, String idempotencyKey) {}

    public record Refund(String id, String paymentId, String bookingId, long amount, String status, String kind,
                         String reason, String approvedBy, Instant approvedAt, Instant createdAt,
                         String providerTransaction, String requestDate, long version) {}

    private static Instant instant(java.sql.ResultSet r, String name) throws java.sql.SQLException {
        var t = r.getTimestamp(name); return t == null ? null : t.toInstant();
    }

    private final RowMapper<Payment> payment = (r, n) -> new Payment(
        r.getString("id"), r.getString("booking_id"), r.getLong("amount"), r.getString("status"),
        instant(r, "created_at"), instant(r, "expires_at"), r.getString("provider_transaction"),
        r.getString("provider_pay_date"), r.getBoolean("applied"), r.getLong("version"),
        r.getString("verifier_id"), instant(r, "verified_at"), instant(r, "transfer_time"),
        r.getString("transfer_note"), r.getString("source_account"), r.getLong("applied_amount"),
        r.getString("idempotency_key")
    );

    private final RowMapper<Refund> refund = (r, n) -> new Refund(
        r.getString("id"), r.getString("payment_id"), r.getString("booking_id"), r.getLong("amount"),
        r.getString("status"), r.getString("kind"), r.getString("reason"), r.getString("approved_by"),
        instant(r, "approved_at"), instant(r, "created_at"), r.getString("provider_transaction"),
        r.getString("request_date"), r.getLong("version")
    );

    public Optional<Payment> payment(String id) {
        return jdbc.query("select * from payment_transactions where id=?", payment, id).stream().findFirst();
    }

    public Payment lockPayment(String id) {
        return jdbc.query("select * from payment_transactions where id=? for update", payment, id)
            .stream().findFirst().orElseThrow(DomainException::missing);
    }

    public List<Payment> forBooking(String id) {
        return jdbc.query("select * from payment_transactions where booking_id=? order by created_at,id", payment, id);
    }

    public void createPayment(String id, String booking, long amount, Instant now, Instant expiry) {
        jdbc.update("insert into payment_transactions(id,booking_id,amount,status,created_at,expires_at) values(?,?,?,'PENDING',?,?)",
            id, booking, amount, Timestamp.from(now), Timestamp.from(expiry));
    }

    public void receipt(String id, String status, String number, String payDate) {
        jdbc.update("update payment_transactions set status=?,provider_transaction=?,provider_pay_date=?,version=version+1 where id=?",
            status, number, payDate, id);
    }

    public void unknown(String id) {
        jdbc.update("update payment_transactions set status='UNKNOWN',version=version+1 where id=? and status<>'SUCCEEDED'", id);
    }

    public void applied(String id) {
        jdbc.update("update payment_transactions set applied=true,version=version+1 where id=? and applied=false", id);
    }

    public void updateAppliedAmount(String id, long appliedAmount) {
        jdbc.update("update payment_transactions set applied_amount=?,version=version+1 where id=?", appliedAmount, id);
    }

    public Optional<Refund> refundForPayment(String id) {
        return jdbc.query("select * from payment_refunds where payment_id=?", refund, id).stream().findFirst();
    }

    public Refund refund(String id) {
        return jdbc.query("select * from payment_refunds where id=?", refund, id)
            .stream().findFirst().orElseThrow(DomainException::missing);
    }

    public Refund lockRefund(String id) {
        return jdbc.query("select * from payment_refunds where id=? for update", refund, id)
            .stream().findFirst().orElseThrow(DomainException::missing);
    }

    public void createRefund(String id, Payment p, long amount, String status, String kind, String reason, Instant now) {
        jdbc.update("insert into payment_refunds(id,payment_id,booking_id,amount,status,kind,reason,created_at) values(?,?,?,?,?,?,?,?)",
            id, p.id(), p.bookingId(), amount, status, kind, reason, Timestamp.from(now));
    }

    public void decide(String id, long version, long amount, String reason, String actor, Instant now) {
        int rows = jdbc.update("update payment_refunds set amount=?,status=?,reason=?,approved_by=?,approved_at=?,version=version+1 where id=? and version=? and status='REQUESTED'",
            amount, amount == 0 ? "DECLINED" : "APPROVED", reason, actor, Timestamp.from(now), id, version);
        if (rows != 1) throw DomainException.conflict("Yêu cầu hoàn đã thay đổi hoặc đã được quyết định.");
    }

    public void refundStatus(String id, String status, String provider, String requestDate) {
        jdbc.update("update payment_refunds set status=?,provider_transaction=?,request_date=?,version=version+1 where id=?",
            status, provider, requestDate, id);
    }

    public long reserved(String paymentId, String excluded) {
        return jdbc.queryForObject("select coalesce(sum(amount),0) from payment_refunds where payment_id=? and id<>? and status in ('APPROVED','PROCESSING','SUCCEEDED','UNKNOWN')",
            Long.class, paymentId, excluded);
    }

    public List<Refund> refunds(String booking) {
        return jdbc.query("select * from payment_refunds where booking_id=? order by created_at,id", refund, booking);
    }

    public List<Refund> adminRefunds() {
        return jdbc.query("select * from payment_refunds order by created_at desc,id limit 200", refund);
    }

    public List<Payment> unresolvedPayments() {
        return jdbc.query("select * from payment_transactions p where status in ('PENDING','UNKNOWN') or (status='SUCCEEDED' and applied_amount < amount and not exists(select 1 from payment_refunds r where r.payment_id=p.id)) order by created_at,id limit 50", payment);
    }

    public List<Refund> readyRefunds() {
        return jdbc.query("select * from payment_refunds where status='APPROVED' order by created_at,id limit 20", refund);
    }

    public List<Payment> unknownPayments() {
        return jdbc.query("select * from payment_transactions where status='UNKNOWN' order by created_at desc,id limit 100", payment);
    }

    public void event(String booking, String paymentId, String kind, String note, String actor, Instant now, String key) {
        if (key != null && jdbc.queryForObject("select count(*) from payment_events where event_key=?", Long.class, key) > 0) return;
        jdbc.update("insert into payment_events(id,booking_id,payment_id,kind,note,actor_id,created_at,event_key) values(?,?,?,?,?,?,?,?)",
            UUID.randomUUID().toString(), booking, paymentId, kind, note, actor, Timestamp.from(now), key);
    }

    public Object events(String booking) {
        return jdbc.queryForList("select kind,note,actor_id,created_at from payment_events where booking_id=? order by created_at,id", booking);
    }
}