-- V15 (L5, Q3): fuel/battery level (8-step gauge, 0-8) and odometer (km) on handover and return records.
-- Readings only; no fee is derived from them. Existing records stay NULL; both values are present together or not at all.
ALTER TABLE vehicle_handover_records ADD COLUMN fuel_level SMALLINT;
ALTER TABLE vehicle_handover_records ADD COLUMN odometer_km BIGINT;
ALTER TABLE vehicle_handover_records ADD CONSTRAINT ck_handover_fuel_level CHECK (fuel_level IS NULL OR (fuel_level >= 0 AND fuel_level <= 8));
ALTER TABLE vehicle_handover_records ADD CONSTRAINT ck_handover_odometer CHECK (odometer_km IS NULL OR odometer_km >= 0);
ALTER TABLE vehicle_handover_records ADD CONSTRAINT ck_handover_readings_pair CHECK (
  (fuel_level IS NULL AND odometer_km IS NULL) OR (fuel_level IS NOT NULL AND odometer_km IS NOT NULL)
);
