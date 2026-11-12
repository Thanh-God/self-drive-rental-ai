import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// L7 (12/11/2026): the contract page shows the numbered contract for new snapshots and keeps the old layout for old ones.
let dom, vite, root, container, createRoot, Router, Routes, Route, Auth, Page, client;
let handler, requests;
const globals = new Map();

const articles = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, title: `Tiêu đề ${i + 1}`, clauses: [`Khoản A của điều ${i + 1}.`, `Khoản B của điều ${i + 1}.`] }));
articles[2] = { number: 3, title: 'Hủy đơn và hoàn cọc', clauses: ['Hủy dưới 24 giờ trước mốc nhận (liên hệ nhân viên chi nhánh nhận): hoàn toàn bộ cọc.'] };
const numbered = {
  contractNumber: 'HĐ-20261023-55670EF2', issuedAt: '2026-10-23T03:00:00Z',
  lessor: { name: 'KDrive (dự án thử nghiệm, chưa đăng ký pháp nhân)', representative: 'Nhân viên chi nhánh nhận xe', address: 'KDrive Đà Nẵng — 01 Fixture', hotline: '10008888', sample: true },
  customer: 'Khách fixture', customerPhone: '0900000007', customerEmail: 'fixture@example.test', license: { number: 'SYN-LICENSE', licenseClass: 'B', scheme: 'VN_2025' },
  vehicle: 'Xe fixture', vehiclePlate: '43A-000.01', vehicleSeats: 5, vehicleTransmission: 'AUTO',
  pickup: 'KDrive Đà Nẵng', pickupAddress: '01 Fixture', return: 'KDrive Hà Nội', returnAddress: '02 Fixture',
  startAt: '2026-10-25T17:00:00Z', endAt: '2026-10-27T17:00:00Z', rentalDays: 2, policyVersion: 'calendar-2026-10-17',
  rentalTotal: 1300000, oneWayFee: 1500000, total: 2800000, depositAmount: 390000, remainingRent: 2410000,
  articles, termsNote: 'Mẫu hợp đồng phục vụ đồ án, chưa được thẩm định pháp lý.',
};
const old = { customer: 'Khách cũ', vehicle: 'Xe cũ', pickup: 'KDrive Đà Nẵng', return: 'KDrive Đà Nẵng', total: 1300000, terms: 'Điều khoản cũ một đoạn. Hợp đồng phục vụ đồ án.' };

before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter: Router, Routes, Route } = await import('react-router-dom'));
  const dir = fileURLToPath(new URL('../../..', import.meta.url));
  vite = await createServer({ root: dir, configFile: `${dir}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ ApiDocumentPage: Page } = await vite.ssrLoadModule('/src/pages/api/ApiScreens.jsx'));
  ({ default: Auth } = await vite.ssrLoadModule('/src/context/AuthContext.jsx'));
  ({ default: client } = await vite.ssrLoadModule('/src/api/client.js'));
  client.defaults.adapter = async config => { requests.push(config); return { config, data: await handler(config), status: 200, statusText: 'OK', headers: {} }; };
});
after(async () => {
  if (root) await act(async () => root.unmount()); await vite?.close();
  for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  dom?.window.close();
});

async function open(snapshot, termsVersion, area = 'user') {
  handler = () => [{ id: 'c-uuid-1', issued_at: '2026-10-23T03:00:00Z', snapshot: JSON.stringify(snapshot), terms_version: termsVersion }];
  if (root) await act(async () => root.unmount());
  requests = [];
  document.body.replaceChildren(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(Router, { initialEntries: [`/${area}/bookings/b1/contract`] },
    h(Auth.Provider, { value: { user: { id: 'u1', role: 'USER' } } },
      h(Routes, null, h(Route, { path: `/${area}/bookings/:bookingId/contract`, element: h(Page, { kind: 'contract', area }) }))))));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const section = title => container.querySelector(`section[aria-label="${title}"]`);

test('a new contract shows its number, both parties, the vehicle, both branch addresses, the money and 12 numbered articles', async () => {
  await open(numbered, 'contract-2026-11-12');
  assert.equal(requests[0].url, '/bookings/b1/contract');
  assert.ok(container.querySelector('[data-testid="contract-document"]'));
  assert.equal(container.querySelector('[data-testid="contract-number"]').textContent, 'HĐ-20261023-55670EF2');
  const parties = section('Các bên').textContent;
  for (const text of ['Bên cho thuê', 'chưa đăng ký pháp nhân', '10008888 (số minh họa)', 'Bên thuê', 'Khách fixture', '0900000007', 'fixture@example.test', 'SYN-LICENSE · hạng B'])
    assert.ok(parties.includes(text), text);
  const trip = section('Xe, thời gian và địa điểm').textContent;
  for (const text of ['43A-000.01', '5 chỗ · Số tự động', '2 ngày', 'KDrive Đà Nẵng — 01 Fixture', 'KDrive Hà Nội — 02 Fixture'])
    assert.ok(trip.includes(text), text);
  const price = section('Giá thuê và thanh toán').textContent;
  assert.match(price, /Phí trả khác chi nhánh/);
  assert.match(price, /Tiền cọc giữ chỗ/);
  assert.match(price, /Còn lại sau cọc/);
  assert.match(price, /2\.410\.000/);
  const items = container.querySelectorAll('[data-testid^="contract-article-"]');
  assert.equal(items.length, 12);
  assert.match(items[2].textContent, /^Điều 3\. Hủy đơn và hoàn cọc3\.1\. Hủy dưới 24 giờ/);
  assert.match(items[11].textContent, /Điều 12\. Tiêu đề 1212\.1\. Khoản A của điều 12\.12\.2\. Khoản B/);
  assert.ok(!section('Điều khoản').textContent.includes('đồ án'), 'the disclaimer is not a term');
  assert.match(container.querySelector('[data-testid="contract-note"]').textContent, /^Ghi chú: Mẫu hợp đồng phục vụ đồ án/);
  assert.ok(!container.textContent.includes('c-uuid-1'), 'the readable number replaces the internal id');
});

test('without a deposit or one-way fee the price block says what is paid at the branch', async () => {
  await open({ ...numbered, oneWayFee: 0, total: 1300000, depositAmount: 0, remainingRent: 1300000, license: undefined }, 'contract-2026-11-12');
  const price = section('Giá thuê và thanh toán').textContent;
  assert.doesNotMatch(price, /Phí trả khác chi nhánh|Tiền cọc giữ chỗ|Còn lại sau cọc/);
  assert.match(price, /Thanh toán tại chi nhánh/);
  assert.doesNotMatch(section('Các bên').textContent, /Giấy phép lái xe/);
});

test('a contract issued before L7 keeps the earlier layout and its one-paragraph terms', async () => {
  await open(old, 'terms-2026-09-28');
  assert.equal(container.querySelector('[data-testid="contract-document"]'), null);
  assert.match(container.textContent, /Điều khoảnĐiều khoản cũ một đoạn\. Hợp đồng phục vụ đồ án\./);
  assert.match(container.textContent, /Khách cũ/);
  assert.match(container.textContent, /c-uuid-1/);
});
