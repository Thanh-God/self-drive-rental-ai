-- V14 (L4): one-time manual record of the remaining rent (total minus applied deposit) before handover.
-- Only bookings created while app.rental-balance-enabled is on carry a policy; existing rows stay NULL and keep
-- the old handover flow. No new table: the current record lives in these columns; a reversed record is kept in
-- rental_balance_log (JSON) together with who reversed it, why and when.
ALTER TABLE bookings ADD COLUMN rental_balance_policy VARCHAR(40);
ALTER TABLE bookings ADD COLUMN rental_balance_amount BIGINT;
ALTER TABLE bookings ADD COLUMN rental_balance_method VARCHAR(20);
ALTER TABLE bookings ADD COLUMN rental_balance_reference VARCHAR(120);
ALTER TABLE bookings ADD COLUMN rental_balance_recorded_by VARCHAR(36);
ALTER TABLE bookings ADD COLUMN rental_balance_recorded_by_name VARCHAR(100);
ALTER TABLE bookings ADD COLUMN rental_balance_recorded_at TIMESTAMP(6);
ALTER TABLE bookings ADD COLUMN rental_balance_key VARCHAR(80);
ALTER TABLE bookings ADD COLUMN rental_balance_demo BOOLEAN;
ALTER TABLE bookings ADD COLUMN rental_balance_log TEXT;
ALTER TABLE bookings ADD CONSTRAINT fk_rental_balance_recorder FOREIGN KEY (rental_balance_recorded_by) REFERENCES users(id);
ALTER TABLE bookings ADD CONSTRAINT ck_rental_balance_record CHECK (
  (rental_balance_amount IS NULL AND rental_balance_method IS NULL AND rental_balance_reference IS NULL
     AND rental_balance_recorded_by IS NULL AND rental_balance_recorded_by_name IS NULL
     AND rental_balance_recorded_at IS NULL AND rental_balance_key IS NULL AND rental_balance_demo IS NULL)
  OR (rental_balance_policy IS NOT NULL AND rental_balance_amount > 0 AND rental_balance_method IN ('CASH','BANK_TRANSFER')
     AND rental_balance_recorded_by IS NOT NULL AND rental_balance_recorded_by_name IS NOT NULL
     AND rental_balance_recorded_at IS NOT NULL AND rental_balance_key IS NOT NULL AND rental_balance_demo IS NOT NULL
     AND (rental_balance_method <> 'BANK_TRANSFER' OR rental_balance_reference IS NOT NULL))
);
ALTER TABLE bookings ADD CONSTRAINT ck_rental_balance_log CHECK (rental_balance_log IS NULL OR rental_balance_policy IS NOT NULL);
