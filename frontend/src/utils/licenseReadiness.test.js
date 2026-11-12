import assert from "node:assert/strict";
import { test } from "node:test";
import { URL } from "node:url";
import { bookingReturnPath, licenseReadiness, profilePathWithReturn, safeReturnTo } from "./licenseReadiness.js";

const base = { id: "lic-1", status: "PENDING", version: 1 };

test("readiness follows the backend rule: sending needs both photos, not staff approval", () => {
  const cases = [
    [{ loading: true }, "LOADING", false],
    [{ error: "offline" }, "ERROR", true],
    [{ license: null }, "NO_LICENSE", false],
    [{ license: "" }, "NO_LICENSE", false],
    [{ license: { ...base, photos: null } }, "MISSING_PHOTOS", false],
    [{ license: { ...base, photos: { front: true, back: false, status: "MISSING" } } }, "MISSING_PHOTOS", false],
    [{ license: { ...base, photos: { front: false, back: true, status: "MISSING" } } }, "MISSING_PHOTOS", false],
    [{ license: { ...base, photos: { front: true, back: true, status: "PENDING" } } }, "PENDING_REVIEW", true],
    [{ license: { ...base, photos: { front: true, back: true, status: "NEEDS_CHANGES", reason: "Mờ" } } }, "NEEDS_CHANGES", true],
    [{ license: { ...base, photos: { front: true, back: true, status: "APPROVED" } } }, "APPROVED", true],
  ];
  for (const [input, state, canSubmit] of cases) {
    const result = licenseReadiness(input);
    assert.equal(result.state, state, JSON.stringify(input));
    assert.equal(result.canSubmit, canSubmit, state);
    if (!canSubmit) assert.ok(result.blockReason, `${state} explains why sending is blocked`);
  }
});

test("error state never claims a photo status; staff note is passed through for changes", () => {
  const error = licenseReadiness({ error: "x" });
  assert.doesNotMatch(`${error.title} ${error.detail}`, /thiếu|đủ ảnh|đạt/);
  const changes = licenseReadiness({ license: { ...base, photos: { front: true, back: true, status: "NEEDS_CHANGES", reason: "Ảnh mặt sau bị mờ" } } });
  assert.match(changes.detail, /Ảnh mặt sau bị mờ/);
  assert.match(changes.detail, /trước khi đơn được xác nhận/);
  const approved = licenseReadiness({ license: { ...base, status: "VERIFIED", photos: { front: true, back: true, status: "APPROVED" } } });
  assert.match(approved.detail, /bản gốc/);
});

test("return path carries the current trip and keeps unrelated search params", () => {
  const params = new URLSearchParams("vehicleId=old&compare=v3%2Cv1&start=2026-01-01");
  const path = bookingReturnPath(params, { vehicleId: "v1", start: "2030-11-10", end: "2030-11-12", pickupBranchId: "dn", returnBranchId: "" });
  const url = new URL(path, "http://x");
  assert.equal(url.pathname, "/user/bookings/new");
  assert.equal(url.searchParams.get("vehicleId"), "v1");
  assert.equal(url.searchParams.get("start"), "2030-11-10");
  assert.equal(url.searchParams.get("compare"), "v3,v1");
  assert.equal(url.searchParams.has("returnBranchId"), false);
  assert.equal(safeReturnTo(path), path);
});

test("returnTo accepts only the internal booking form path", () => {
  const ok = "/user/bookings/new?vehicleId=v1&start=2030-11-10&end=2030-11-12&pickupBranchId=dn&returnBranchId=hn";
  assert.equal(safeReturnTo(ok), ok);
  for (const bad of [
    null, undefined, 42, "", "//evil.com/user/bookings/new?vehicleId=v1", "https://evil.com/user/bookings/new?vehicleId=v1",
    "javascript:alert(1)", "/admin?vehicleId=v1", "/user/bookings/new", "/user/bookings/new?start=2030-01-01",
    "/user/bookings/newx?vehicleId=v1", "/user/bookings/new/../../admin?vehicleId=v1", "/user/bookings/new?vehicleId=v1\\@evil.com",
    "/user/bookings/new?vehicleId=v1&next=//evil.com", "/user/bookings/new?vehicleId=v1\n", `/user/bookings/new?vehicleId=${"a".repeat(700)}`,
  ]) assert.equal(safeReturnTo(bad), null, String(bad));
  assert.equal(profilePathWithReturn("https://evil.com"), "/user/profile");
  assert.equal(profilePathWithReturn(ok), `/user/profile?returnTo=${encodeURIComponent(ok)}`);
});
