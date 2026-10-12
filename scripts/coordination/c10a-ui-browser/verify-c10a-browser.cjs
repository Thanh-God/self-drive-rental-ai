const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deferred, dispatcher, bounded, assertNoUnexpected } = require('../c8-account-assignment-browser/browser-controls.cjs');
const playwrightModule = process.env.C10A_PLAYWRIGHT_MODULE || path.resolve(__dirname, '../../../.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright');
const { chromium } = require(playwrightModule);

const base = process.env.C10A_BASE_URL, api = process.env.C10A_API_BASE_URL;
const evidence = process.env.C10A_EVIDENCE_DIR, schema = process.env.C10A_SCHEMA;
const container = process.env.C10A_CONTAINER;
const dbPassword = process.env.C10A_DB_PASSWORD;
const seedPassword = process.env.C10A_SEED_PASSWORD;
const markerSchema = process.env.C10A_MARKER_SCHEMA;
const markerToken = process.env.C10A_MARKER_TOKEN;

const checks = [], http = [], consoleIssues = [], expected = [];
let browser;

function record(name, actual, wanted) {
  assert.deepEqual(actual, wanted, name);
  checks.push({ name, actual, expected: wanted, passed: true });
  console.log(`PASS ${name}`);
}

function sql(query) {
  const result = spawnSync('docker', [
    'exec', '-e', `MYSQL_PWD=${dbPassword}`, container,
    'mysql', '-uroot', '--batch', '--raw', '--skip-column-names',
    '-e', `USE ${schema}; ${query}`
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, `SQL command failed: ${result.stderr}`);
  return result.stdout.trim();
}

const q = value => `'${String(value).replaceAll("'", "''")}'`;

function monitor(page) {
  page.on('response', r => {
    if (r.status() >= 400) {
      http.push({ method: r.request().method(), url: r.url(), status: r.status() });
    }
  });
  page.on('requestfailed', r => http.push({ method: r.method(), url: r.url(), failure: r.failure()?.errorText }));
  page.on('pageerror', e => consoleIssues.push({ type: 'pageerror', text: e.message }));
  page.on('console', m => {
    if (m.type() === 'error') consoleIssues.push({ type: 'console', text: m.text(), url: m.location()?.url });
  });
}

async function checkNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  record(`${label} no horizontal overflow`, overflow, false);
}

