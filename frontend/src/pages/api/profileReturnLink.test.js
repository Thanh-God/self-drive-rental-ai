import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const globals = new Map();
let dom, vite, client, Page, Router, Auth, createRoot, root, container;
const profile = { id: 'u1', fullName: 'Khách thử', email: 'user@example.test', version: 1 };
const fullLicense = { id: 'lic-1', status: 'VERIFIED', version: 3, licenseNumber: 'X', scheme: 'VN_2025', licenseClass: 'B', expiresOn: '2030-12-31', photos: { front: true, back: true, status: 'PENDING' } };
const backPath = '/user/bookings/new?vehicleId=v1&start=2030-11-10&end=2030-11-12&pickupBranchId=dn&returnBranchId=hn';

before(async () => {
  process.env.VITE_DATA_MODE = 'api';
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, Node: dom.window.Node,
    Event: dom.window.Event, FormData: dom.window.FormData, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ MemoryRouter: Router } = await import('react-router-dom'));
  const frontendRoot = fileURLToPath(new URL('../../..', import.meta.url));
  vite = await createServer({ root: frontendRoot, configFile: `${frontendRoot}/vite.config.js`, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ default: client } = await vite.ssrLoadModule('/src/api/client.js'));
  ({ ApiProfilePage: Page } = await vite.ssrLoadModule('/src/pages/api/ApiScreens.jsx'));
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

async function mount(search, license = fullLicense) {
  if (root) await act(async () => root.unmount());
  document.body.replaceChildren();
  client.defaults.adapter = async config => {
    const data = config.url === '/auth/me' ? profile : config.url === '/me/license' ? license : null;
    if (data === null && config.url !== '/me/license') throw new Error(`Unexpected endpoint: ${config.url}`);
    return { config, data, headers: {}, status: 200, statusText: 'OK' };
  };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const auth = { user: { id: 'u1', role: 'USER' }, token: null, logout: async () => {}, refreshUser: () => {} };
  await act(async () => root.render(createElement(Auth.Provider, { value: auth },
    createElement(Router, { initialEntries: [`/user/profile${search}`] }, createElement(Page)))));
}
const backLink = () => [...container.querySelectorAll('a')].find(a => a.textContent.trim() === 'Quay lại báo giá');

test('a valid return path shows "Quay lại báo giá" to the exact booking form', async () => {
  await mount(`?returnTo=${encodeURIComponent(backPath)}`);
  const link = backLink();
  assert.ok(link);
  const url = new URL(link.href);
  assert.equal(`${url.pathname}${url.search}`, backPath);
  assert.match(container.textContent, /đã đủ ảnh hai mặt/);
});
test('a profile still missing photos says so next to the return link', async () => {
  await mount(`?returnTo=${encodeURIComponent(backPath)}`, { ...fullLicense, photos: { front: false, back: false, status: 'MISSING' } });
  assert.ok(backLink());
  assert.match(container.textContent, /tải đủ hai mặt ảnh/);
  await mount(`?returnTo=${encodeURIComponent(backPath)}`, null);
  assert.ok(backLink(), 'no licence yet still offers the way back');
});
test('external, protocol-relative or other internal targets are ignored', async () => {
  for (const bad of ['https://evil.com/x', '//evil.com/user/bookings/new?vehicleId=v1', '/admin/accounts', 'javascript:alert(1)']) {
    await mount(`?returnTo=${encodeURIComponent(bad)}`);
    assert.equal(backLink(), undefined, bad);
  }
  await mount('');
  assert.equal(backLink(), undefined);
});
test('physical check label is separated from the photo review', async () => {
  await mount('', { ...fullLicense, photos: { front: false, back: false, status: 'MISSING' } });
  assert.match(container.textContent, /Đối chiếu bản gốc tại chi nhánh: Đã đối chiếu/);
  assert.doesNotMatch(container.textContent, /Trạng thái xác minh/);
  assert.match(container.textContent, /Chưa đủ ảnh/);
});
