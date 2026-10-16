// Actual API proof of auth storage faults; no API interception or original DB access.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.KDRIVE_PLAYWRIGHT);
async function main() {
 const out = process.env.OTO2_EVIDENCE, origin = 'http://127.0.0.1:5382';
 assert.ok(fs.existsSync(path.join(out, 'fixture-readback.json')));
 const checks = [], errors = [];
 const check = (name, value) => { assert.equal(value, true, name); checks.push({ name, pass: true }); };
 const browser = await chromium.launch({ headless: true });
 try {
  for (const fault of ['getItem', 'setItem']) {
   const context = await browser.newContext();
   await context.addInitScript(method => {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function(key, ...args) {
     if (key === 'kdrive.jwt' || key === 'kdrive.user') throw new DOMException('Storage fault', method === 'setItem' ? 'QuotaExceededError' : 'SecurityError');
     return original.call(this, key, ...args);
    };
   }, fault);
   const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
   await p.goto(origin + (fault === 'getItem' ? '/user/bookings' : '/login'));
   if (fault === 'setItem') {
    await p.getByLabel('Email', { exact: true }).fill('user@example.test');
    await p.getByLabel('Mật khẩu', { exact: true }).fill(process.env.OTO2_SEED_PASSWORD);
    await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
   }
   await p.getByText('Không thể đọc hoặc lưu phiên', { exact: false }).first().waitFor();
   check(fault + ': app identity and meaningful storage error, no crash', (await p.title()).includes('KDrive') && new URL(p.url()).origin === origin && (await p.locator('body').innerText()).includes('Không thể đọc hoặc lưu phiên'));
   check(fault + ': no framework overlay', await p.locator('vite-error-overlay').count() === 0);
   check(fault + ': credential unavailable', await p.evaluate(async () => (await import('/src/utils/storage.js')).getStoredToken() === null));
   await context.close();
  }
  const context = await browser.newContext(), p = await context.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(origin + '/login');
  await p.getByLabel('Email', { exact: true }).fill('user@example.test');
  await p.getByLabel('Mật khẩu', { exact: true }).fill(process.env.OTO2_SEED_PASSWORD);
  await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await p.waitForURL(url => url.pathname !== '/login');
  check('normal login uses persisted credential', await p.evaluate(() => Boolean(localStorage.getItem('kdrive.jwt'))));
  await p.evaluate(() => {
   const original = Storage.prototype.removeItem;
   Storage.prototype.removeItem = function(key) { if (key === 'kdrive.jwt') throw new DOMException('Blocked', 'SecurityError'); return original.call(this, key); };
  });
  await p.locator('header button[aria-expanded]').first().click();
  const logoutResponse = p.waitForResponse(response => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST');
  await p.getByRole('button', { name: 'Đăng xuất', exact: true }).filter({ visible: true }).click();
  await p.getByText('không xóa được phiên đã lưu', { exact: false }).first().waitFor();
  check('logout hides account controls and shows login', await p.locator('header button[aria-expanded]:not([aria-label="Mở menu"])').count() === 0 && await p.locator('header').getByRole('link', { name: 'Đăng nhập', exact: true }).isVisible());
  check('leftover credential is blocked in adapter', await p.evaluate(async () => Boolean(localStorage.getItem('kdrive.jwt')) && (await import('/src/utils/storage.js')).getStoredToken() === null));
  check('server logout completed', (await logoutResponse).status() === 204);
  const revocation = await p.evaluate(async () => {
   const response = await fetch('/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('kdrive.jwt') } });
   return response.status;
  });
  check('real server revoked leftover credential', revocation === 401);
  check('runtime errors absent', errors.length === 0);
 } finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'browser-checks.json'), JSON.stringify({ checks, errors, apiMocks: false, stage6: false }, null, 2));
 }
 console.log('PASS R1a browser ' + checks.length + ' assertions');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
