import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const globals = new Map();
let dom, vite, client, Page, Router, Auth, createRoot, root, container;
let requests, handler;
const branches = ['hn', 'dn', 'ha'].map(id => ({ id, name: id.toUpperCase(), status: 'ACTIVE' }));
const routes = [
  { id: 'cross', pickupBranchId: 'dn', returnBranchId: 'hn', enabled: true, fee: 500000 },
  ...['dn', 'hn', 'ha'].map(id => ({ id, pickupBranchId: id, returnBranchId: id, enabled: true, fee: 0 })),
  { id: 'other', pickupBranchId: 'ha', returnBranchId: 'hn', enabled: true, fee: 500000 },
];
const vehicle = { id: 'v1', name: 'Fixture', currentBranchId: 'dn', status: 'ACTIVE', seats: 5, transmission: 'AUTO', dailyPrice: 1000000 };
const quote = { id: 'quote', vehicleId: 'v1', rentalDays: 2, dailyPrice: 1000000, rentalTotal: 2000000, oneWayFee: 500000, total: 2500000, pickupName: 'DN', returnName: 'HN', deposit: { required: true, amount: 600000, method: 'DEMO_QR_MANUAL' } };
const returnPolicy = { version: 'same-branch-return-v1', terms: { dailyPriceVnd: 1000000, text: 'Chính sách fixture: trả sớm giữ giá; trả muộn theo ngày Việt Nam.' }, acceptedAt: null };
function checkbox(text) { return [...container.querySelectorAll('label')].find(e => e.textContent.includes(text))?.querySelector('input[type="checkbox"]'); }

