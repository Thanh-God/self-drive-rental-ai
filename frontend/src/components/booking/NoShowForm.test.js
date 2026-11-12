import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

let dom, vite, root, container, createRoot, Router, Routes, Route, Auth, Form, Detail, client;
let handler, requests;
const globals = new Map();
// Ngày nhận đã qua từ lâu (đồng hồ thật của trình duyệt), hoặc còn ở rất xa.
const past = { startAt: '2020-01-01T17:00:00Z', endAt: '2020-01-03T17:00:00Z' };
const future = { startAt: '2099-01-01T17:00:00Z', endAt: '2099-01-03T17:00:00Z' };
const base = { id: 'b1', version: 4, status: 'CONFIRMED', vehicleName: 'Xe fixture', customerName: 'Khách fixture', pickupName: 'KDrive Đà Nẵng', returnName: 'KDrive Đà Nẵng', pickupBranchId: 'dn', returnBranchId: 'dn', createdAt: '2019-12-30T03:00:00Z', total: 1300000, rentalTotal: 1300000, oneWayFee: 0, deposit: { required: false, amount: 0 }, ...past };

before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter: Router, Routes, Route } = await import('react-router-dom'));
  const dir = fileURLToPath(new URL('../../..', import.meta.url));
  vite = await createServer({ root: dir, configFile: `${dir}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ default: Form } = await vite.ssrLoadModule('/src/components/booking/NoShowForm.jsx'));
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
const noShowForm = () => container.querySelector('form[aria-label="Ghi nhận khách không đến nhận"]');
const checkbox = text => [...container.querySelectorAll('label')].find(e => e.textContent.includes(text))?.querySelector('input');
async function fillAndSubmit(reason = 'Đã gọi hai lần, khách không đến') {
  await act(async () => { checkbox('Đã liên hệ khách').click(); checkbox('Xe chưa thực sự được giao').click(); });
  const area = noShowForm().querySelector('textarea');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(area, reason); area.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { noShowForm().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); noShowForm()?.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
}

test('form posts the expected version and both confirmations once, then asks the page to reload', async () => {
  let done = 0, release;
  handler = () => new Promise(resolve => { release = resolve; });
  await mount(h(Form, { booking: base, role: 'STAFF', assignedPickup: true, now: Date.now(), onDone() { done++; } }));
  assert.ok(noShowForm());
  assert.match(container.textContent, /chỉ xử lý sau hết ngày nhận \(02\/01\/2020\)/);
  assert.match(container.textContent, /không có cọc nên không phát sinh hoàn tiền/);
  assert.match(container.textContent, /không hoàn tác/);
  await fillAndSubmit();
  assert.equal(requests.length, 1, 'single flight');
  assert.equal(requests[0].method, 'post'); assert.equal(requests[0].url, '/bookings/b1/no-show');
  assert.deepEqual(JSON.parse(requests[0].data), { expectedVersion: 4, contacted: true, notDelivered: true, reason: 'Đã gọi hai lần, khách không đến' });
  await act(async () => release({}));
  assert.equal(done, 1);
});
test('a refused no-show shows the server reason and does not retry by itself', async () => {
  let done = 0;
  handler = () => { throw Object.assign(Error('x'), { response: { status: 409, data: { message: 'Đã có biên bản giao xe; không xử lý no-show.' } } }); };
  await mount(h(Form, { booking: base, role: 'STAFF', assignedPickup: true, now: Date.now(), onDone() { done++; } }));
  await fillAndSubmit();
  assert.match(container.textContent, /Đã có biên bản giao xe/);
  assert.match(container.textContent, /Tải lại đơn để kiểm tra trước khi thử lại/);
  assert.equal(requests.length, 1); assert.equal(done, 0);
});
test('deposit bookings keep the Admin refund note; nothing renders outside the allowed role, branch, status and day', async () => {
  handler = () => ({});
  await mount(h(Form, { booking: base, role: 'STAFF', assignedPickup: true, now: Date.now(), depositNote: true }));
  assert.match(container.textContent, /chờ Admin quyết định 0–100%/);
  for (const props of [
    { booking: base, role: 'ADMIN', assignedPickup: true }, { booking: base, role: 'USER', assignedPickup: true },
    { booking: base, role: 'STAFF', assignedPickup: false }, { booking: { ...base, ...future }, role: 'STAFF', assignedPickup: true },
    { booking: { ...base, status: 'IN_PROGRESS' }, role: 'STAFF', assignedPickup: true },
  ]) {
    await mount(h(Form, { ...props, now: Date.now() }));
    assert.equal(noShowForm(), null, JSON.stringify({ role: props.role, assigned: props.assignedPickup, status: props.booking.status }));
  }
});

function detail(role, value, branches = ['dn']) {
  handler = config => {
    if (config.url === '/me/branches') return branches;
    if (config.url === '/bookings/b1') return { booking: value, history: [{ next_status: 'CONFIRMED', occurred_at: '2019-12-31T03:00:00Z' }], records: [] };
    if (config.url.endsWith('/deposit')) return { deposit: value.deposit, payments: [], refunds: [] };
    if (config.url.includes('/review')) return null;
    return [];
  };
  const area = role === 'USER' ? 'user' : 'staff';
  return mount(h(Auth.Provider, { value: { user: { id: 'u1', role } } }, h(Routes, null, h(Route, { path: `/${area}/bookings/:bookingId`, element: h(Detail, { area }) }))), `/${area}/bookings/b1`);
}

test('booking detail offers the no-show form for a booking without deposit to assigned pickup Staff only', async () => {
  await detail('STAFF', base);
  assert.equal(container.querySelectorAll('form[aria-label="Ghi nhận khách không đến nhận"]').length, 1);
  assert.match(container.textContent, /không có cọc nên không phát sinh hoàn tiền/);
  const panel = container.querySelector('section.panel[aria-label="Khách không đến nhận"]');
  assert.ok(panel, 'standalone form sits in its own titled panel');
  assert.ok(panel.querySelector('label.field textarea'), 'reason uses the styled field');
  await detail('STAFF', base, ['hn']);
  assert.equal(noShowForm(), null, 'Staff of another branch');
  await detail('STAFF', { ...base, ...future });
  assert.equal(noShowForm(), null, 'pickup day not over');
});
test('a deposit booking still shows exactly one no-show form, from the deposit panel', async () => {
  await detail('STAFF', { ...base, deposit: { required: true, amount: 390000, method: 'DEMO_QR_MANUAL', approvedAt: '2019-12-31T03:00:00Z' } });
  assert.equal(container.querySelectorAll('form[aria-label="Ghi nhận khách không đến nhận"]').length, 1);
  assert.match(container.textContent, /chờ Admin quyết định 0–100%/);
  assert.equal(container.querySelector('section[aria-label="Khách không đến nhận"]'), null, 'inside the deposit panel, not a second panel');
});
test('the renter sees "pickup day passed" instead of "come to pick up" or "close to pickup"', async () => {
  await detail('USER', base);
  assert.match(container.textContent, /Đã qua ngày nhận xe \(02\/01\/2020\) nhưng hệ thống chưa ghi nhận bàn giao xe/);
  assert.match(container.textContent, /Liên hệ chi nhánh nhận KDrive Đà Nẵng/);
  assert.match(container.textContent, /hệ thống không tự hủy đơn/);
  assert.doesNotMatch(container.textContent, /Đã sát giờ nhận xe/);
  assert.doesNotMatch(container.textContent, /đến chi nhánh nhận đúng thời gian/);
  assert.equal(noShowForm(), null, 'renters never get the Staff form');
  await detail('USER', { ...base, ...future });
  assert.match(container.textContent, /đến chi nhánh nhận đúng thời gian/);
  assert.doesNotMatch(container.textContent, /Đã qua ngày nhận xe/);
});
