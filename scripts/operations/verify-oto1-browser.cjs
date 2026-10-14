// Actual API/MySQL catalog visual proof. No route interception or mocked responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.KDRIVE_PLAYWRIGHT);
async function main() {
  const out = process.env.OTO1_EVIDENCE;
  if (!out || !fs.existsSync(path.join(out, 'readback.json'))) throw new Error('Native readback evidence required');
  const readback = JSON.parse(fs.readFileSync(path.join(out, 'readback.json'), 'utf8'));
  const checks = [], errors = [];
  const check = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected }); };
  const browser = await chromium.launch({ headless: true });
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    p.setDefaultTimeout(15000);
    await p.goto('http://127.0.0.1:5381/');
    await p.locator('article.vehicle-card').first().waitFor();
    check('Page identity', p.url(), 'http://127.0.0.1:5381/');
    check('Title', (await p.title()).includes('KDrive'), true);
    check('Actual homepage count', await p.locator('article.vehicle-card').count(), 6);
    check('No framework overlay', await p.locator('vite-error-overlay').count(), 0);
    await p.screenshot({ path: path.join(out, 'homepage-real-1440.png'), fullPage: true });
    await p.getByRole('link', { name: 'Xem thêm', exact: true }).click();
    await p.waitForURL('**/vehicles');
    await p.locator('article.vehicle-card').nth(19).waitFor();
    check('Actual catalog count', await p.locator('article.vehicle-card').count(), 20);
    check('API brand inventory', readback.catalog.brands.length, 10);
    const nav = p.getByRole('navigation', { name: 'Lọc theo hãng xe' });
    await nav.getByRole('button').click();
    check('All ten brands exposed', await nav.getByRole('link').count(), 11);
    await nav.getByRole('link', { name: 'VinFast', exact: true }).click();
    await p.waitForURL('**/vehicles?brand=*');
    await p.waitForFunction(() => document.querySelectorAll('article.vehicle-card').length === 2);
    check('Brand filters actual rows', await p.locator('article.vehicle-card h2').allTextContents(), ['VinFast VF 5', 'VinFast VF 6']);
    const target = readback.vehicles.find(v => v.name === 'VinFast VF 6');
    await p.locator('a[href="/vehicles/' + target.id + '"]').first().click();
    await p.waitForURL('**/vehicles/' + target.id);
    await p.locator('.vehicle-gallery img').first().waitFor();
    await p.waitForFunction(() => [...document.querySelectorAll('.vehicle-gallery img')].every(img => img.complete && img.naturalWidth > 0));
    check('Correct actual cover URL', await p.locator('.vehicle-gallery img').first().getAttribute('src'), target.images[0].url);
    check('Credit visible', (await p.locator('.image-credit').innerText()).includes('creativecommons.org'), true);
    check('No test copy in public detail', /DEMO|Xe mẫu cho kiểm thử/.test(await p.locator('body').innerText()), false);
    await p.screenshot({ path: path.join(out, 'detail-real-1440.png'), fullPage: true });
    await p.goto('http://127.0.0.1:5381/media/vehicles/expansion-licenses.html');
    await p.waitForFunction(() => document.querySelectorAll('article img').length === 17 && [...document.querySelectorAll('article img')].every(i => i.complete && i.naturalWidth > 0));
    check('Seventeen licensed assets decode in browser', await p.locator('article img').count(), 17);
    // Contact-sheet styling is QA-only, for visual inspection of all cover mappings.
    await p.addStyleTag({ content: 'body{max-width:none;margin:12px;padding:0;font:11px/1.2 system-ui}article{display:inline-block;vertical-align:top;width:23%;height:235px;padding:8px;overflow:hidden}article img{width:100%;height:150px;object-fit:contain}article h2{font-size:13px;margin:5px 0}article p{font-size:8px;margin:3px 0}article p:last-child{display:none}' });
    await p.screenshot({ path: path.join(out, 'asset-contact-sheet.png'), fullPage: true });
    await p.goto('http://127.0.0.1:5381/vehicles');
    await p.locator('article.vehicle-card').nth(19).waitFor();
    for (const width of [1280, 1440]) {
      await p.setViewportSize({ width, height: 1000 });
      check('No horizontal overflow ' + width, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    check('Runtime/console errors', errors, []);
    console.log('PASS real catalog browser ' + checks.length);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'browser-checks.json'), JSON.stringify({ checks, errors, mocks: false }, null, 2));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
