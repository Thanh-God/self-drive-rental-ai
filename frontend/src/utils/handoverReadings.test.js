import assert from "node:assert/strict";
import { test } from "node:test";
import { handoverBaseline, readingsComparison, readingsInput } from "./handoverReadings.js";

test("handover requires both readings in range; numbers are sent, not strings", () => {
  assert.equal(readingsInput({ fuel: "", odometer: "", required: true }).ok, false);
  assert.equal(readingsInput({ fuel: "6", odometer: "", required: true }).ok, false);
  assert.equal(readingsInput({ fuel: "", odometer: "12000", required: true }).ok, false);
  for (const fuel of ["9", "-1", "4.5", "x"]) assert.equal(readingsInput({ fuel, odometer: "1", required: true }).ok, false, fuel);
  for (const odometer of ["-5", "1.5", "1e3", "10000001"]) assert.equal(readingsInput({ fuel: "4", odometer, required: true }).ok, false, odometer);
  assert.deepEqual(readingsInput({ fuel: "6", odometer: " 12000 ", required: true }).payload, { fuelLevel: 6, odometerKm: 12000 });
  assert.deepEqual(readingsInput({ fuel: "0", odometer: "0", required: true }).payload, { fuelLevel: 0, odometerKm: 0 });
});

test("return compares with the handover odometer; older handovers make readings optional but still all-or-nothing", () => {
  const records = [{ kind: "HANDOVER", fuel_level: 6, odometer_km: 12000 }];
  const baseline = handoverBaseline(records);
  assert.deepEqual(baseline, { fuelLevel: 6, odometerKm: 12000 });
  const below = readingsInput({ fuel: "5", odometer: "11999", required: true, baseline });
  assert.equal(below.ok, false); assert.match(below.error, /nhỏ hơn lúc giao/);
  assert.equal(readingsInput({ fuel: "5", odometer: "12000", required: true, baseline }).ok, true, "same odometer allowed");
  assert.equal(handoverBaseline([{ kind: "HANDOVER", fuel_level: null, odometer_km: null }]), null);
  assert.deepEqual(readingsInput({ fuel: "", odometer: "", required: false }).payload, { fuelLevel: null, odometerKm: null });
  assert.equal(readingsInput({ fuel: "4", odometer: "", required: false }).ok, false);
});

test("comparison line only when both records carry readings", () => {
  const both = [{ kind: "HANDOVER", fuel_level: 6, odometer_km: 12000 }, { kind: "RETURN", fuel_level: 5, odometer_km: 12150 }];
  assert.match(readingsComparison(both), /Đã chạy 150 km · nhiên liệu 6\/8 → 5\/8 vạch/);
  assert.equal(readingsComparison([{ kind: "HANDOVER", fuel_level: null, odometer_km: null }, { kind: "RETURN", fuel_level: 5, odometer_km: 9 }]), "");
  assert.equal(readingsComparison([]), "");
});
