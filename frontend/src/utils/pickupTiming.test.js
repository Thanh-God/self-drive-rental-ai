import assert from "node:assert/strict";
import { test } from "node:test";
import { canRecordNoShow, nearPickup, pickupDayLabel, pickupDayPassed } from "./pickupTiming.js";

// startAt 2026-10-25T17:00:00Z = 00:00 ngày 26/10 giờ Việt Nam (đơn theo ngày).
const booking = { status: "CONFIRMED", startAt: "2026-10-25T17:00:00Z" };
const at = (iso) => Date.parse(iso);

test("pickup day ends at Vietnam midnight, the same boundary the backend uses for no-show", () => {
  assert.equal(pickupDayPassed(booking, at("2026-10-26T16:59:59Z")), false, "23:59:59 ngày nhận");
  assert.equal(pickupDayPassed(booking, at("2026-10-26T17:00:00Z")), true, "00:00 ngày kế tiếp");
  assert.equal(pickupDayPassed(booking, at("2026-10-25T10:00:00Z")), false, "trước ngày nhận");
  assert.equal(pickupDayPassed({ startAt: null }, at("2026-10-27T00:00:00Z")), false);
  assert.equal(pickupDayPassed(booking, Number.NaN), false);
  assert.equal(pickupDayLabel(booking), "26/10/2026");
  assert.equal(pickupDayLabel({}), "");
});

test("'near pickup' covers the last 24 hours and the pickup day itself, never a pickup day that has passed", () => {
  assert.equal(nearPickup(booking, at("2026-10-24T16:00:00Z")), false, "còn hơn 24 giờ");
  assert.equal(nearPickup(booking, at("2026-10-25T03:00:00Z")), true, "còn 14 giờ");
  assert.equal(nearPickup(booking, at("2026-10-26T05:00:00Z")), true, "đang trong ngày nhận");
  assert.equal(nearPickup(booking, at("2026-10-27T03:00:00Z")), false, "đã qua ngày nhận");
  assert.equal(nearPickup({ startAt: "bad" }, at("2026-10-27T03:00:00Z")), false);
});

test("only assigned pickup Staff on a confirmed booking past its pickup day may record a no-show", () => {
  const after = at("2026-10-27T03:00:00Z");
  assert.equal(canRecordNoShow(booking, { role: "STAFF", assignedPickup: true, now: after }), true);
  for (const [value, options] of [
    [booking, { role: "STAFF", assignedPickup: false, now: after }],
    [booking, { role: "ADMIN", assignedPickup: true, now: after }],
    [booking, { role: "USER", assignedPickup: true, now: after }],
    [booking, { role: "STAFF", assignedPickup: true, now: at("2026-10-26T16:59:59Z") }],
    [{ ...booking, status: "IN_PROGRESS" }, { role: "STAFF", assignedPickup: true, now: after }],
    [{ ...booking, status: "PENDING" }, { role: "STAFF", assignedPickup: true, now: after }],
    [{ ...booking, status: "CANCELLED" }, { role: "STAFF", assignedPickup: true, now: after }],
    [{ ...booking, rentalBalance: { status: "RECORDED" } }, { role: "STAFF", assignedPickup: true, now: after }],
  ]) assert.equal(canRecordNoShow(value, options), false, JSON.stringify({ status: value.status, ...options }));
});

test("L9: a booking whose remaining rent is only due (not recorded) can still be a no-show", () => {
  assert.equal(canRecordNoShow({ ...booking, rentalBalance: { status: "DUE" } }, { role: "STAFF", assignedPickup: true, now: at("2026-10-27T03:00:00Z") }), true);
});
