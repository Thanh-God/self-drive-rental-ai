import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { paymentSchedule, quoteRemainderSentence } from "./paymentSchedule.js";

const money = (v) => `${Number(v).toLocaleString("vi-VN")} ₫`;
const base = { status: "CONFIRMED", total: 1300000, deposit: { required: false, amount: 0, appliedAmount: 0 } };
const balance = (status, dueAmount = 1300000) => ({ policy: "rental-balance-v1", dueAmount, status, demo: true, recorded: null });
let vite, Schedule;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL("../..", import.meta.url)), server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  ({ default: Schedule } = await vite.ssrLoadModule("/src/components/booking/PaymentSchedule.jsx"));
});
after(async () => vite?.close());

test("no deposit, remaining rent under the L4 policy: whole total due at the pickup branch, then recorded", () => {
  const due = paymentSchedule({ ...base, rentalBalance: balance("DUE") });
  assert.equal(due.deposit.state, "NONE");
  assert.deepEqual([due.remainder.state, due.remainder.amount], ["DUE", 1300000]);
  assert.match(due.remainder.label, /tại chi nhánh nhận trước khi nhận xe/);
  const recorded = paymentSchedule({ ...base, rentalBalance: balance("RECORDED") });
  assert.equal(recorded.remainder.state, "RECORDED");
  assert.match(recorded.remainder.label, /đã ghi nhận/);
});

test("deposit moves from 'after staff review' to 'awaiting payment' to 'applied'; the remainder is total minus deposit", () => {
  const withDeposit = (status, extra = {}) => ({ ...base, status, deposit: { required: true, amount: 390000, appliedAmount: 0, ...extra }, rentalBalance: balance("DUE", 910000) });
  assert.equal(paymentSchedule(withDeposit("PENDING")).deposit.state, "PENDING");
  assert.match(paymentSchedule(withDeposit("PENDING")).deposit.label, /sau khi nhân viên kiểm tra hồ sơ/);
  assert.match(paymentSchedule(withDeposit("PENDING", { approvedAt: "2030-01-01T00:00:00Z" })).deposit.label, /Chờ đóng cọc/);
  const applied = paymentSchedule(withDeposit("CONFIRMED", { appliedAmount: 390000 }));
  assert.deepEqual([applied.deposit.state, applied.deposit.amount, applied.remainder.amount], ["APPLIED", 390000, 910000]);
  assert.equal(paymentSchedule(withDeposit("CONFIRMED", { appliedAmount: 100 })).deposit.state, "CHECK", "never claims a deposit that is not fully applied");
});

test("bookings outside the remaining-rent policy say the system does not record it, never 'paid'", () => {
  const old = paymentSchedule({ ...base, deposit: { required: true, amount: 390000, appliedAmount: 390000 } });
  assert.deepEqual([old.remainder.state, old.remainder.amount], ["UNTRACKED", 910000]);
  assert.match(old.remainder.label, /không ghi nhận khoản này/);
  assert.doesNotMatch(old.remainder.label, /đã thu|đã thanh toán/);
});

test("closed or unknown bookings show no schedule", () => {
  for (const status of ["CANCELLED", "REJECTED", "EXPIRED", undefined]) assert.equal(paymentSchedule({ ...base, status }), null, String(status));
  assert.equal(paymentSchedule(null), null);
});

test("component lists total, deposit and remainder, and says the invoice is not proof of payment", () => {
  const html = renderToStaticMarkup(h(Schedule, { booking: { ...base, deposit: { required: true, amount: 390000, appliedAmount: 390000 }, rentalBalance: balance("DUE", 910000) } }));
  assert.match(html, /aria-label="Lịch thanh toán"/);
  assert.match(html, /Tổng tiền thuê và phí tuyến/);
  assert.match(html, /1\. Cọc giữ chỗ \(tính vào tiền thuê\) — Đã ghi nhận vào đơn/);
  assert.match(html, /2\. Phần còn lại — Thanh toán tại chi nhánh nhận trước khi nhận xe/);
  assert.match(html, /910\.000/);
  assert.match(html, /không thu tiền thật/);
  assert.match(html, /Hóa đơn phát hành khi hoàn tất không chứng minh đã thanh toán/);
  assert.equal(renderToStaticMarkup(h(Schedule, { booking: { ...base, status: "CANCELLED" } })), "");
});

test("quote sentence follows the remaining-rent policy and never mentions the deposit", () => {
  assert.match(quoteRemainderSentence({ rentalBalance: balance("DUE", 910000) }, money), /Phần còn lại 910\.000 ₫ thanh toán tại chi nhánh nhận trước khi nhận xe/);
  assert.match(quoteRemainderSentence({ total: 1300000 }, money), /không ghi nhận khoản này cho báo giá này/);
  for (const q of [{ rentalBalance: balance("DUE") }, { total: 1 }]) assert.doesNotMatch(quoteRemainderSentence(q, money), /cọc/);
  assert.equal(quoteRemainderSentence(null, money), "");
});
