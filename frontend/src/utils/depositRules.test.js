import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPOSIT_POLICY_V2, cancellationCauses, cancellationRules, closedReceiptRule, fixedCancellationRules, noShowDepositNote } from "./depositRules.js";

test("policy v2 states the fixed refunds; older and unknown policies keep the Admin 0–100% decision", () => {
  const v2 = cancellationRules(DEPOSIT_POLICY_V2).join(" ");
  assert.match(v2, /Hủy dưới 24 giờ .*hoàn toàn bộ cọc/);
  assert.match(v2, /Không đến nhận xe .*cọc giữ chỗ không được hoàn/);
  assert.doesNotMatch(v2, /0–100%/);
  for (const policy of ["demo-qr-manual-30-v1", "sandbox-deposit-30-v1", undefined, "other"]) {
    assert.equal(fixedCancellationRules(policy), false, String(policy));
    assert.match(cancellationRules(policy).join(" "), /quản trị viên quyết định mức hoàn 0–100%/);
    assert.match(noShowDepositNote(policy), /Admin quyết định 0–100%/);
    assert.match(closedReceiptRule(policy), /Admin quyết định 0–100%/);
  }
  assert.match(noShowDepositNote(DEPOSIT_POLICY_V2), /không được hoàn/);
  assert.match(closedReceiptRule(DEPOSIT_POLICY_V2), /hoàn toàn bộ/);
  assert.doesNotMatch(closedReceiptRule(DEPOSIT_POLICY_V2), /0–100%/);
});

test("cancellation causes describe the refund for the booking's own policy", () => {
  const labels = (booking) => cancellationCauses(booking).map((cause) => `${cause.value}:${cause.label}|${cause.refund}`);
  assert.deepEqual(labels({ deposit: { required: false } }), ["BUSINESS:Doanh nghiệp không giao được xe|", "LATE_CUSTOMER:Khách yêu cầu hủy|"]);
  const v2 = labels({ deposit: { required: true, policy: DEPOSIT_POLICY_V2 } });
  assert.equal(v2[0], "BUSINESS:Doanh nghiệp không giao được xe|Hoàn toàn bộ cọc cho khách.");
  assert.match(v2[1], /^LATE_CUSTOMER:Khách yêu cầu hủy\|Hoàn toàn bộ cọc cho khách/);
  assert.doesNotMatch(v2[1], /0–100%/);
  const v1 = labels({ deposit: { required: true, policy: "demo-qr-manual-30-v1" } });
  assert.equal(v1[0], "BUSINESS:Doanh nghiệp không giao được xe|Hoàn toàn bộ cọc cho khách.");
  assert.match(v1[1], /sát giờ: Admin quyết định mức hoàn 0–100%/);
  assert.deepEqual(labels(null), labels({}));
});
