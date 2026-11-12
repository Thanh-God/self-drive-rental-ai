-- V16 (L8): the customer accepts the contract on the website ("Đồng ý"); handover waits for it on contracts that require it.
-- One nullable column, no new table or FK. Existing contracts stay NULL (contracts issued before L8 do not require acceptance).
ALTER TABLE contracts ADD COLUMN accepted_at TIMESTAMP(6) NULL;
