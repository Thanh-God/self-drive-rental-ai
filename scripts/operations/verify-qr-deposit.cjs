// Internal protocol/browser proof only. No live merchant, payment or refund claim.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { chromium } = require(process.env.C11_PLAYWRIGHT);
const out = process.env.C11_EVIDENCE, base = 'http://127.0.0.1:5300', api = 'http://127.0.0.1:8300/api/v1';
const fixture = JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE, 'fixture.json')));
const config = fs.readFileSync(path.join(out, 'application.private.properties'), 'utf8');
assert(config.includes('app.deposit-method=DEMO_QR_MANUAL'));assert(config.includes('app.payment-reconcile-ms=86400000'));
const password = config.match(/^spring.datasource.password=(.*)$/m)[1], schema = config.match(/jdbc:mysql:\/\/127.0.0.1:33676\/([^?]+)/)[1];
assert.match(schema, /^kdrive_c14_browser_[a-f0-9]+$/);
const checks = [], errors = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name);checks.push({ name, actual, expected });fs.writeFileSync(path.join(out, 'browser-assertions.json'), JSON.stringify(checks, null, 2)); }
function sql(query) { try { return cp.execFileSync('docker', ['exec', '-e', 'MYSQL_PWD=' + password, fixture.name, 'mysql', '-uroot', '--batch', '--raw', '-N', schema, '-e', query], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim(); } catch { throw Error('Isolated fixture readback failed'); } }
async function req(token, endpoint, method = 'GET', body) { const r = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });return { status: r.status, body: await r.json().catch(()=>null) }; }
async function login(email) { const r = await req(null, '/auth/login', 'POST', { email, password: 'BranchBookingTestOnly123!' });assert.equal(r.status, 200);return r.body.token; }
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
    wait = operator.waitForResponse(r => r.url().endsWith('/deposit/approve'));await operator.getByRole('button', { name: 'Duyệt hồ sơ và tạo mã QR cọc', exact: true }).click();check('Approve deposit UI', (await wait).status(), 200);
    check('Still pending after approval', (await req(user, '/bookings/' + id)).body.booking.status, 'PENDING');
    await customer.goto(base + '/user/bookings/' + id);
    await customer.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).click();
    const qr=customer.getByAltText('Mã QR cọc giả lập');await qr.waitFor();
    check('Authenticated QR image loads',await qr.evaluate(async i=>{await i.decode();return i.complete && i.naturalWidth>0;}),true);
    check('QR is local authenticated blob',await qr.getAttribute('src').then(s=>s.startsWith('blob:')),true);
    await customer.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).click();
    await customer.getByText(/Khách đã báo chuyển khoản lúc/).waitFor();
    check('Customer claim never confirms', (await req(user,'/bookings/'+id)).body.booking.status,'PENDING');
    await customer.screenshot({path:path.join(out,'user-reported-qr.png'),fullPage:true});
    async function verify(ref,amount) {
      await operator.goto(base+'/staff/bookings/'+id);
      await operator.getByLabel('Mã tham chiếu giao dịch',{exact:true}).fill(ref);
      await operator.getByLabel('Số tiền thực nhận (VND)',{exact:true}).fill(String(amount));
      const local=new Date(Date.now()+7*3600000).toISOString().slice(0,19);
      await operator.getByLabel('Thời điểm chuyển (giờ VN)',{exact:true}).fill(local);
      await operator.getByLabel('Tài khoản nguồn (giả lập)',{exact:true}).fill('DEMO-PAYER');
      await operator.getByLabel('Đã đối chiếu đúng đơn, nội dung, bên nhận DEMO và số tiền',{exact:true}).check();
      operator.once('dialog',d=>d.accept());
      const response=operator.waitForResponse(r=>r.url().endsWith('/deposit/verify'));
      await operator.getByRole('button',{name:'Xác minh và ghi nhận',exact:true}).click();check('Staff receipt '+ref,(await response).status(),200);
    }
    await verify('BROWSER-A',200000);
    check('Partial remains pending',(await req(user,'/bookings/'+id)).body.booking.status,'PENDING');
    check('Partial missing amount',(await req(user,'/bookings/'+id)).body.booking.deposit.missingAmount,190000);
    await verify('BROWSER-B',300000);
    await customer.goto(base+'/user/bookings/'+id);await customer.getByText('Đã ghi nhận cọc cho đơn',{exact:true}).waitFor();
    check('Backend confirmed',(await req(user,'/bookings/'+id)).body.booking.status,'CONFIRMED');
    check('Applied exactly required',(await req(user,'/bookings/'+id)).body.booking.deposit.appliedAmount,390000);
    check('One contract',sql('select count(*) from contracts'),'1');
    check('Excess refund amount',sql('select sum(amount) from payment_refunds'),'110000');
    await customer.screenshot({path:path.join(out,'user-confirmed-qr.png'),fullPage:true});
    await manager.goto(base+'/admin/payments');
    check('QR refunds do not offer VNPAY',await manager.getByRole('button',{name:'Gửi hoàn VNPAY Sandbox',exact:true}).count(),0);
    await manager.getByRole('button',{name:'Bắt đầu xử lý hoàn (QR DEMO)',exact:true}).click();
    await manager.getByLabel('Tài khoản nhận hoàn',{exact:true}).fill('DEMO-PAYER');
    await manager.getByLabel('Tham chiếu hoàn',{exact:true}).fill('BROWSER-REFUND');
    await manager.getByLabel('Thời điểm hoàn (giờ Việt Nam)',{exact:true}).fill(new Date(Date.now()+7*3600000).toISOString().slice(0,19));
    check('Starting refund is not completion',sql('select status from payment_refunds'),'PROCESSING');
    wait=manager.waitForResponse(r=>r.url().endsWith('/complete-manual'));
    await manager.getByRole('button',{name:'Xác nhận đã hoàn DEMO',exact:true}).click();check('Manual completion response',(await wait).status(),200);
    check('Refund verified complete',sql('select status from payment_refunds'),'SUCCEEDED');
    check('Refund has bank reference',sql('select provider_transaction from payment_refunds'),'BROWSER-REFUND');
    await manager.screenshot({path:path.join(out,'admin-refund-qr.png'),fullPage:true});
    check('Guest cannot read QR',(await req(null,'/bookings/'+id+'/deposit/qr-payload')).status,401);
    check('User cannot access admin',(await req(user,'/admin/payments')).status,403);
    check('No JS page errors',errors,[]);
  } catch(error) { for(const [name,p] of [["user",customer],["staff",operator],["admin",manager]]) {await p.screenshot({path:path.join(out,`failure-${name}.png`),fullPage:true}).catch(()=>{});} throw error;} finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
