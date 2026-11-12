import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// L8 (12/11/2026): the customer presses "Đồng ý" on the contract; Staff cannot hand over until then.
let dom, vite, root, container, createRoot, Router, Routes, Route, Auth, Doc, Detail, client, util;
let handler, requests;
const globals = new Map();
const V2 = 'contract-2026-11-12-v2';
const snapshot = JSON.stringify({ contractNumber: 'HĐ-20261023-AAAA0000', issuedAt: '2026-10-23T03:00:00Z', customer: 'Khách fixture', vehicle: 'Xe fixture', pickup: 'KDrive Đà Nẵng', return: 'KDrive Đà Nẵng', total: 1300000, rentalTotal: 1300000, oneWayFee: 0, depositAmount: 0, remainingRent: 1300000, articles: [{ number: 1, title: 'Đối tượng hợp đồng', clauses: ['Khoản fixture.'] }], termsNote: 'Ghi chú fixture.' });
const contract = (termsVersion, acceptedAt = null) => [{ id: 'c1', issued_at: '2026-10-23T03:00:00Z', snapshot, terms_version: termsVersion, accepted_at: acceptedAt }];
// Pickup already passed so assigned pickup Staff are offered the handover.
const booking = { id: 'b1', version: 4, status: 'CONFIRMED', vehicleName: 'Xe fixture', customerName: 'Khách fixture', pickupName: 'KDrive Đà Nẵng', returnName: 'KDrive Đà Nẵng', pickupBranchId: 'dn', returnBranchId: 'dn', createdAt: '2019-12-30T03:00:00Z', startAt: '2020-01-01T03:00:00Z', endAt: '2099-01-03T17:00:00Z', total: 1300000, rentalTotal: 1300000, oneWayFee: 0, deposit: { required: false, amount: 0 } };