before(async () => {
  process.env.VITE_DATA_MODE = 'api';
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, Node: dom.window.Node,
    Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter: Router } = await import('react-router-dom'));
  const frontendRoot = fileURLToPath(new URL('../../..', import.meta.url));
  vite = await createServer({ root: frontendRoot, configFile: `${frontendRoot}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ default: client } = await vite.ssrLoadModule('/src/api/client.js'));
  ({ ApiNewBookingPage: Page } = await vite.ssrLoadModule('/src/pages/api/ApiScreens.jsx'));
  const auth = await vite.ssrLoadModule('/src/context/AuthContext.jsx');
  Auth = auth.default || auth.AuthContext;
});

after(async () => {
  if (root) await act(async () => root.unmount());
  await vite?.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  dom?.window.close();
});

const license = { id: 'lic-1', status: 'PENDING', version: 3, photos: { front: true, back: true, status: 'PENDING' } };
function defaults(config) {
  if (config.url === '/me/license') return license;
  if (config.url === '/branches') return branches;
  if (config.url === '/branch-routes') return routes;
  if (config.url.startsWith('/vehicles/')) return vehicle;
  if (config.url === '/bookings/quote') return quote;
  if (config.url === '/bookings') return { ...quote, id: 'created' };
  throw new Error(`Unexpected endpoint: ${config.url}`);
}
async function mount(params = '', custom = defaults) {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  requests = []; handler = custom;
  client.defaults.adapter = async config => {
    requests.push(config);
    return { config, data: await handler(config), headers: {}, status: 200, statusText: 'OK' };
  };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(Auth.Provider, { value: { user: { id: 'u1', role: 'USER' } } },
    createElement(Router, { initialEntries: [`/user/bookings/new?vehicleId=v1${params}`] }, createElement(Page)))));
}
function field(text) {
  const label = [...container.querySelectorAll('label')].find(e => e.querySelector('span')?.textContent.trim() === text);
  assert.ok(label, `Missing label ${text}`);
  return label.querySelector('select,input');
}
async function change(text, value) {
  await act(async () => {
    const el = field(text);
    const proto = el.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
function button(text) { return [...container.querySelectorAll('button')].find(e => e.textContent.trim() === text); }
test('return policy is separate required consent; re-quote and input change clear it', async () => {
 await mount('', c => c.url === '/bookings/quote' ? { ...quote, returnPolicy } : defaults(c));
 await getQuote(); assert.match(container.textContent, /Chính sách fixture/);
 await act(async () => checkbox('Tôi xác nhận thời gian').click());
 assert.equal(button('Gửi yêu cầu thuê').disabled, true);
 await act(async () => checkbox('Tôi đã đọc chính sách').click());
 assert.equal(button('Gửi yêu cầu thuê').disabled, false);
 await getQuote(); assert.equal(checkbox('Tôi đã đọc chính sách').checked, false); assert.equal(checkbox('Tôi xác nhận thời gian').checked, false);
 await act(async () => { checkbox('Tôi đã đọc chính sách').click(); checkbox('Tôi xác nhận thời gian').click(); });
 await change('Ngày trả (giờ Việt Nam)', '2026-11-09');
 assert.equal(checkbox('Tôi đã đọc chính sách'), undefined); await getQuote(); assert.equal(checkbox('Tôi đã đọc chính sách').checked, false);
 assert.equal(requests.some(c => c.url === '/bookings'), false);
});
test('create sends policy version and consent, never authoritative policy price or timestamp', async () => {
 await mount('', c => c.url === '/bookings/quote' ? { ...quote, returnPolicy } : defaults(c)); await getQuote();
 await act(async () => { checkbox('Tôi đã đọc chính sách').click(); checkbox('Tôi xác nhận thời gian').click(); });
 await act(async () => button('Gửi yêu cầu thuê').click());
 const sent=JSON.parse(requests.find(c => c.url === '/bookings').data);
 assert.equal(sent.returnPolicyVersion, 'same-branch-return-v1'); assert.equal(sent.returnPolicyAccepted, true); assert.equal(sent.returnPolicy, undefined); assert.equal(sent.returnPolicyAcceptedAt, undefined);
});
test('policy refusal clears consent and requires a new quote without demo fallback', async () => {
 await mount('', c => { if(c.url === '/bookings/quote') return { ...quote, returnPolicy }; if(c.url === '/bookings') throw { response: { status: 409, data: { message: 'Chính sách đã thay đổi' } } }; return defaults(c); });
 await getQuote(); await act(async () => { checkbox('Tôi đã đọc chính sách').click(); checkbox('Tôi xác nhận thời gian').click(); }); await act(async () => button('Gửi yêu cầu thuê').click());
 assert.match(container.textContent, /Chính sách đã thay đổi/); assert.equal(button('Gửi yêu cầu thuê'), undefined);
 await getQuote(); assert.equal(checkbox('Tôi đã đọc chính sách').checked, false); assert.equal(requests.filter(c => c.url === '/bookings').length, 1);
});
async function getQuote() {
  await act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('real form defaults to current branch/self-route regardless of branch or route order', async () => {
  for (const reversed of [false, true]) {
    await mount('', c => c.url === '/branch-routes' ? (reversed ? [...routes].reverse() : routes) : defaults(c));
    assert.equal(field('Chi nhánh nhận xe').value, 'dn');
    assert.equal(field('Chi nhánh trả xe').value, 'dn');
    await change('Chi nhánh nhận xe', 'hn');
    assert.equal(field('Chi nhánh trả xe').value, 'hn');
  }
});
test('explicit route params are preserved, kept across compatible pickup, cleared when incompatible', async () => {
  await mount('&pickupBranchId=dn&returnBranchId=hn');
  assert.equal(field('Chi nhánh trả xe').value, 'hn');
  await change('Chi nhánh nhận xe', 'ha');
  assert.equal(field('Chi nhánh trả xe').value, 'hn');
  await mount('&pickupBranchId=dn&returnBranchId=ha');
  assert.equal(field('Chi nhánh trả xe').value, '');
  assert.equal(button('Kiểm tra lịch & báo giá').disabled, true);
});
test('customer explicit other return is cleared rather than silently charged on incompatible pickup', async () => {
  await mount(); await change('Chi nhánh trả xe', 'hn');
  await change('Chi nhánh nhận xe', 'ha');
  assert.equal(field('Chi nhánh trả xe').value, 'hn');
  await change('Chi nhánh nhận xe', 'dn');
  assert.equal(field('Chi nhánh trả xe').value, 'hn');
  await mount('', c => c.url === '/branch-routes' ? routes.filter(r => r.id !== 'other') : defaults(c));
  await change('Chi nhánh trả xe', 'hn'); await change('Chi nhánh nhận xe', 'ha');
  assert.equal(field('Chi nhánh trả xe').value, '');
  assert.equal(button('Kiểm tra lịch & báo giá').disabled, true);
});
test('missing self-route never falls back to first paid route; invalid params and inactive/disabled routes stay unselected', async () => {
  await mount('', c => c.url === '/branch-routes' ? routes.filter(r => r.id !== 'dn') : defaults(c));
  assert.equal(field('Chi nhánh trả xe').value, '');
  assert.match(container.textContent, /không tự chọn tuyến có phí/);
  await getQuote(); assert.equal(requests.some(c => c.url === '/bookings/quote'), false);
  await change('Chi nhánh trả xe', 'hn'); assert.equal(button('Kiểm tra lịch & báo giá').disabled, false);
  await mount('&pickupBranchId=bad'); assert.equal(field('Chi nhánh nhận xe').value, '');
  await mount('&pickupBranchId=dn&returnBranchId=hn', c => c.url === '/branches' ? branches.map(b => b.id === 'hn' ? { ...b, status: 'INACTIVE' } : b) : defaults(c));
  assert.equal(field('Chi nhánh trả xe').value, '');
  await mount('&pickupBranchId=dn&returnBranchId=hn', c => c.url === '/branch-routes' ? routes.map(r => r.id === 'cross' ? { ...r, enabled: false } : r) : defaults(c));
  assert.equal(field('Chi nhánh trả xe').value, '');
});
test('empty/error/loading route data cannot quote or pick a paid fallback; delayed data resolves to self-route', async () => {
  let finish;
  await mount('', c => c.url === '/branch-routes' ? new Promise(resolve => { finish = resolve; }) : defaults(c));
  assert.equal(container.querySelector('form'), null);
  await act(async () => finish(routes));
  assert.equal(field('Chi nhánh trả xe').value, 'dn');
  await mount('', c => c.url === '/branch-routes' ? [] : defaults(c));
  assert.equal(button('Kiểm tra lịch & báo giá').disabled, true);
  await mount('', c => { if (c.url === '/branch-routes') throw Error('offline'); return defaults(c); });
  assert.equal(container.querySelector('form'), null);
  assert.ok(button('Thử lại') || /offline|Không thể/.test(container.textContent));
});
test('quote renders backend deposit excluding fee and remaining without adding deposit twice', async () => {
  await mount('&pickupBranchId=dn&returnBranchId=hn'); await getQuote();
  const preview = container.querySelector('[aria-label="Cọc giữ chỗ dự kiến"]');
  assert.ok(preview); assert.match(preview.textContent, /600.000/); assert.match(preview.textContent, /1.900.000/);
  assert.match(preview.textContent, /Không chuyển tiền thật/);
  assert.match(container.querySelector('[aria-label="Báo giá chuyến đi"]').textContent, /2.500.000/);
  assert.doesNotMatch(container.textContent, /Tiền cọc hoặc khoản chưa được cấu hình/);
  await mount('', c => c.url === '/bookings/quote' ? { ...quote, deposit: { required: true, amount: 600001, method: 'DEMO_QR_MANUAL' } } : defaults(c));
  await getQuote(); assert.match(container.textContent, /600.001/); assert.match(container.textContent, /1.899.999/);
  await mount('', c => c.url === '/bookings/quote' ? { ...quote, deposit: { required: false, amount: 0 } } : defaults(c));
  await getQuote(); assert.match(container.textContent, /Báo giá này không yêu cầu cọc giữ chỗ\./);
  assert.equal(container.querySelector('[aria-label="Cọc giữ chỗ dự kiến"]'), null);
  assert.doesNotMatch(container.textContent, /QR DEMO/);
  // Only one deposit message on a no-deposit quote: the generic warning no longer says the deposit is re-checked.
  assert.doesNotMatch(container.textContent, /chính sách cọc|số cọc/);
  assert.equal((container.textContent.match(/cọc/g) || []).length, 1);
});
test('quote tells where the remaining rent is paid, following the backend remaining-rent policy', async () => {
  await mount('', c => c.url === '/bookings/quote' ? { ...quote, deposit: { required: false, amount: 0 }, rentalBalance: { policy: 'rental-balance-v1', dueAmount: 2500000, status: 'DUE', demo: true, recorded: null } } : defaults(c));
  await getQuote();
  assert.match(container.querySelector('[data-testid="quote-remainder"]').textContent, /Phần còn lại 2\.500\.000\s₫ thanh toán tại chi nhánh nhận trước khi nhận xe/);
  assert.equal((container.textContent.match(/cọc/g) || []).length, 1, 'still one deposit message on a no-deposit quote');
  await mount('&pickupBranchId=dn&returnBranchId=hn'); await getQuote();
  assert.match(container.querySelector('[data-testid="quote-remainder"]').textContent, /không ghi nhận khoản này cho báo giá này/);
});
test('deposit quote keeps both amounts and says only the deposit amount is re-checked on submit', async () => {
  await mount('&pickupBranchId=dn&returnBranchId=hn'); await getQuote();
  assert.match(container.textContent, /số cọc được kiểm tra lại khi gửi yêu cầu/);
  assert.doesNotMatch(container.textContent, /không yêu cầu cọc/);
});

function readinessBox() { return container.querySelector('[aria-label="Điều kiện GPLX"]'); }
function linkTo(text) { return [...container.querySelectorAll('a')].find(a => a.textContent.trim() === text); }
const withLicense = value => c => c.url === '/me/license' ? value : defaults(c);

test('missing GPLX photos are shown before quoting; quote still works but sending is blocked with a reason', async () => {
  await mount('&start=2030-11-10&end=2030-11-12&pickupBranchId=dn&returnBranchId=hn', withLicense({ ...license, photos: { front: true, back: false, status: 'MISSING' } }));
  assert.equal(readinessBox().dataset.state, 'MISSING_PHOTOS');
  assert.match(readinessBox().textContent, /GPLX còn thiếu ảnh hai mặt/);
  const cta = linkTo('Bổ sung ảnh GPLX');
  assert.ok(cta, 'CTA to add photos');
  const returnTo = new URL(cta.href).searchParams.get('returnTo');
  const back = new URL(returnTo, 'http://localhost');
  assert.equal(back.pathname, '/user/bookings/new');
  assert.deepEqual(['vehicleId', 'start', 'end', 'pickupBranchId', 'returnBranchId'].map(k => back.searchParams.get(k)), ['v1', '2030-11-10', '2030-11-12', 'dn', 'hn']);
  await getQuote();
  assert.ok(requests.some(c => c.url === '/bookings/quote'), 'quote is still allowed without photos');
  await act(async () => checkbox('Tôi xác nhận thời gian').click());
  assert.equal(button('Gửi yêu cầu thuê').disabled, true);
  assert.match(container.textContent, /Chưa gửi được: Cần tải đủ hai mặt ảnh GPLX/);
  await act(async () => button('Gửi yêu cầu thuê').click());
  assert.equal(requests.some(c => c.url === '/bookings'), false);
});
test('return link follows the trip currently on the form, not the original URL', async () => {
  await mount('&pickupBranchId=dn&returnBranchId=dn', withLicense({ ...license, photos: { front: false, back: false, status: 'MISSING' } }));
  await change('Chi nhánh trả xe', 'hn');
  await change('Ngày trả (giờ Việt Nam)', '2030-12-01');
  const back = new URL(new URL(linkTo('Bổ sung ảnh GPLX').href).searchParams.get('returnTo'), 'http://localhost');
  assert.equal(back.searchParams.get('returnBranchId'), 'hn');
  assert.equal(back.searchParams.get('end'), '2030-12-01');
});
test('no saved licence blocks sending and offers to declare one', async () => {
  for (const value of [null, '']) {
    await mount('', withLicense(value));
    assert.equal(readinessBox().dataset.state, 'NO_LICENSE');
    assert.ok(linkTo('Khai báo GPLX'));
    await getQuote(); await act(async () => checkbox('Tôi xác nhận thời gian').click());
    assert.equal(button('Gửi yêu cầu thuê').disabled, true);
  }
});
test('photos needing changes or awaiting review do not block sending; staff note is shown', async () => {
  await mount('', withLicense({ ...license, photos: { front: true, back: true, status: 'NEEDS_CHANGES', reason: 'Ảnh mặt sau bị mờ' } }));
  assert.equal(readinessBox().dataset.state, 'NEEDS_CHANGES');
  assert.match(readinessBox().textContent, /Ảnh mặt sau bị mờ/);
  assert.ok(linkTo('Thay ảnh GPLX'));
  await getQuote(); await act(async () => checkbox('Tôi xác nhận thời gian').click());
  assert.equal(button('Gửi yêu cầu thuê').disabled, false);
  await mount('', withLicense({ ...license, photos: { front: true, back: true, status: 'APPROVED' } }));
  assert.equal(readinessBox().dataset.state, 'APPROVED');
  assert.doesNotMatch(container.textContent, /Chưa gửi được/);
});
test('licence load failure is reported without guessing, can be retried and does not block sending', async () => {
  let fail = true;
  await mount('', c => { if (c.url === '/me/license' && fail) throw Error('offline'); return defaults(c); });
  assert.equal(readinessBox().dataset.state, 'ERROR');
  assert.doesNotMatch(readinessBox().textContent, /thiếu ảnh|đủ ảnh/);
  await getQuote(); await act(async () => checkbox('Tôi xác nhận thời gian').click());
  assert.equal(button('Gửi yêu cầu thuê').disabled, false);
  fail = false;
  await act(async () => button('Tải lại hồ sơ GPLX').click());
  assert.equal(readinessBox().dataset.state, 'PENDING_REVIEW');
});
test('backend GPLX refusal still links to the profile with the return path', async () => {
  await mount('', c => { if (c.url === '/bookings') throw { response: { status: 400, data: { message: 'Vui lòng tải đủ ảnh hai mặt GPLX trong Hồ sơ & GPLX trước khi gửi yêu cầu thuê.' } } }; return defaults(c); });
  await getQuote(); await act(async () => checkbox('Tôi xác nhận thời gian').click());
  await act(async () => button('Gửi yêu cầu thuê').click());
  const cta = linkTo('Cập nhật giấy phép lái xe');
  assert.ok(cta); assert.match(new URL(cta.href).searchParams.get('returnTo'), /^\/user\/bookings\/new\?/);
});
test('changing route after quote clears acceptance and stale async quote cannot reappear', async () => {
  await mount(); await getQuote();
  await act(async () => container.querySelector('input[type="checkbox"]').click());
  assert.equal(button('Gửi yêu cầu thuê').disabled, false);
  await change('Chi nhánh trả xe', 'hn');
  assert.equal(button('Gửi yêu cầu thuê'), undefined);
  let old;
  handler = c => c.url === '/bookings/quote' ? new Promise(resolve => { old = resolve; }) : defaults(c);
  await getQuote(); await change('Chi nhánh nhận xe', 'ha');
  await act(async () => old(quote));
  assert.equal(container.querySelector('[aria-label="Báo giá chuyến đi"]'), null);
  assert.equal(requests.some(c => c.url === '/bookings'), false);
});

test('both date fields invalidate a quote and acceptance; quote failure cannot expose old money', async () => {
  for (const label of ['Ngày nhận (giờ Việt Nam)', 'Ngày trả (giờ Việt Nam)']) {
    await mount(); await getQuote();
    await act(async () => container.querySelector('input[type="checkbox"]').click());
    await change(label, '2030-11-10');
    assert.equal(button('Gửi yêu cầu thuê'), undefined);
    assert.equal(container.querySelector('[aria-label="Cọc giữ chỗ dự kiến"]'), null);
  }
  await mount(); await getQuote(); await change('Chi nhánh trả xe', 'hn');
  handler = c => { if (c.url === '/bookings/quote') throw Error('Quote unavailable'); return defaults(c); };
  await getQuote();
  assert.equal(container.querySelector('[aria-label="Cọc giữ chỗ dự kiến"]'), null);
  assert.equal(button('Gửi yêu cầu thuê'), undefined);
  assert.match(container.textContent, /Quote unavailable|Không thể kiểm tra/);
});
