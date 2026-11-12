// L5 (Q3): fuel/battery level on an 8-step gauge and odometer (km) at handover and return. Readings only, no fee.
// The backend enforces the rules; this mirrors them so Staff see the problem before sending.

export const FUEL_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export const MAX_ODOMETER_KM = 10_000_000;

export function fuelLabel(level) {
  return level === null || level === undefined || level === "" ? "" : `${level}/8 vạch`;
}

export function km(value) {
  return `${Number(value).toLocaleString("vi-VN")} km`;
}

/** Handover odometer the return must not go below, or null when the handover predates the readings. */
export function handoverBaseline(records = []) {
  const handover = (records || []).find((record) => record.kind === "HANDOVER");
  if (!handover || handover.odometer_km === null || handover.odometer_km === undefined) return null;
  return { fuelLevel: Number(handover.fuel_level), odometerKm: Number(handover.odometer_km) };
}

/**
 * Validate form input. `required` is true at handover and at return after a handover with readings.
 * Returns { ok, error, payload: { fuelLevel, odometerKm } } with numbers or nulls.
 */
export function readingsInput({ fuel, odometer, required, baseline = null }) {
  const fuelText = String(fuel ?? "").trim();
  const kmText = String(odometer ?? "").trim();
  if (!fuelText && !kmText) {
    return required
      ? { ok: false, error: "Cần ghi mức nhiên liệu (0–8 vạch) và số km trên đồng hồ.", payload: null }
      : { ok: true, error: "", payload: { fuelLevel: null, odometerKm: null } };
  }
  if (!fuelText || !kmText) return { ok: false, error: "Ghi đủ cả mức nhiên liệu và số km.", payload: null };
  const fuelLevel = Number(fuelText);
  const odometerKm = Number(kmText);
  if (!Number.isInteger(fuelLevel) || fuelLevel < 0 || fuelLevel > 8) return { ok: false, error: "Mức nhiên liệu phải từ 0 đến 8 vạch.", payload: null };
  if (!/^\d+$/.test(kmText) || !Number.isSafeInteger(odometerKm) || odometerKm > MAX_ODOMETER_KM)
    return { ok: false, error: "Số km phải là số nguyên không âm.", payload: null };
  if (baseline && odometerKm < baseline.odometerKm)
    return { ok: false, error: `Số km lúc trả (${km(odometerKm)}) nhỏ hơn lúc giao (${km(baseline.odometerKm)}). Kiểm tra lại đồng hồ.`, payload: null };
  return { ok: true, error: "", payload: { fuelLevel, odometerKm } };
}

/** "Đã chạy 150 km · nhiên liệu 6/8 → 5/8 vạch" for a return record compared with the handover record. */
export function readingsComparison(records = []) {
  const handover = (records || []).find((r) => r.kind === "HANDOVER");
  const ret = (records || []).find((r) => r.kind === "RETURN");
  if (!handover || !ret || handover.odometer_km == null || ret.odometer_km == null) return "";
  const driven = Number(ret.odometer_km) - Number(handover.odometer_km);
  return `Đã chạy ${km(driven)} · nhiên liệu ${handover.fuel_level}/8 → ${ret.fuel_level}/8 vạch`;
}