before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter: Router, Routes, Route } = await import('react-router-dom'));
  const dir = fileURLToPath(new URL('../../..', import.meta.url));
  vite = await createServer({ root: dir, configFile: `${dir}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ ApiDocumentPage: Doc, ApiBookingDetailPage: Detail } = await vite.ssrLoadModule('/src/pages/api/ApiScreens.jsx'));
  ({ default: Auth } = await vite.ssrLoadModule('/src/context/AuthContext.jsx'));
  ({ default: client } = await vite.ssrLoadModule('/src/api/client.js'));
  util = await vite.ssrLoadModule('/src/utils/contractAcceptance.js');
  client.defaults.adapter = async config => { requests.push(config); return { config, data: await handler(config), status: 200, statusText: 'OK', headers: {} }; };
});
after(async () => {
  if (root) await act(async () => root.unmount()); await vite?.close();
  for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  dom?.window.close();
});

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });
async function mount(role, area, path, element) {
  if (root) await act(async () => root.unmount());
  requests = [];
  document.body.replaceChildren(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(Router, { initialEntries: [path.replace(':bookingId', 'b1')] },
    h(Auth.Provider, { value: { user: { id: 'u1', role } } }, h(Routes, null, h(Route, { path, element }))))));
  await settle();
}
const openContract = (role, area) => mount(role, area, `/${area}/bookings/:bookingId/contract`, h(Doc, { kind: 'contract', area }));
const openDetail = (role, area) => mount(role, area, `/${area}/bookings/:bookingId`, h(Detail, { area }));
const route = ({ terms = V2, acceptedAt = null, status = 'CONFIRMED', branches = ['dn'], onAccept } = {}) => config => {
  if (config.method === 'post' && config.url === '/bookings/b1/contract/accept') return onAccept();
  if (config.url === '/bookings/b1/contract') return contract(terms, acceptedAt);
  if (config.url === '/bookings/b1') return { booking: { ...booking, status }, history: [], records: [] };
  if (config.url === '/me/branches') return branches;
  if (config.url.endsWith('/deposit')) return { deposit: booking.deposit, payments: [], refunds: [] };
  if (config.url.includes('/review')) return null;
  return [];
};
const acceptForm = () => container.querySelector('form[aria-label="Đồng ý hợp đồng"]');

test('acceptance is required only for contracts issued from L8', () => {
  assert.deepEqual(util.contractAcceptance(contract(V2)), { issued: true, required: true, acceptedAt: null });
  assert.equal(util.handoverBlockedByContract(util.contractAcceptance(contract(V2))), true);
  assert.equal(util.handoverBlockedByContract(util.contractAcceptance(contract(V2, '2026-10-24T03:00:00Z'))), false);
  for (const old of ['contract-2026-11-12', 'terms-2026-09-28', 'demo-qr-manual-30-v1'])
    assert.equal(util.contractAcceptance(contract(old)).required, false, old);
  assert.deepEqual(util.contractAcceptance([]), { issued: false, required: false, acceptedAt: null });
  assert.equal(util.handoverBlockedByContract(null), false);
});

test('the customer ticks, presses Đồng ý once and then sees the accepted time', async () => {
  let accepted = null, posts = 0;
  handler = route({ onAccept: () => { posts++; accepted = '2026-10-24T03:00:00Z'; return contract(V2, accepted); } });
  const base = handler;
  handler = config => (config.url === '/bookings/b1/contract' && config.method !== 'post' ? contract(V2, accepted) : base(config));
  await openContract('USER', 'user');
  const form = acceptForm();
  assert.ok(form, 'the confirmed booking offers the acceptance form');
  assert.match(container.textContent, /Hợp đồng có hiệu lực khi bạn bấm Đồng ý/);
  const button = form.querySelector('button');
  assert.equal(button.disabled, true, 'the box must be ticked first');
  await act(async () => { form.querySelector('input[type="checkbox"]').click(); });
  assert.equal(button.disabled, false);
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
  assert.equal(posts, 1, 'single flight');
  assert.match(container.querySelector('[data-testid="contract-accepted"]').textContent, /Bên thuê đã đồng ý hợp đồng trên hệ thống lúc/);
  assert.equal(acceptForm(), null);
});

test('a refused acceptance shows the server reason; no form outside a confirmed booking or for Staff', async () => {
  handler = route({ onAccept: () => { throw Object.assign(Error('x'), { response: { status: 409, data: { message: 'Chỉ đồng ý hợp đồng khi đơn đã xác nhận và chưa giao xe.' } } }); } });
  await openContract('USER', 'user');
  await act(async () => { acceptForm().querySelector('input[type="checkbox"]').click(); });
  await act(async () => { acceptForm().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle();
  assert.match(container.textContent, /Chỉ đồng ý hợp đồng khi đơn đã xác nhận và chưa giao xe/);

  handler = route({ status: 'CANCELLED' });
  await openContract('USER', 'user');
  assert.equal(acceptForm(), null);
  assert.ok(container.querySelector('[data-testid="contract-not-accepted"]'));

  handler = route();
  await openContract('STAFF', 'staff');
  assert.equal(acceptForm(), null);
  assert.match(container.textContent, /Khách chưa bấm Đồng ý hợp đồng/);
  assert.ok(!requests.some(r => r.url === '/bookings/b1'), 'Staff contract page does not load the booking for acceptance');

  handler = route({ terms: 'contract-2026-11-12' });
  await openContract('USER', 'user');
  assert.equal(acceptForm(), null, 'contracts issued before L8 need no acceptance');
  assert.match(container.textContent, /chữ ký\/duyệt thực hiện theo quy trình bên ngoài/);
});

async function chooseHandover() {
  const select = [...container.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'IN_PROGRESS'));
  assert.ok(select, 'handover is offered to the assigned pickup Staff');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(select, 'IN_PROGRESS'); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
}

test('Staff cannot hand over until the customer has accepted, and can after a reload', async () => {
  let accepted = null;
  handler = config => (config.url === '/bookings/b1/contract' ? contract(V2, accepted) : route()(config));
  await openDetail('STAFF', 'staff');
  await chooseHandover();
  const block = container.querySelector('[data-testid="handover-contract-block"]');
  assert.ok(block);
  assert.match(block.textContent, /khách chưa bấm Đồng ý hợp đồng/);
  const handoverForm = block.closest('form');
  assert.equal(handoverForm.querySelector('button.btn').disabled, true);
  accepted = '2026-10-24T03:00:00Z';
  await act(async () => { block.querySelector('button').click(); });
  await settle();
  assert.equal(container.querySelector('[data-testid="handover-contract-block"]'), null);
  assert.equal(handoverForm.querySelector('button.btn').disabled, false, 'once accepted, the contract no longer locks the button');
});

test('the customer is reminded on the booking page; older contracts and accepted ones show nothing', async () => {
  handler = route();
  await openDetail('USER', 'user');
  const reminder = container.querySelector('[data-testid="user-contract-reminder"]');
  assert.ok(reminder);
  assert.equal(reminder.querySelector('a').getAttribute('href'), '/user/bookings/b1/contract');
  handler = route({ acceptedAt: '2026-10-24T03:00:00Z' });
  await openDetail('USER', 'user');
  assert.equal(container.querySelector('[data-testid="user-contract-reminder"]'), null);
  handler = route({ terms: 'contract-2026-11-12' });
  await openDetail('USER', 'user');
  assert.equal(container.querySelector('[data-testid="user-contract-reminder"]'), null);
  handler = route({ status: 'IN_PROGRESS' });
  await openDetail('USER', 'user');
  assert.ok(!requests.some(r => r.url === '/bookings/b1/contract'), 'only a confirmed booking reads the contract');
});
