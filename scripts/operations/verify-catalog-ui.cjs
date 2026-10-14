// Visual/component integration only: controlled HTTP responses, no backend/DB proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

async function main() {
  const out = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || fs.existsSync(out)) throw new Error('A new evidence directory is required');
  const root = path.resolve(__dirname, '../../frontend');
  const frontendRequire = createRequire(path.join(root, 'package.json'));
  const { chromium } = require(process.env.KDRIVE_PLAYWRIGHT);
  const { createServer } = await import(pathToFileURL(frontendRequire.resolve('vite')).href);
  process.env.VITE_DATA_MODE = 'api';
  process.env.VITE_API_BASE_URL = '/api/v1';
  let server, browser;
  const checks = [], errors = [];
  const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected }); };
  fs.mkdirSync(out, { recursive: true });
  try {
    server = await createServer({ root, configFile: path.join(root, 'vite.config.js'),
      server: { host: '127.0.0.1', port: 5315, strictPort: true, hmr: false } });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const brands = ['Toyota', 'Hyundai', 'Mitsubishi', 'Kia', 'Mazda', 'Honda', 'Ford', 'Suzuki', 'Nissan', 'VinFast'];
    const catalog = { brands: brands.map((name, i) => ({ id: 'brand-' + i, name })), categories: [{ id: 'sedan', name: 'Sedan' }], amenities: [] };
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: 'car-' + i, name: brands[i % 10] + ' ' + i,
      plate: '43A-' + (10000 + i), brandId: 'brand-' + (i % 10), categoryId: 'sedan', seats: 5, transmission: 'AUTO',
      dailyPrice: 650000, status: i === 18 ? 'MAINTENANCE' : i === 19 ? 'INACTIVE' : 'ACTIVE', images: [], amenities: [] }));
    await page.route('**/api/v1/**', route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().method(), 'GET', 'No business writes');
      const data = url.pathname === '/api/v1/vehicles/catalog' ? catalog : url.pathname === '/api/v1/vehicles' ? rows : null;
      assert.notEqual(data, null, 'Unexpected API request: ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('http://127.0.0.1:5315/');
    await page.locator('article.vehicle-card').first().waitFor();
    check('Page URL', page.url(), 'http://127.0.0.1:5315/');
    check('Title meaningful', (await page.title()).includes('KDrive'), true);
    check('Homepage six actual supplied rows', await page.locator('article.vehicle-card').count(), 6);
    check('No overlay', await page.locator('vite-error-overlay').count(), 0);
    const brand = page.locator('header a[href="/"]').first();
    check('Larger brand text 24px', await brand.evaluate(el => getComputedStyle(el).fontSize), '24px');
    check('Larger icon container 48px', await brand.locator('span').first().evaluate(el => el.getBoundingClientRect().width), 48);
    await page.screenshot({ path: path.join(out, 'homepage-1440.png'), fullPage: true });
    await page.getByRole('link', { name: 'Xem thêm', exact: true }).click();
    await page.waitForURL('**/vehicles');
    await page.locator('article.vehicle-card').nth(19).waitFor();
    check('All twenty catalog rows', await page.locator('article.vehicle-card').count(), 20);
    await page.getByLabel('Trạng thái xe', { exact: true }).selectOption('MAINTENANCE');
    check('Maintenance filter count', await page.locator('article.vehicle-card').count(), 1);
    check('Maintenance filter actual row', await page.locator('article.vehicle-card h2').innerText(), rows[18].name);
    await page.screenshot({ path: path.join(out, 'maintenance-1440.png'), fullPage: true });
    await page.getByLabel('Trạng thái xe', { exact: true }).selectOption('INACTIVE');
    check('Inactive filter actual row', await page.locator('article.vehicle-card h2').innerText(), rows[19].name);
    await page.getByLabel('Trạng thái xe', { exact: true }).selectOption('');
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      check('Desktop no overflow ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    check('No implementation copy', /demo|dữ liệu mẫu|tình trạng khai thác/i.test(await page.locator('body').innerText()), false);
    check('Console and runtime errors', errors, []);
    console.log('PASS visual-only assertions: ' + checks.length);
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ scope: 'Controlled HTTP visual proof, not backend E2E', checks, errors, serverClosed: true }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
