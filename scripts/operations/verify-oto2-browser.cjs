// Real MySQL/backend flow. No network interception or mocked application data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.KDRIVE_PLAYWRIGHT);
async function main() {
  const out = process.env.OTO2_EVIDENCE;
  assert.ok(out && fs.existsSync(path.join(out, 'fixture-readback.json')));
  const checks = [], errors = [];
  const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected }); };
  const origin = 'http://127.0.0.1:5382';
  const browser = await chromium.launch({ headless: true });
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    p.setDefaultTimeout(15000);
    p.on('pageerror', error => errors.push(error.message));
    p.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const startDate = new Date(Date.now() + 5 * 86400000);
    const start = startDate.toISOString().slice(0,10) + 'T10:00';
    const end = new Date(startDate.getTime() + 86400000).toISOString().slice(0,10) + 'T10:00';
    await p.goto(origin + '/vehicles');
    await p.locator('article.vehicle-card').first().waitFor();
    check('Page title', (await p.title()).includes('KDrive'), true);
    check('Initial inventory', await p.locator('article.vehicle-card').count(), 3);
    const form = p.getByRole('form', { name: 'Tìm xe theo chuyến' });
    await form.getByLabel('Thời gian nhận', { exact: true }).fill(start);
    await form.getByLabel('Thời gian trả', { exact: true }).fill(end);
    await form.getByLabel('Điểm nhận', { exact: true }).selectOption('dn');
    await form.getByLabel('Điểm trả', { exact: true }).selectOption('hn');
    await form.getByLabel('Ngân sách cả chuyến (VND)').fill('2150000');
    check('Primary search button visibly styled', await form.getByRole('button', { name: 'Tìm xe trống', exact: true }).evaluate(button => parseFloat(getComputedStyle(button).paddingTop) >= 10 && getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)'), true);
    await form.getByRole('button', { name: 'Tìm xe trống', exact: true }).click();
    await p.waitForURL('**/vehicles?*start=*');
    await p.getByText('Tổng chuyến:', { exact: false }).first().waitFor();
    const searchUrl = p.url();
    check('One-day total inclusive boundary', (await p.locator('article.vehicle-card').allTextContents()).some(t => t.includes('Toyota Vios') && t.includes('2.150.000')), true);
    check('No framework overlay', await p.locator('vite-error-overlay').count(), 0);
    for (const width of [1280,1440]) {
      await p.setViewportSize({ width, height: 1000 });
      check('No horizontal overflow ' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await p.screenshot({ path: path.join(out, 'trip-results-1440.png'), fullPage: true });
    await p.reload();
    await p.getByText('Tổng chuyến:', { exact: false }).first().waitFor();
    check('Reload preserves URL', p.url(), searchUrl);
    const carLink = p.locator('article.vehicle-card h2 a').filter({ hasText: 'Toyota Vios' });
    const detailUrl = new URL(await carLink.getAttribute('href'), origin);
    const vehicleId = detailUrl.pathname.split('/').pop();
    await carLink.click();
    await p.getByRole('link', { name: 'Về danh sách xe', exact: true }).waitFor();
    check('Detail preserves trip', new URL(p.url()).searchParams.get('start'), start);
    await p.locator('a[href^="/user/bookings/new?"]').click();
    await p.waitForURL('**/login');
    await p.getByLabel('Email', { exact: true }).fill('user@example.test');
    await p.getByLabel('Mật khẩu', { exact: true }).fill(process.env.OTO2_SEED_PASSWORD);
    await p.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await p.waitForURL('**/user/bookings/new?*');
    await p.getByLabel('Thời gian nhận (giờ Việt Nam)', { exact: true }).waitFor();
    check('Login retains chosen vehicle', new URL(p.url()).searchParams.get('vehicleId'), vehicleId);
    check('Booking pickup prefilled', await p.getByLabel('Chi nhánh nhận xe', { exact: true }).inputValue(), 'dn');
    check('Booking return prefilled', await p.getByLabel('Chi nhánh trả xe', { exact: true }).inputValue(), 'hn');
    check('Booking start prefilled', await p.getByLabel('Thời gian nhận (giờ Việt Nam)', { exact: true }).inputValue(), start);
    check('Booking back link retains budget', new URL(await p.getByRole('link', { name: 'Quay lại danh sách xe', exact: true }).getAttribute('href'), origin).searchParams.get('budget'), '2150000');
    await p.getByRole('button', { name: 'Kiểm tra lịch & báo giá', exact: true }).click();
    await p.getByText('2.150.000', { exact: false }).first().waitFor();
    await p.screenshot({ path: path.join(out, 'prefilled-quote-1440.png'), fullPage: true });
    await p.goto(searchUrl.replace('budget=2150000','budget=2099999'));
    await p.getByText('Không tìm thấy xe', { exact: true }).waitFor();
    check('Under-budget has no unchecked catalog fallback', await p.locator('article.vehicle-card').count(), 0);
    check('Runtime/console errors', errors, []);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'browser-checks.json'), JSON.stringify({ checks, errors, mocks: false, browserPath: 'Browser plugin not available (no browser skill); regular Playwright' }, null, 2));
  }
  console.log('PASS trip search real browser ' + checks.length);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
