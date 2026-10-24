import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { getBookingActions } from '../../api/bookingActions.js';

let server, Deposit, ReturnPage, Progress;
before(async () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  server = await createServer({ root, configFile: `${root}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  const module = await server.ssrLoadModule('/src/components/user/BookingDeposit.jsx');
  Deposit = module.default; ReturnPage = module.PaymentReturnPage;
  ({ default: Progress } = await server.ssrLoadModule('/src/components/booking/BookingProgress.jsx'));
});
after(async () => { await server?.close(); });
const booking = { id: 'synthetic', status: 'PENDING', total: 2500000, pickupBranchId: 'dn', deposit: { required: true, amount: 600000 } };
test('required deposit removes manual confirmation but keeps reject/cancel', () => {
  const context = { role: 'STAFF', assignedBranchIds: new Set(['dn']), now: Date.now() };
  assert.deepEqual(getBookingActions(booking, context), ['REJECTED', 'CANCELLED']);
  assert.deepEqual(getBookingActions({ ...booking, deposit: { required: false } }, context), ['CONFIRMED', 'REJECTED', 'CANCELLED']);
});
test('panel shows deposit and remaining total without promising payment', () => {
  const text = renderToStaticMarkup(React.createElement(Deposit, { booking, role: 'USER', reload() {} }));
  assert.match(text, /VNPAY Sandbox/); assert.match(text, /600\.000/); assert.match(text, /1\.900\.000/);
  assert.match(text, /Chờ kiểm tra hồ sơ/); assert.doesNotMatch(text, /Đã ghi nhận cọc cho đơn/);
});
test('redirect success parameters never assert paid or call a payment mutation', () => {
  const text = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/user/payment-return?vnp_ResponseCode=00&vnp_TxnRef=synthetic'] }, React.createElement(ReturnPage)));
  assert.match(text, /Đang xác minh/); assert.match(text, /không xác nhận đã nhận tiền/); assert.match(text, /href="\/user\/bookings"/);
});
test('no-show form appears only after pickup day for assigned staff', () => {
  const active = { ...booking, status: 'CONFIRMED', startAt: '2026-10-25T17:00:00Z' };
  const render = (now, assignedPickup = true) => renderToStaticMarkup(React.createElement(Deposit, { booking: active, role: 'STAFF', assignedPickup, now: Date.parse(now), reload() {} }));
  assert.doesNotMatch(render('2026-10-26T16:59:59Z'), /Ghi nhận khách không đến nhận/);
  assert.match(render('2026-10-26T17:00:00Z'), /Ghi nhận khách không đến nhận/);
  assert.doesNotMatch(render('2026-10-26T17:00:00Z', false), /Ghi nhận khách không đến nhận/);
});
test('approved deposit has full year and matching progress stage', () => {
  const approved = { ...booking, deposit: { ...booking.deposit, approvedAt: '2026-10-24T03:00:00Z', dueAt: '2026-10-24T03:30:00Z' } };
  const panel = renderToStaticMarkup(React.createElement(Deposit, { booking: approved, role: 'USER', reload() {} }));
  assert.match(panel, /24\/10\/2026/);
  const progress = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Progress, { booking: approved, role: 'USER' })));
  assert.match(progress, /Hiện tại: Chờ đóng cọc/);assert.match(progress, /Hồ sơ đã được duyệt/);
  const legacy = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Progress, { booking: { ...booking, deposit: { required: false } }, role: 'USER' })));
  assert.match(legacy, /Hiện tại: Chờ xác nhận/);
});
test('expired booking never asks customer to keep paying', () => {
  const expired = { ...booking, status: 'EXPIRED', deposit: { ...booking.deposit, approvedAt: '2026-10-24T03:00:00Z', dueAt: '2026-10-24T03:30:00Z' } };
  const text = renderToStaticMarkup(React.createElement(Deposit, { booking: expired, role: 'USER', reload() {} }));
  assert.match(text, /Đơn không còn chờ đóng cọc/);assert.doesNotMatch(text, /Thanh toán cọc thử nghiệm/);
});
