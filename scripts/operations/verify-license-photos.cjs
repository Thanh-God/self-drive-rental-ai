// Desktop real API/MySQL proof. Run only via c14-core/run-browser.py on its isolated schema.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { chromium } = require(process.env.C11_PLAYWRIGHT);
const out = process.env.C11_EVIDENCE, base = 'http://127.0.0.1:5300', api = 'http://127.0.0.1:8300/api/v1';
assert(out && path.resolve(out).includes(path.join('.runtime', '')));
const native = JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE, 'fixture.json')));
const config = fs.readFileSync(path.join(out, 'application.private.properties'), 'utf8');
const password = config.match(/^spring.datasource.password=(.*)$/m)[1];
const schema = config.match(/jdbc:mysql:\/\/127.0.0.1:33676\/([^?]+)/)[1];
assert.match(schema, /^kdrive_c14_browser_[a-f0-9]+$/);
assert.equal(native.port, 33676);
const checks = [], errors = [];
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name); checks.push({ name, actual, expected });
  fs.writeFileSync(path.join(out, 'browser-assertions.json'), JSON.stringify(checks, null, 2));
}
function sql(query) {
  try { return cp.execFileSync('docker', ['exec', '-e', 'MYSQL_PWD=' + password, native.name, 'mysql', '-uroot', '--batch', '--raw', '-N', schema, '-e', query], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim(); }
  catch { throw Error('Fixture readback failed; private arguments omitted'); }
}
async function request(token, endpoint, method = 'GET', body) {
  const response = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function login(email) {
  const response = await request(null, '/auth/login', 'POST', { email, password: 'BranchBookingTestOnly123!' });
  assert.equal(response.status, 200); return response.body.token;
}
async function main() {
  const user = await login('user@example.test'), staff = await login('staff.dn@example.test'), wrongStaff = await login('staff.hn@example.test'), admin = await login('admin@example.test');
  check('Fixture MySQL 8.4', sql('SELECT VERSION()').startsWith('8.4.'), true);
  const browser = await chromium.launch({ headless: true });
  async function page(token) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(jwt => localStorage.setItem('kdrive.jwt', jwt), token);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
    return page;
  }
  const customer = await page(user), operator = await page(staff);
  try {
    const synthetic = await browser.newPage({ viewport: { width: 320, height: 160 } });
    await synthetic.setContent('<html lang="vi"><body style="background:#eee;font:20px sans-serif;padding:20px">GPLX GIẢ LẬP<br>CHỈ DÙNG KIỂM THỬ<br>Không phải giấy tờ thật</body></html>');
    const image = await synthetic.screenshot(); await synthetic.close();
    await customer.goto(base + '/user/profile');
    await customer.getByLabel('Số giấy phép', { exact: true }).fill('SYNTHETIC-PHOTO-BROWSER');
    await customer.getByLabel('Hệ giấy phép', { exact: true }).selectOption('VN_2025');
    await customer.getByLabel('Hạng bằng', { exact: true }).selectOption('B');
    await customer.getByLabel('Ngày hết hạn', { exact: true }).fill('2030-12-31');
    let response = customer.waitForResponse(r => r.url().endsWith('/me/license') && r.request().method() === 'PUT');
    await customer.getByRole('button', { name: 'Lưu thông tin GPLX', exact: true }).click();
    check('UI save declaration', (await response).status(), 200);
    await customer.getByRole('button', { name: 'Lưu hai mặt ảnh GPLX', exact: true }).waitFor();

    const day = new Date(Date.now() + 3 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 5 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    const bookingUrl = base + `/user/bookings/new?vehicleId=v1&start=${day}&end=${end}&pickupBranchId=dn&returnBranchId=dn`;
    async function quote() {
      await customer.goto(bookingUrl);
      const wait = customer.waitForResponse(r => r.url().endsWith('/bookings/quote'));
      await customer.getByRole('button', { name: 'Kiểm tra lịch & báo giá', exact: true }).click();
      const response = await wait; check('Quote remains usable', response.status(), 200);
      const data = await response.json(); check('Independent expected price', data.total, 1300000);
      await customer.getByRole('checkbox', { name: 'Tôi xác nhận thời gian, chi nhánh và tổng báo giá.', exact: true }).check();
    }
    await quote();
    response = customer.waitForResponse(r => r.url().endsWith('/bookings') && r.request().method() === 'POST');
    await customer.getByRole('button', { name: 'Gửi yêu cầu thuê', exact: true }).click();
    check('Missing photos rejected', (await response).status(), 400);
    await customer.getByText(/Vui lòng tải đủ ảnh hai mặt GPLX/).waitFor();
    check('No booking created on failure', sql('SELECT COUNT(*) FROM bookings'), '0');

    await customer.goto(base + '/user/profile');
    await customer.getByLabel('Ảnh mặt trước', { exact: true }).setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await customer.getByLabel('Ảnh mặt sau', { exact: true }).setInputFiles({ name: 'synthetic-back.png', mimeType: 'image/png', buffer: image });
    response = customer.waitForResponse(r => r.url().endsWith('/me/license/photos') && r.request().method() === 'PUT');
    await customer.getByRole('button', { name: 'Lưu hai mặt ảnh GPLX', exact: true }).click();
    check('Fake image rejected through UI', (await response).status(), 400);
    await customer.getByRole('alert').filter({ hasText: 'Tệp không phải ảnh' }).waitFor();
    check('Fake upload leaves no metadata', sql('SELECT front_photo IS NULL AND back_photo IS NULL FROM driver_licenses'), '1');
    async function upload() {
      for (const [label, file] of [['Ảnh mặt trước', 'front.png'], ['Ảnh mặt sau', 'back.png']])
        await customer.getByLabel(label, { exact: true }).setInputFiles({ name: file, mimeType: 'image/png', buffer: image });
      const wait = customer.waitForResponse(r => r.url().endsWith('/me/license/photos') && r.request().method() === 'PUT');
      await customer.getByRole('button', { name: 'Lưu hai mặt ảnh GPLX', exact: true }).click();
      check('UI upload two real PNG files', (await wait).status(), 200);
      await customer.getByText('Chờ kiểm tra hồ sơ', { exact: true }).waitFor();
    }
    await upload(); await customer.reload();
    await customer.getByRole('button', { name: 'Xem hai mặt GPLX', exact: true }).click();
    await customer.getByAltText('Ảnh GPLX mặt trước').waitFor();
    await customer.waitForFunction(() => [...document.querySelectorAll('img[alt^="Ảnh GPLX"]')].every(i => i.complete && i.naturalWidth > 0));
    check('Two photos rendered after reload', await customer.locator('img[alt^="Ảnh GPLX"]').count(), 2);
    check('Desktop viewport', await customer.evaluate(() => [innerWidth, innerHeight]), [1440, 900]);
    await customer.screenshot({ path: path.join(out, 'user-synthetic-license.png'), fullPage: true });
    const imageResponse = await fetch(api + '/me/license/photos/front', { headers: { Authorization: 'Bearer ' + user } });
    check('Private image cache policy', imageResponse.headers.get('cache-control'), 'no-store, private');
    check('Anonymous image denied', (await fetch(api + '/me/license/photos/front')).status, 401);
    check('Admin is not document owner', (await request(admin, '/me/license/photos/front')).status, 403);

    await quote();
    response = customer.waitForResponse(r => r.url().endsWith('/bookings') && r.request().method() === 'POST');
    await customer.getByRole('button', { name: 'Gửi yêu cầu thuê', exact: true }).click();
    const created = await response; check('UI creates exactly one pending request', created.status(), 201);
    const booking = await created.json(), id = booking.id;
    await customer.waitForURL('**/user/bookings/' + id);
    await customer.getByText('Toyota Vios', { exact: true }).first().waitFor();
    check('Order readback PENDING', (await request(user, '/bookings/' + id)).body.booking.status, 'PENDING');
    check('Exactly one booking SQL', sql('SELECT COUNT(*) FROM bookings'), '1');
    check('Confirmation blocked before document review', (await request(staff, '/bookings/' + id + '/actions', 'POST', { next: 'CONFIRMED', version: 0 })).status, 400);
    const license = (await request(user, '/me/license')).body;
    check('Wrong branch cannot review', (await request(wrongStaff, '/bookings/' + id + '/license-photo-review', 'POST', { version: license.version, approve: true, reason: 'Forbidden fixture attempt' })).status, 404);
    await operator.goto(base + '/staff/bookings/' + id);
    const panel = operator.getByRole('region', { name: 'Ảnh GPLX', exact: true });
    await panel.getByRole('button', { name: 'Xem hai mặt GPLX', exact: true }).click();
    await panel.getByAltText('Ảnh GPLX mặt sau').waitFor();
    await panel.getByLabel('Kết quả kiểm tra', { exact: true }).selectOption('NEEDS_CHANGES');
    await panel.getByLabel('Nhận xét kiểm tra', { exact: true }).fill('Ảnh giả lập: đề nghị bổ sung để kiểm tra luồng.');
    response = operator.waitForResponse(r => r.url().endsWith('/license-photo-review'));
    await panel.getByRole('button', { name: 'Lưu kiểm tra hồ sơ', exact: true }).click();
    check('Staff requests changes via UI', (await response).status(), 200);
    await customer.goto(base + '/user/profile'); await customer.getByText('Yêu cầu bổ sung', { exact: true }).waitFor();
    const oldFiles = fs.readdirSync(path.join(out, 'private-license-photos'));
    await upload();
    check('Superseded files removed', oldFiles.every(name => !fs.existsSync(path.join(out, 'private-license-photos', name))), true);
    await operator.reload();
    await panel.getByLabel('Kết quả kiểm tra', { exact: true }).selectOption('APPROVED');
    await panel.getByLabel('Nhận xét kiểm tra', { exact: true }).fill('Ảnh giả lập đạt kiểm tra hồ sơ; chưa đối chiếu bản gốc.');
    response = operator.waitForResponse(r => r.url().endsWith('/license-photo-review'));
    await panel.getByRole('button', { name: 'Lưu kiểm tra hồ sơ', exact: true }).click();
    check('Staff approves via UI', (await response).status(), 200);
    await panel.locator('p').filter({ hasText: /^Đạt kiểm tra hồ sơ$/ }).waitFor();
    check('Document review does not verify original', sql("SELECT status FROM driver_licenses WHERE user_id='demo-user'"), 'PENDING');
    await operator.screenshot({ path: path.join(out, 'staff-photo-review.png'), fullPage: true });
    await operator.getByLabel('Chuyển trạng thái', { exact: true }).selectOption('CONFIRMED');
    response = operator.waitForResponse(r => r.url().endsWith('/actions'));
    await operator.getByRole('button', { name: 'Xác nhận đơn thuê', exact: true }).click();
    check('Staff confirms after photo approval', (await response).status(), 200);
    check('Confirmed SQL readback', sql(`SELECT status FROM bookings WHERE id='${id}'`), 'CONFIRMED');
    await customer.goto(base + '/user/profile'); await upload();
    check('Replacement resets prior approval', sql("SELECT photo_review_status,status FROM driver_licenses WHERE user_id='demo-user'"), 'PENDING\tPENDING');
    const hidden = await page(wrongStaff);
    const forbiddenRead = hidden.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/bookings/' + id);
    await hidden.goto(base + '/staff/bookings/' + id);
    check('Wrong branch read denied by backend', (await forbiddenRead).status(), 404);
    await hidden.getByText('Không tìm thấy dữ liệu.', { exact: true }).waitFor();
    check('Unassigned staff photo form absent', await hidden.getByRole('region', { name: 'Ảnh GPLX' }).count(), 0);
    check('Business tables unchanged count', sql('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()'), '26');
    check('FK count including reviewer', sql('SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE()'), '38');
    check('Browser runtime errors', errors, []);
    fs.writeFileSync(path.join(out, 'workflow-result.json'), JSON.stringify({ bookingId: id, status: 'CONFIRMED', syntheticPhotosOnly: true, pickupDate: day, returnDate: end }, null, 2));
    console.log('PASS license-photo desktop ' + checks.length + ' assertions');
  } catch(e) {
    await customer.screenshot({ path: path.join(out, 'failure-user-synthetic.png'), fullPage: true });
    await operator.screenshot({ path: path.join(out, 'failure-staff-synthetic.png'), fullPage: true });
    throw e;
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
