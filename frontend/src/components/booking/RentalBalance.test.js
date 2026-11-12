import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom, vite, root, container, createRoot, Router, Routes, Route, Auth, Balance, Detail, client;
let handler, requests;
const globals = new Map();
const due = { policy: 'rental-balance-v1', dueAmount: 1300000, status: 'DUE', demo: true, recorded: null };
const recorded = { ...due, status: 'RECORDED', recorded: { amount: 1300000, method: 'BANK_TRANSFER', reference: 'CK-0001', recordedAt: '2030-01-01T03:00:00Z' } };
const base = { id: 'b1', version: 7, status: 'CONFIRMED', total: 1300000, rentalTotal: 1300000, oneWayFee: 0, vehicleName: 'Xe fixture', customerName: 'Khách fixture', pickupName: 'KDrive Đà Nẵng', returnName: 'KDrive Đà Nẵng', pickupBranchId: 'dn', returnBranchId: 'dn', createdAt: '2020-01-01T00:00:00Z', policyVersion: 'rental-2026-09-28', deposit: { required: false, amount: 0 }, rentalBalance: due,
  startAt: new Date(Date.now() - 3600000).toISOString(), endAt: new Date(Date.now() + 86400000).toISOString() };

before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter: Router, Routes, Route } = await import('react-router-dom'));
  const dir = fileURLToPath(new URL('../../..', import.meta.url));
  vite = await createServer({ root: dir, configFile: `${dir}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ default: Balance } = await vite.ssrLoadModule('/src/components/booking/RentalBalance.jsx'));
  ({ ApiBookingDetailPage: Detail } = await vite.ssrLoadModule('/src/pages/api/ApiScreens.jsx'));
  ({ default: Auth } = await vite.ssrLoadModule('/src/context/AuthContext.jsx'));
  ({ default: client } = await vite.ssrLoadModule('/src/api/client.js'));
  client.defaults.adapter = async config => { requests.push(config); return { config, data: await handler(config), status: 200, statusText: 'OK', headers: {} }; };
});
after(async () => {
  if (root) await act(async () => root.unmount()); await vite?.close();
  for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  dom?.window.close();
});
async function mount(element, entry = '/staff/bookings/b1') {
  if (root) await act(async () => root.unmount());
  requests = [];
  document.body.replaceChildren(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(Router, { initialEntries: [entry] }, element)));
}
const recordForm = () => container.querySelector('form[aria-label="Ghi nhận phần tiền thuê còn lại"]');
const reverseForm = () => container.querySelector('form[aria-label="Đảo bản ghi phần tiền thuê còn lại"]');
const setValue = async (el, value) => act(async () => {
  const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
const submit = async form => act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
const tick = async () => act(async () => { recordForm().querySelector('input[type="checkbox"]').click(); });
const posts = () => requests.filter(r => r.method === 'post');

test('renter sees what remains and where to pay, with no form and no staff log', async () => {
  handler = () => ({});
  await mount(h(Balance, { booking: base, role: 'USER' }));
  assert.match(container.textContent, /Phần tiền thuê còn lại — Chưa ghi nhận/);
  assert.match(container.textContent, /Còn lại cần thanh toán: 1\.300\.000/);
  assert.match(container.textContent, /đơn không có cọc/);
  assert.match(container.textContent, /tại chi nhánh nhận trước khi nhận xe/);
  assert.match(container.textContent, /Mô phỏng — Không chuyển tiền thật/);
  assert.match(container.textContent, /hóa đơn không chứng minh đã thanh toán/);
  assert.equal(recordForm(), null); assert.equal(reverseForm(), null);
  await mount(h(Balance, { booking: { ...base, deposit: { required: true, amount: 390000 }, rentalBalance: { ...due, dueAmount: 910000 } }, role: 'USER' }));
  assert.match(container.textContent, /910\.000/); assert.match(container.textContent, /trừ cọc 390\.000/);
  await mount(h(Balance, { booking: { ...base, rentalBalance: undefined }, role: 'STAFF', assignedPickup: true }));
  assert.equal(container.textContent, '', 'bookings outside the policy render nothing');
});

test('pickup Staff records the exact remainder once; transfer needs a reference; same key is reused only while the outcome is unknown', async () => {
  let saved = 0;
  handler = () => ({});
  await mount(h(Balance, { booking: base, role: 'STAFF', assignedPickup: true, onSaved() { saved++; } }));
  assert.ok(recordForm());
  assert.match(recordForm().textContent, /ghi nhận một lần/);
  await setValue(recordForm().querySelector('select'), 'BANK_TRANSFER');
  await tick();
  await submit(recordForm());
  assert.equal(posts().length, 0, 'no request without a transfer reference');
  assert.match(container.textContent, /Chuyển khoản cần mã tham chiếu/);
  await setValue(recordForm().querySelector('input:not([type="checkbox"])'), '  CK-0001 ');
  await submit(recordForm());
  assert.equal(posts().length, 1);
  const sent = JSON.parse(posts()[0].data);
  assert.equal(posts()[0].url, '/bookings/b1/rental-balance');
  assert.deepEqual({ ...sent, idempotencyKey: undefined }, { amountVnd: 1300000, method: 'BANK_TRANSFER', reference: 'CK-0001', idempotencyKey: undefined, expectedVersion: 7, confirmed: true });
  assert.ok(sent.idempotencyKey);
  assert.equal(saved, 1);
});

test('lost reply: reads the booking back, then retry resends the same key; a 4xx shows the reason and does not reuse it', async () => {
  let saved = 0, first = true;
  handler = config => {
    if (config.method === 'post' && first) { first = false; throw Object.assign(Error('Network Error'), { code: 'ERR_NETWORK' }); }
    if (config.method === 'get') return { booking: base };
    return {};
  };
  await mount(h(Balance, { booking: base, role: 'STAFF', assignedPickup: true, onSaved() { saved++; } }));
  await tick(); await submit(recordForm());
  assert.equal(requests.filter(r => r.method === 'get').length, 1, 'read back after an unknown outcome');
  assert.match(container.textContent, /Chưa xác minh được kết quả/);
  const retry = [...recordForm().querySelectorAll('button')].find(b => b.textContent === 'Thử lại');
  assert.ok(retry);
  await submit(recordForm());
  assert.equal(posts().length, 2);
  assert.equal(JSON.parse(posts()[1].data).idempotencyKey, JSON.parse(posts()[0].data).idempotencyKey);
  assert.equal(saved, 1);

  handler = config => { if (config.method === 'post') throw Object.assign(Error('x'), { response: { status: 409, data: { message: 'Phần tiền thuê còn lại đã được ghi nhận.' } } }); return {}; };
  await mount(h(Balance, { booking: base, role: 'STAFF', assignedPickup: true }));
  await tick(); await submit(recordForm()); await submit(recordForm());
  assert.match(container.textContent, /đã được ghi nhận/);
  assert.notEqual(JSON.parse(posts()[1].data).idempotencyKey, JSON.parse(posts()[0].data).idempotencyKey, 'a refused request does not pin the key');
});

test('readback that finds the record counts as saved', async () => {
  let saved = 0;
  handler = config => { if (config.method === 'post') throw Object.assign(Error('timeout'), { code: 'ECONNABORTED' }); return { booking: { ...base, rentalBalance: { ...recorded, recorded: { ...recorded.recorded, method: 'CASH' } } } }; };
  await mount(h(Balance, { booking: base, role: 'STAFF', assignedPickup: true, onSaved() { saved++; } }));
  await tick(); await submit(recordForm());
  assert.equal(saved, 1); assert.doesNotMatch(container.textContent, /Chưa xác minh/);
});

test('only assigned pickup Staff on a writable booking gets the record form; Admin gets the reversal form with a required reason', async () => {
  handler = () => ({});
  for (const [props, why] of [
    [{ role: 'STAFF', assignedPickup: false, booking: base }, 'other branch'],
    [{ role: 'ADMIN', assignedPickup: true, booking: base }, 'Admin never records'],
    [{ role: 'STAFF', assignedPickup: true, booking: { ...base, status: 'COMPLETED' } }, 'completed'],
    [{ role: 'STAFF', assignedPickup: true, booking: { ...base, status: 'PENDING' } }, 'pending'],
    [{ role: 'STAFF', assignedPickup: true, booking: { ...base, rentalBalance: recorded } }, 'already recorded'],
  ]) { await mount(h(Balance, props)); assert.equal(recordForm(), null, why); }

  await mount(h(Balance, { booking: { ...base, rentalBalance: { ...recorded, recordedByName: 'Staff Đà Nẵng', history: [{ kind: 'RECORDED', amount: 1300000, method: 'BANK_TRANSFER', reference: 'CK-0001', actorName: 'Staff Đà Nẵng', at: '2030-01-01T03:00:00Z' }] } }, role: 'ADMIN' }));
  assert.match(container.textContent, /Đã ghi nhận 1\.300\.000\s₫ · Chuyển khoản · Tham chiếu CK-0001/);
  assert.doesNotMatch(container.textContent, /Còn lại cần thanh toán/, 'a recorded balance is not shown as still owed');
  assert.match(container.textContent, /Phần tiền thuê còn lại sau cọc: 1\.300\.000/);
  assert.match(container.textContent, /Nhật ký ghi nhận \(1\)/);
  assert.ok(reverseForm());
  await submit(reverseForm());
  assert.equal(posts().length, 0, 'reason required');
  await setValue(reverseForm().querySelector('textarea'), 'Nhập nhầm mã');
  await submit(reverseForm());
  assert.equal(posts()[0].url, '/bookings/b1/rental-balance/reverse');
  const sent = JSON.parse(posts()[0].data);
  assert.equal(sent.reason, 'Nhập nhầm mã'); assert.equal(sent.expectedVersion, 7); assert.equal(sent.confirmed, true);
  await mount(h(Balance, { booking: { ...base, status: 'COMPLETED', rentalBalance: recorded }, role: 'ADMIN' }));
  assert.equal(reverseForm(), null, 'no reversal after completion');
});

test('booking detail disables handover and says why until the remaining rent is recorded', async () => {
  const mountDetail = async booking => {
    handler = config => {
      if (config.url === '/me/branches') return ['dn'];
      if (config.url === '/bookings/b1') return { booking, history: [], records: [] };
      if (config.url.includes('/review')) return null;
      return [];
    };
    await mount(h(Auth.Provider, { value: { user: { id: 's1', role: 'STAFF' } } }, h(Routes, null, h(Route, { path: '/staff/bookings/:bookingId', element: h(Detail, { area: 'staff' }) }))));
  };
  const selectNext = async () => {
    const select = [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'IN_PROGRESS'));
    assert.ok(select, 'handover is offered'); await setValue(select, 'IN_PROGRESS');
  };
  const handoverButton = () => [...container.querySelectorAll('button')].find(b => /Giao xe|Bàn giao/.test(b.textContent));
  await mountDetail(base);
  assert.ok(container.querySelector('section[aria-label="Phần tiền thuê còn lại"]'));
  const schedule = container.querySelector('section[aria-label="Lịch thanh toán"]');
  assert.ok(schedule, 'L3: payment schedule summary on the booking detail');
  assert.match(schedule.textContent, /2\. Phần còn lại — Thanh toán tại chi nhánh nhận trước khi nhận xe/);
  await selectNext();
  assert.match(container.textContent, /Chưa giao xe được: cần ghi nhận phần tiền thuê còn lại \(1\.300\.000/);
  assert.equal(handoverButton().disabled, true);
  await mountDetail({ ...base, rentalBalance: recorded });
  await selectNext();
  assert.doesNotMatch(container.textContent, /Chưa giao xe được/);
  assert.equal(handoverButton().disabled, false);
  await mountDetail({ ...base, rentalBalance: undefined });
  await selectNext();
  assert.equal(handoverButton().disabled, false, 'older bookings keep the old handover');
  assert.equal(container.querySelector('section[aria-label="Phần tiền thuê còn lại"]'), null);
});

const refundForm = () => container.querySelector('form[aria-label="Ghi nhận hoàn tiền thuê"]');
const refundDue = { ...recorded, status: 'REFUND_DUE', refund: { amount: 1300000, status: 'REFUND_DUE', dueSince: '2030-01-01T04:00:00Z' } };
const refunded = { ...recorded, status: 'REFUNDED', refund: { amount: 1300000, status: 'REFUNDED', dueSince: '2030-01-01T04:00:00Z', method: 'BANK_TRANSFER', reference: 'HT-0001', refundedAt: '2030-01-02T03:00:00Z' } };

test('L9: a cancelled booking with rent received tells the renter it is refunded in full; nothing shows when nothing was received', async () => {
  handler = () => ({});
  await mount(h(Balance, { booking: { ...base, status: 'CANCELLED', rentalBalance: refundDue }, role: 'USER' }));
  assert.match(container.textContent, /Cần hoàn cho khách/);
  assert.match(container.textContent, /khoản tiền thuê đã thanh toán 1\.300\.000.*được hoàn toàn bộ/);
  assert.equal(refundForm(), null);
  await mount(h(Balance, { booking: { ...base, status: 'CANCELLED', rentalBalance: refundDue }, role: 'STAFF', assignedPickup: true }));
  assert.match(container.textContent, /chờ quản trị viên ghi nhận đã hoàn/);
  assert.equal(refundForm(), null, 'Staff do not record the refund');
  assert.equal(recordForm(), null);
  await mount(h(Balance, { booking: { ...base, status: 'CANCELLED', rentalBalance: refunded }, role: 'USER' }));
  assert.match(container.textContent, /Đã hoàn cho khách/);
  assert.match(container.textContent, /đã hoàn 1\.300\.000.*Chuyển khoản · Tham chiếu HT-0001/);
  await mount(h(Balance, { booking: { ...base, status: 'CANCELLED', rentalBalance: due }, role: 'USER' }));
  assert.equal(container.textContent, '', 'closed booking with nothing received renders nothing');
});

test('L9: Admin records the whole refund once; transfer needs a reference; no reverse form on a cancelled booking', async () => {
  let saved = 0;
  handler = () => ({});
  await mount(h(Balance, { booking: { ...base, status: 'CANCELLED', rentalBalance: refundDue }, role: 'ADMIN', onSaved() { saved++; } }));
  assert.ok(refundForm());
  assert.equal(reverseForm(), null);
  assert.match(refundForm().textContent, /1\.300\.000.*toàn bộ khoản đã ghi nhận/);
  await setValue(refundForm().querySelector('select'), 'BANK_TRANSFER');
  await act(async () => { refundForm().querySelector('input[type="checkbox"]').click(); });
  await act(async () => { refundForm().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.match(container.textContent, /Chuyển khoản hoàn cần mã tham chiếu/);
  assert.equal(posts().length, 0);
  await setValue(refundForm().querySelector('input:not([type])'), 'HT-0001');
  await act(async () => { refundForm().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].url, '/bookings/b1/rental-balance/refund');
  const body = JSON.parse(posts()[0].data);
  assert.equal(body.amountVnd, 1300000); assert.equal(body.method, 'BANK_TRANSFER'); assert.equal(body.reference, 'HT-0001');
  assert.equal(body.expectedVersion, 7); assert.equal(body.confirmed, true); assert.ok(body.idempotencyKey);
  assert.equal(saved, 1);
  await mount(h(Balance, { booking: { ...base, status: 'CANCELLED', rentalBalance: refunded }, role: 'ADMIN' }));
  assert.equal(refundForm(), null, 'refunded once');
});
