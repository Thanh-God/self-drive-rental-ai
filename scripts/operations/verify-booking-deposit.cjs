// Internal protocol/browser proof only. No live merchant, payment or refund claim.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const { chromium } = require(process.env.C11_PLAYWRIGHT);
const out = process.env.C11_EVIDENCE, base = 'http://127.0.0.1:5300', api = 'http://127.0.0.1:8300/api/v1';
const fixture = JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE, 'fixture.json')));
const config = fs.readFileSync(path.join(out, 'application.private.properties'), 'utf8');
assert(config.includes('app.vnpay-tmn-code=TESTONLY'));assert(config.includes('app.payment-reconcile-ms=86400000'));
const password = config.match(/^spring.datasource.password=(.*)$/m)[1], schema = config.match(/jdbc:mysql:\/\/127.0.0.1:33676\/([^?]+)/)[1];
assert.match(schema, /^kdrive_c14_browser_[a-f0-9]+$/);
const checks = [], errors = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name);checks.push({ name, actual, expected });fs.writeFileSync(path.join(out, 'browser-assertions.json'), JSON.stringify(checks, null, 2)); }
function sql(query) { try { return cp.execFileSync('docker', ['exec', '-e', 'MYSQL_PWD=' + password, fixture.name, 'mysql', '-uroot', '--batch', '--raw', '-N', schema, '-e', query], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim(); } catch { throw Error('Isolated fixture readback failed'); } }
async function req(token, endpoint, method = 'GET', body) { const r = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });return { status: r.status, body: await r.json() }; }
async function login(email) { const r = await req(null, '/auth/login', 'POST', { email, password: 'BranchBookingTestOnly123!' });assert.equal(r.status, 200);return r.body.token; }
async function notify(ref, amount, number) {
  const p = new URLSearchParams(Object.entries({ vnp_TmnCode: 'TESTONLY', vnp_TxnRef: ref, vnp_Amount: String(amount * 100), vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: number, vnp_PayDate: new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 19).replace(/\D/g, '') }).sort(([a], [b]) => a.localeCompare(b)));
  p.set('vnp_SecureHash', crypto.createHmac('sha512', 'synthetic-secret-not-real-merchant').update(p.toString()).digest('hex'));
  return req(null, '/payments/vnpay/ipn?' + p.toString());
}
async function main() {
  const user = await login('user@example.test'), staff = await login('staff.dn@example.test'), admin = await login('admin@example.test');
  const browser = await chromium.launch({ headless: true });
  async function page(token) { const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });await context.addInitScript(jwt => localStorage.setItem('kdrive.jwt', jwt), token);const p = await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror', e => errors.push(e.message));return p; }
  const customer = await page(user), operator = await page(staff), manager = await page(admin);
  try {
    await customer.goto(base + '/user/profile');
    await customer.getByLabel('Số giấy phép', { exact: true }).fill('SYNTHETIC-DEPOSIT-BROWSER');
    await customer.getByLabel('Hệ giấy phép', { exact: true }).selectOption('VN_2025');await customer.getByLabel('Hạng bằng', { exact: true }).selectOption('B');await customer.getByLabel('Ngày hết hạn', { exact: true }).fill('2035-12-31');
    let wait = customer.waitForResponse(r => r.url().endsWith('/me/license') && r.request().method() === 'PUT');await customer.getByRole('button', { name: 'Lưu thông tin GPLX', exact: true }).click();check('Declaration UI', (await wait).status(), 200);
    const imagePage = await browser.newPage();await imagePage.setContent('<p>GPLX GIẢ LẬP — KHÔNG PHẢI GIẤY TỜ THẬT</p>');const image = await imagePage.screenshot();await imagePage.close();
    for (const label of ['Ảnh mặt trước', 'Ảnh mặt sau']) await customer.getByLabel(label, { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image });
    wait = customer.waitForResponse(r => r.url().endsWith('/me/license/photos') && r.request().method() === 'PUT');await customer.getByRole('button', { name: 'Lưu hai mặt ảnh GPLX', exact: true }).click();check('Synthetic photos UI', (await wait).status(), 200);
    const day = new Date(Date.now() + 3 * 86400000 + 7 * 3600000).toISOString().slice(0, 10), end = new Date(Date.now() + 5 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    await customer.goto(base + `/user/bookings/new?vehicleId=v1&start=${day}&end=${end}&pickupBranchId=dn&returnBranchId=dn`);
    wait = customer.waitForResponse(r => r.url().endsWith('/bookings/quote'));await customer.getByRole('button', { name: 'Kiểm tra lịch & báo giá', exact: true }).click();check('Quote', (await wait).status(), 200);
    await customer.getByRole('checkbox', { name: 'Tôi xác nhận thời gian, chi nhánh và tổng báo giá.', exact: true }).check();wait = customer.waitForResponse(r => r.url().endsWith('/bookings') && r.request().method() === 'POST');await customer.getByRole('button', { name: 'Gửi yêu cầu thuê', exact: true }).click();const r = await wait;check('Request UI', r.status(), 201);const booking = await r.json(), id = booking.id;await customer.waitForURL('**/user/bookings/' + id);
    check('Deposit 30 percent rental', booking.deposit.amount, 390000);check('One booking', sql('select count(*) from bookings'), '1');
    await customer.getByText('Chờ kiểm tra hồ sơ', { exact: true }).first().waitFor();check('No checkout before approval', await customer.getByRole('button', { name: 'Thanh toán cọc thử nghiệm' }).count(), 0);
    await operator.goto(base + '/staff/bookings/' + id);const panel = operator.getByRole('region', { name: 'Ảnh GPLX', exact: true });
    await panel.getByLabel('Kết quả kiểm tra', { exact: true }).selectOption('APPROVED');await panel.getByLabel('Nhận xét kiểm tra', { exact: true }).fill('Ảnh giả lập, chưa đối chiếu bản gốc.');wait = operator.waitForResponse(r => r.url().endsWith('/license-photo-review'));await panel.getByRole('button', { name: 'Lưu kiểm tra hồ sơ', exact: true }).click();check('Photo review UI', (await wait).status(), 200);
    wait = operator.waitForResponse(r => r.url().endsWith('/deposit/approve'));await operator.getByRole('button', { name: 'Duyệt hồ sơ và yêu cầu đóng cọc', exact: true }).click();check('Approve deposit UI', (await wait).status(), 200);
    check('Still pending after approval', (await req(user, '/bookings/' + id)).body.booking.status, 'PENDING');
    await customer.reload();await customer.getByRole('button', { name: 'Thanh toán cọc thử nghiệm' }).waitFor();
    check('Progress matches deposit stage', await customer.getByRole('region', { name: 'Tiến trình đơn thuê', exact: true }).getByText('Hiện tại: Chờ đóng cọc', { exact: true }).count(), 1);
    check('Checkout uses existing button styling', (await customer.getByRole('button', { name: 'Thanh toán cọc thử nghiệm' }).boundingBox()).height >= 40, true);
    check('Payment deadline uses full year', /\d{2}\/\d{2}\/\d{4}/.test(await customer.locator('body').innerText()), true);
    await customer.screenshot({ path: path.join(out, 'customer-awaiting-deposit.png'), fullPage: true });
    // Block all provider traffic. This page only proves navigation to the generated sandbox URL.
    await customer.context().route('https://sandbox.vnpayment.vn/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Internal checkout navigation fixture — no provider call</p>' }));
    await customer.getByRole('button', { name: 'Thanh toán cọc thử nghiệm' }).click();await customer.waitForURL('https://sandbox.vnpayment.vn/**');check('Checkout uses sandbox', new URL(customer.url()).hostname, 'sandbox.vnpayment.vn');const ref = new URL(customer.url()).searchParams.get('vnp_TxnRef');
    await customer.goto(base + '/user/payment-return?vnp_ResponseCode=00&vnp_TxnRef=' + ref);await customer.getByText(/Trang quay về không xác nhận đã nhận tiền/).waitFor();check('Redirect cannot confirm', (await req(user, '/bookings/' + id)).body.booking.status, 'PENDING');
    check('Synthetic signed IPN', (await notify(ref, 390000, '900001')).body.RspCode, '00');check('Duplicate synthetic IPN', (await notify(ref, 390000, '900001')).body.RspCode, '00');
    await customer.goto(base + '/user/bookings/' + id);await customer.getByText('Đã ghi nhận cọc cho đơn', { exact: true }).waitFor();check('Backend confirmed', (await req(user, '/bookings/' + id)).body.booking.status, 'CONFIRMED');check('One contract', sql('select count(*) from contracts'), '1');
    await customer.screenshot({ path: path.join(out, 'customer-confirmed-deposit.png'), fullPage: true });
    await manager.goto(base + '/admin/payments');await manager.getByRole('heading', { name: 'Cọc và hoàn tiền · Sandbox' }).waitFor();await manager.getByText('Chưa có giao dịch cần xử lý.', { exact: true }).waitFor();
    check('Desktop viewport', await customer.evaluate(() => [innerWidth, innerHeight]), [1440, 900]);check('Browser runtime errors', errors, []);
    fs.writeFileSync(path.join(out, 'LIMITATIONS.txt'), 'INTERNAL PROTOCOL ONLY. Checkout intercepted; IPN uses synthetic key. Live merchant, QueryDR and Refund acceptance BLOCKED. No real provider request.');
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e.stack);process.exitCode = 1; });