async function main() {
  assert.match(schema, /^kdrive_c10a_[a-f0-9]+$/);
  record('Isolated marker', sql(`SELECT COUNT(*) FROM ${markerSchema}.__kdrive_test_fixture_marker WHERE target_schema=${q(schema)} AND marker_token=${q(markerToken)};`), '1');

  // Login Admin
  const login = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: seedPassword })
  });
  record('Admin login', login.status, 200);
  const { token } = await login.json();
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(tok => {
    if (!localStorage.getItem('kdrive.jwt')) localStorage.setItem('kdrive.jwt', tok);
  }, token);

  const scenarios = new Map();
  await context.route('**/api/v1/**', dispatcher(scenarios));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  monitor(page);

  // 1. Lấy 1 xe mẫu từ database để test
  const vehicleId = sql(`SELECT id FROM vehicles WHERE status='ACTIVE' ORDER BY id LIMIT 1;`);
  assert.ok(vehicleId, 'Phải có ít nhất 1 xe ACTIVE');
  const vehicleName = sql(`SELECT name FROM vehicles WHERE id=${q(vehicleId)};`);

  const stamp=Date.now();
  const created=[];
  for(const name of [`Bluetooth UI ${stamp}`,`Camera UI ${stamp}`]) {
    const response=await fetch(`${api}/admin/amenities`,{method:'POST',headers,body:JSON.stringify({name})});
    record('Create isolated catalog fixture via actual API',response.status,201);created.push(await response.json());
  }
  const [am1,am2]=created;
  const otherVehicle=sql(`SELECT id FROM vehicles WHERE id<>${q(vehicleId)} ORDER BY id LIMIT 1;`);
  const otherRead=await (await fetch(`${api}/admin/vehicles/${otherVehicle}/amenities`,{headers})).json();
  const otherWrite=await fetch(`${api}/admin/vehicles/${otherVehicle}/amenities`,{method:'PUT',headers,body:JSON.stringify({amenityIds:[am2.id],expectedRevision:otherRead.revision})});
  record('Independent second vehicle fixture',otherWrite.status,200);
  const otherBefore=sql(`SELECT amenity_id FROM vehicle_amenities WHERE vehicle_id=${q(otherVehicle)} ORDER BY amenity_id;`);
  // Clear sạch links ban đầu của xe đó để có baseline sạch
  const initialGet = await (await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, { headers })).json();
  await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ amenityIds: [], expectedRevision: initialGet.revision })
  });
  record('Initial links cleared SQL', sql(`SELECT COUNT(*) FROM vehicle_amenities WHERE vehicle_id=${q(vehicleId)};`), '0');

  // 2. Vào trang Admin Quản lý xe
  await page.goto(`${base}/admin/vehicles`);
  await page.getByRole('heading', { name: 'Quản lý xe', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');

  // Tìm article chứa xe và click Chỉnh sửa
  const vehicleArticle = page.locator('article', { hasText: vehicleName }).first();
  await vehicleArticle.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();

  // Chờ form Tiện nghi xe xuất hiện
  const amenityForm = page.getByRole('form', { name: 'Tiện nghi xe' });
  await amenityForm.waitFor();
  record('Amenity form visible for edited vehicle', await amenityForm.isVisible(), true);

  // Chọn tiện nghi 1 (am1)
  const am1Checkbox = amenityForm.getByLabel(am1.name, { exact: true });
  await am1Checkbox.check();
  record('Checkbox 1 checked', await am1Checkbox.isChecked(), true);

  // Lưu tiện nghi và kiểm tra pending 1 PUT
  const putKey = `PUT ${base}/api/v1/admin/vehicles/${vehicleId}/amenities`;
  const pr = deferred(), pl = deferred(), pf = deferred();
  scenarios.set(putKey, { reached: pr, release: pl, finished: pf, count: 0 });

  await amenityForm.getByRole('button', { name: 'Lưu tiện nghi', exact: true }).click();
  await bounded(pr.promise, 'PUT reached backend');

  // Dispatch double-submit khi đang chờ
  await amenityForm.evaluate(f => {
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  record('Held response actual PUT 1', scenarios.get(putKey).count, 1);
  pl.resolve();
  await bounded(pf.promise, 'PUT finished');
  scenarios.delete(putKey);

  // Chờ thông báo thành công
  await amenityForm.getByText('Đã lưu tiện nghi thành công.', { exact: true }).waitFor();

  // Readback SQL kiểm tra link thực sự tồn tại trong DB
  record('SQL readback amenity assigned', sql(`SELECT COUNT(*) FROM vehicle_amenities WHERE vehicle_id=${q(vehicleId)} AND amenity_id=${q(am1.id)};`), '1');

  const invalidScenario={error:400,message:'Controlled invalid amenity selection',count:0};
  scenarios.set(putKey,invalidScenario);expected.push({method:'PUT',url:`${base}/api/v1/admin/vehicles/${vehicleId}/amenities`,status:400});
  await amenityForm.getByRole('button',{name:'Lưu tiện nghi',exact:true}).click();
  await amenityForm.getByText('Controlled invalid amenity selection',{exact:true}).waitFor();scenarios.delete(putKey);
  record('400 selection preserved',await amenityForm.getByLabel(am1.name,{exact:true}).isChecked(),true);
  record('400 pending guard released',await amenityForm.getByRole('button',{name:'Lưu tiện nghi',exact:true}).isEnabled(),true);

  // 3. Stale update conflict (409) và phục hồi
  // Operator cập nhật ngầm bên ngoài
  const freshApiGet = await (await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, { headers })).json();
  const operatorPut = await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ amenityIds: [am1.id, am2.id], expectedRevision: freshApiGet.revision })
  });
  record('Concurrent operator PUT status', operatorPut.status, 200);

  // UI submit với revision cũ (gặp 409)
  expected.push({ method: 'PUT', url: `${base}/api/v1/admin/vehicles/${vehicleId}/amenities`, status: 409 });
  await amenityForm.getByRole('button', { name: 'Lưu tiện nghi', exact: true }).click();

  // Kiểm tra lỗi 409 xuất hiện rõ ràng, không claim thành công
  await amenityForm.getByText(/409/, { exact: false }).waitFor();
  record('409 error visible on UI', await amenityForm.getByText(/409/).isVisible(), true);
  record('409 never claims success',await amenityForm.getByText('Đã lưu tiện nghi thành công.',{exact:true}).count(),0);
  record('No overwrite on stale', sql(`SELECT COUNT(*) FROM vehicle_amenities WHERE vehicle_id=${q(vehicleId)};`), '2');

  // Click "Tải lại bản mới"
  await amenityForm.getByRole('button', { name: 'Tải lại bản mới', exact: true }).click();
  await amenityForm.getByLabel(am2.name,{exact:true}).waitFor();
  record('Fresh checkbox state after reload',await amenityForm.getByLabel(am2.name,{exact:true}).isChecked(),true);
  await amenityForm.getByLabel(am2.name,{exact:true}).uncheck();
  const recover={count:0};scenarios.set(putKey,recover);
  await amenityForm.getByRole('button',{name:'Lưu tiện nghi',exact:true}).click();
  await amenityForm.getByText('Đã lưu tiện nghi thành công.',{exact:true}).waitFor();
  await page.waitForLoadState('networkidle');scenarios.delete(putKey);
  const operatorState=await (await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`,{headers})).json();
  record('Recovery PUT actual one request',recover.count,1);
  record('Recovery PUT uses fresh operator revision',recover.payload.expectedRevision,(await operatorPut.clone().json()).revision);
  record('Recovery SQL keeps selected ID',sql(`SELECT amenity_id FROM vehicle_amenities WHERE vehicle_id=${q(vehicleId)};`),am1.id);
  record('Recovery response/current read agrees',operatorState.amenities[0].id,am1.id);

  // 4. Clear amenities ([]) không làm mất catalog master
  const catalogCountBefore = sql(`SELECT COUNT(*) FROM amenities;`);
  const freshAfter409 = await (await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, { headers })).json();
  const clearPut = await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ amenityIds: [am1.id], expectedRevision: freshAfter409.revision })
  });
  record('Re-assigned 1 amenity for clear test', clearPut.status, 200);

  // Reload page admin và deselect am1
  await page.reload();
  await page.waitForLoadState('networkidle');
  const vArt = page.locator('article', { hasText: vehicleName }).first();
  await vArt.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  const formReload = page.getByRole('form', { name: 'Tiện nghi xe' });
  await formReload.waitFor();

  const cb1 = formReload.getByLabel(am1.name, { exact: true });
  await cb1.uncheck();
  await formReload.getByRole('button', { name: 'Lưu tiện nghi', exact: true }).click();
  await formReload.getByText('Đã lưu tiện nghi thành công.', { exact: true }).waitFor();

  record('Clear amenities vehicle links is 0', sql(`SELECT COUNT(*) FROM vehicle_amenities WHERE vehicle_id=${q(vehicleId)};`), '0');
  record('Other vehicle links preserved',sql(`SELECT amenity_id FROM vehicle_amenities WHERE vehicle_id=${q(otherVehicle)} ORDER BY amenity_id;`),otherBefore);
  record('Master amenities catalog preserved', sql(`SELECT COUNT(*) FROM amenities;`), catalogCountBefore);

  // Gán lại am1 và am2 để kiểm tra hiển thị public
  const revNow = await (await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, { headers })).json();
  await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ amenityIds: [am1.id, am2.id], expectedRevision: revNow.revision })
  });

  // Render genuine baseline bundle compiled from archived HEAD, against the same real API fixture.
  const baselineDir=path.resolve(__dirname,'../../..',fs.readFileSync(path.resolve(__dirname,'../../../.runtime/c10a-ui-baseline-dist.txt'),'utf8').trim());
  const beforeContext=await browser.newContext();
  await beforeContext.addInitScript(tok=>localStorage.setItem('kdrive.jwt',tok),token);
  await beforeContext.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===base&&url.pathname.startsWith('/api/'))return dispatcher(new Map())(route);
    if(url.origin===base){const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);const file=path.resolve(baselineDir,relative);
      if(file.startsWith(baselineDir+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});}
    return route.continue();
  });
  const beforePage=await beforeContext.newPage();monitor(beforePage);
  for(const width of [1280,390]){await beforePage.setViewportSize({width,height:width===390?844:800});await beforePage.goto(base+'/');await beforePage.waitForLoadState('networkidle');await beforePage.getByRole('heading',{name:'Thuê xe tự lái cùng KDrive',exact:true}).waitFor();await beforePage.screenshot({path:path.join(evidence,`homepage-before-${width}.png`),fullPage:true});}
  await beforeContext.close();

  for(const route of ['/','/vehicles']) {
    await page.goto(base+route);await page.waitForLoadState('networkidle');
    const card=page.locator('article',{hasText:vehicleName}).first();
    await card.getByText(am1.name,{exact:true}).waitFor();record(`${route} actual card amenity labels`,await card.getByText(am2.name,{exact:true}).isVisible(),true);
  }
  await page.goto(`${base}/vehicles/${vehicleId}`);await page.waitForLoadState('networkidle');
  await page.getByText('Tiện nghi (2)',{exact:true}).waitFor();record('Detail full labels from linked IDs',await page.getByText(am1.name,{exact:true}).isVisible()&&await page.getByText(am2.name,{exact:true}).isVisible(),true);
  // 6. Responsive Screenshots & Overflow Check (Desktop 1280, Tablet 768, Mobile 390)
  // Desktop 1280
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await checkNoHorizontalOverflow(page, 'Desktop 1280');
  await page.screenshot({ path: path.join(evidence, 'homepage-desktop-1280.png'), fullPage: true });

  record('Homepage has one primary H1',await page.locator('h1').count(),1);
  const cta=page.getByRole('link',{name:'Xem toàn bộ xe ↗',exact:true});record('Homepage CTA goes to real vehicle route',await cta.getAttribute('href'),'/vehicles');
  await cta.focus();record('CTA keyboard focus',await cta.evaluate(element=>document.activeElement===element),true);
  const adminArticle=page.locator('article',{hasText:vehicleName}).first();record('API ACTIVE label is operational state',await adminArticle.getByText('Đang khai thác',{exact:true}).count(),1);
  await page.emulateMedia({reducedMotion:'reduce'});record('No continuous hero pulse',await page.locator('.animate-pulse').count(),0);

  // Tablet 768
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await checkNoHorizontalOverflow(page, 'Tablet 768');
  await page.screenshot({ path: path.join(evidence, 'homepage-tablet-768.png'), fullPage: true });

  // Mobile 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await checkNoHorizontalOverflow(page, 'Mobile 390');
  await page.screenshot({ path: path.join(evidence, 'homepage-mobile-390.png'), fullPage: true });

  // Detail page mobile screenshot
  await page.goto(`${base}/vehicles/${vehicleId}`);
  await page.waitForLoadState('networkidle');
  await checkNoHorizontalOverflow(page, 'Detail Mobile 390');
  await page.screenshot({ path: path.join(evidence, 'detail-mobile-390.png'), fullPage: true });

  // 7. Role Denied Checks (USER, STAFF, Guest)
  for (const role of ['USER', 'STAFF']) {
    const email = sql(`SELECT email FROM users WHERE role=${q(role)} AND status='ACTIVE' ORDER BY id LIMIT 1;`);
    const resp = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: seedPassword })
    });
    record(`${role} login status`, resp.status, 200);
    const session = await resp.json();

    const roleCtx = await browser.newContext();
    await roleCtx.addInitScript(t => localStorage.setItem('kdrive.jwt', t), session.token);
    const rolePage = await roleCtx.newPage();
    monitor(rolePage);

    await rolePage.goto(`${base}/admin/vehicles`);
    await rolePage.waitForURL(url => url.pathname !== '/admin/vehicles');
    record(`${role} denied from admin vehicles`, true, true);
    const denied=await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`,{headers:{authorization:`Bearer ${session.token}`}});record(`${role} amenity API denied`,denied.status,403);
    await rolePage.waitForLoadState('networkidle');await rolePage.goto(base+'/');await rolePage.waitForLoadState('networkidle');
    if(role==='USER') { record('USER homepage bookings CTA',await rolePage.getByRole('link',{name:'Đơn thuê của tôi',exact:true}).getAttribute('href'),'/user/bookings');record('USER homepage profile CTA',await rolePage.getByRole('link',{name:'Hồ sơ & GPLX',exact:true}).getAttribute('href'),'/user/profile'); }
    else record('STAFF homepage contains no USER booking CTA',await rolePage.getByRole('link',{name:'Đơn thuê của tôi',exact:true}).count(),0);
    await roleCtx.close();
  }

  // Guest
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  monitor(guestPage);
  await guestPage.goto(`${base}/admin/vehicles`);
  await guestPage.waitForURL('**/login');
  record('Guest redirects to login from admin vehicles', true, true);
  record('Guest amenity API denied',(await fetch(`${api}/admin/vehicles/${vehicleId}/amenities`)).status,401);
  await guestPage.waitForLoadState('networkidle');await guestPage.goto(base+'/');await guestPage.waitForLoadState('networkidle');record('Guest homepage registration CTA',await guestPage.getByRole('link',{name:'Đăng ký tài khoản',exact:true}).getAttribute('href'),'/register');await guestCtx.close();

  // Final assert no unexpected HTTP errors
  assertNoUnexpected(http, consoleIssues, expected);
  record('No unexpected console or HTTP failures', true, true);

  for (const [file, data] of [
    ['browser-checks.json', checks],
    ['browser-http.json', http],
    ['browser-console.json', consoleIssues],
  ]) {
    fs.writeFileSync(path.join(evidence, file), JSON.stringify(data, null, 2));
  }

  await browser.close();
  console.log(`ALL ${checks.length} C10A BROWSER CHECKS PASSED`);
}

main().catch(error => {
  console.error(error);
  fs.writeFileSync(path.join(evidence, 'browser-failure.json'), JSON.stringify({ error: error.message, checks, http, consoleIssues }, null, 2));
  if (browser) browser.close().catch(() => {});
  process.exitCode = 1;
});
