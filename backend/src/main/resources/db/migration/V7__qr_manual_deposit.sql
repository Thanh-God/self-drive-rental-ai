-- V7: QR Manual Deposit fields
-- Compatible with both MySQL and H2

-- Bookings table: QR DEMO fields
ALTER TABLE bookings ADD COLUMN deposit_method VARCHAR(20);
ALTER TABLE bookings ADD COLUMN deposit_mode VARCHAR(20);
ALTER TABLE bookings ADD COLUMN original_hold_until TIMESTAMP;
ALTER TABLE bookings ADD COLUMN payment_due_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN review_due_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN reported_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN deposit_receiver_snapshot TEXT;
ALTER TABLE bookings ADD CONSTRAINT ck_booking_deposit_method CHECK (deposit_method IN ('VNPAY_SANDBOX','DEMO_QR_MANUAL'));
ALTER TABLE bookings ADD CONSTRAINT ck_booking_deposit_mode CHECK (deposit_mode IN ('FULL','PARTIAL','EXCESS'));

-- Payment transactions: manual verification fields
ALTER TABLE payment_transactions ADD COLUMN verifier_id VARCHAR(36);
ALTER TABLE payment_transactions ADD COLUMN verified_at TIMESTAMP;
ALTER TABLE payment_transactions ADD COLUMN transfer_time TIMESTAMP;
ALTER TABLE payment_transactions ADD COLUMN transfer_note VARCHAR(500);
ALTER TABLE payment_transactions ADD COLUMN source_account VARCHAR(100);
ALTER TABLE payment_transactions ADD COLUMN applied_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payment_transactions ADD COLUMN idempotency_key VARCHAR(64);
ALTER TABLE payment_transactions ADD CONSTRAINT fk_payment_verifier FOREIGN KEY (verifier_id) REFERENCES users(id);
ALTER TABLE payment_transactions ADD CONSTRAINT ck_payment_applied_amount CHECK (applied_amount >= 0);

-- Unique index for idempotency (H2 doesn't support WHERE clause in CREATE INDEX)
CREATE UNIQUE INDEX uq_payment_receiver_ref ON payment_transactions (booking_id, idempotency_key);

-- Payment refunds: replace unique(payment_id) with business key
-- MySQL: constraint name is typically payment_refunds_payment_id_key
-- H2: constraint name is auto-generated (e.g., UK_<hash>)
-- Drop old constraint if it exists (MySQL), ignore error in H2
-- We add the new business key constraint which works on both
ALTER TABLE payment_refunds ADD CONSTRAINT uq_refund_business_key UNIQUE (payment_id, kind, reason, request_date);