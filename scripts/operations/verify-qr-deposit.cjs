// Internal protocol/browser proof only. No live merchant, payment or refund claim.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
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
  const visible = locator => locator.textContent().then(t => t.replaceAll('\u00a0', ' '));
  async function page(token, permissions = []) { const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });if (permissions.length) await context.grantPermissions(permissions, { origin: base });await context.addInitScript(jwt => localStorage.setItem('kdrive.jwt', jwt), token);const p = await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror', e => errors.push(e.message));return p; }
  const customer = await page(user, ['clipboard-read', 'clipboard-write']), operator = await page(staff), manager = await page(admin);
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
    async function queueStage(stage, label) {
      await operator.goto(base+'/staff/bookings');
      const filter=operator.getByLabel('Tình trạng cọc',{exact:true});await filter.selectOption(stage);
      const row=operator.locator('article').filter({has:operator.getByRole('link',{name:'Chi tiết',exact:true})}).filter({hasText:id});
      await row.first().waitFor();
      check('Queue '+stage,await row.first().textContent().then(t=>t.includes(label)),true);
      await operator.getByLabel('Trạng thái',{exact:true}).selectOption('COMPLETED');
      check('Stage AND status '+stage,await operator.locator('article').count(),0);
      await operator.getByLabel('Trạng thái',{exact:true}).selectOption('');
      await row.first().waitFor();
      await operator.screenshot({path:path.join(out,'queue-'+stage+'.png'),fullPage:true});
    }
    await customer.getByText('Chờ kiểm tra hồ sơ', { exact: true }).first().waitFor();check('No checkout before approval', await customer.getByRole('button', { name: 'Thanh toán cọc thử nghiệm' }).count(), 0);
    await queueStage('AWAITING_APPROVAL', 'Chờ kiểm tra hồ sơ');
    await operator.goto(base + '/staff/bookings/' + id);const panel = operator.getByRole('region', { name: 'Ảnh GPLX', exact: true });
    await panel.getByLabel('Kết quả kiểm tra', { exact: true }).selectOption('APPROVED');await panel.getByLabel('Nhận xét kiểm tra', { exact: true }).fill('Ảnh giả lập, chưa đối chiếu bản gốc.');wait = operator.waitForResponse(r => r.url().endsWith('/license-photo-review'));await panel.getByRole('button', { name: 'Lưu kiểm tra hồ sơ', exact: true }).click();check('Photo review UI', (await wait).status(), 200);
    wait = operator.waitForResponse(r => r.url().endsWith('/deposit/approve'));await operator.getByRole('button', { name: 'Duyệt hồ sơ và tạo mã QR cọc', exact: true }).click();check('Approve deposit UI', (await wait).status(), 200);
    check('Still pending after approval', (await req(user, '/bookings/' + id)).body.booking.status, 'PENDING');
    await queueStage('AWAITING_TRANSFER','Chờ khách chuyển cọc');
    await customer.goto(base + '/user/bookings/' + id);
    const userStatus=customer.getByRole('region',{name:'Tình trạng cọc của bạn',exact:true});
    await userStatus.getByText('Tình trạng cọc: Chờ bạn chuyển cọc',{exact:true}).waitFor();
    check('USER next action after approval',await visible(userStatus).then(t=>t.includes('Bước tiếp theo: Sau khi chuyển, gửi báo đã chuyển khoản')),true);
    check('USER sees no Staff reconciliation detail',await customer.getByRole('region',{name:'Chi tiết đối soát cọc QR',exact:true}).count(),0);
    check('USER sees no Staff receipt form',await customer.getByRole('button',{name:'Xác minh và ghi nhận',exact:true}).count(),0);
    await customer.route('**/api/v1/bookings/'+id+'/deposit/qr-payload',route=>route.abort(),{times:1});
    await customer.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).click();
    await customer.getByRole('button',{name:'Thử tải lại mã QR',exact:true}).waitFor();
    check('QR GET failure shows neutral retry',await customer.getByText('Không tải được mã QR. Kiểm tra kết nối rồi thử tải lại; chưa chuyển tiền khi chưa thấy mã QR.',{exact:false}).count(),1);
    check('QR GET failure shows no image',await customer.getByAltText('Mã QR cọc giả lập').count(),0);
    await customer.screenshot({path:path.join(out,'user-qr-get-error.png'),fullPage:true});
    await customer.getByRole('button',{name:'Thử tải lại mã QR',exact:true}).click();
    const qr=customer.getByAltText('Mã QR cọc giả lập');await qr.waitFor();
    const payload=(await req(user,'/bookings/'+id+'/deposit/qr-payload')).body;
    const qrBlock=customer.locator('[aria-label="Mã QR cọc DEMO"]');
    const qrText=await visible(qrBlock);
    check('QR block amount',qrText.includes('Số tiền cọc390.000 ₫'),true);
    check('QR block request code matches API',qrText.includes('Nội dung chuyển khoản (mã yêu cầu)'+payload.requestCode),true);
    check('QR block VN deadline label',qrText.includes('Hạn đóng cọc (giờ Việt Nam)'),true);
    check('QR block DEMO warning',qrText.includes('Mã QR DEMO — không chuyển tiền thật'),true);
    await customer.getByRole('button',{name:'Sao chép nội dung chuyển khoản',exact:true}).click();
    await customer.getByText('Đã sao chép nội dung chuyển khoản.',{exact:true}).waitFor();
    check('Copied request code',await customer.evaluate(()=>navigator.clipboard.readText()),payload.requestCode);
    check('Authenticated QR image loads',await qr.evaluate(async i=>{await i.decode();return i.complete && i.naturalWidth>0;}),true);
    check('QR is local authenticated blob',await qr.getAttribute('src').then(s=>s.startsWith('blob:')),true);
    await customer.route('**/api/v1/bookings/'+id+'/deposit/report',route=>route.abort(),{times:1});
    await customer.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).click();
    await customer.getByText('Chưa rõ báo đã chuyển khoản đã được ghi nhận hay chưa. Không gửi lại ngay; tải lại đơn để kiểm tra trước.',{exact:true}).waitFor();
    check('Uncertain report blocks blind resend',await customer.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).count(),0);
    check('Aborted report not recorded',sql('select count(*) from bookings where reported_at is not null'),'0');
    await customer.screenshot({path:path.join(out,'user-report-uncertain.png'),fullPage:true});
    // R02-a: ghi trace chuỗi kiểm tra lại -> mở QR (mạng của đúng đơn + danh tính DOM khu cọc) trước khi assert.
    const r02=[],r02t0=Date.now(),r02mark=e=>r02.push({t:Date.now()-r02t0,...e});
    const r02path=u=>u.slice(u.indexOf('/api/v1'));
    const r02mine=u=>u.includes('/api/v1/bookings/'+id);
    const r02req=r=>{if(r02mine(r.url()))r02mark({ev:'request',method:r.method(),path:r02path(r.url())});};
    const r02res=r=>{if(r02mine(r.url()))r02mark({ev:'response',method:r.request().method(),path:r02path(r.url()),status:r.status()});};
    const r02fail=r=>{if(r02mine(r.url()))r02mark({ev:'requestfailed',method:r.method(),path:r02path(r.url()),error:r.failure()?.errorText||''});};
    customer.on('request',r02req);customer.on('response',r02res);customer.on('requestfailed',r02fail);
    let r02img=false,r02same=-1,r02decoded=false,r02payload=null;
    try {
      // Chờ đúng lần tải lại đơn (component được mount lại); chữ trạng thái cũ đã có sẵn trên DOM.
      wait=customer.waitForResponse(r=>r.url().endsWith('/api/v1/bookings/'+id) && r.request().method()==='GET');
      // Sẵn sàng của đúng đơn: component cọc mới mount sẽ GET ledger của đơn này; response làm khu cọc render lại và đổi bố cục.
      const ledgerReady=customer.waitForResponse(r=>r.url().endsWith('/api/v1/bookings/'+id+'/deposit') && r.request().method()==='GET');ledgerReady.catch(()=>{});
      r02mark({ev:'click-recheck'});
      await customer.getByRole('button',{name:'Kiểm tra lại tình trạng báo',exact:true}).click();check('Recheck reloads booking with GET',(await wait).status(),200);
      await customer.getByRole('button',{name:'Kiểm tra lại tình trạng báo',exact:true}).waitFor({state:'detached'});
      await userStatus.getByText('Tình trạng cọc: Chờ bạn chuyển cọc',{exact:true}).waitFor();
      r02mark({ev:'status-visible'});
      check('Reloaded deposit ledger of this booking ready before reopening QR',(await ledgerReady).status(),200);
      // Chờ một khung render sau dữ liệu ledger để cú bấm không rơi vào lúc bố cục đang đổi (không bấm lần hai, không tăng timeout).
      await customer.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      r02mark({ev:'ledger-ready'});
      // Danh tính DOM khu cọc hiện tại: nếu bị dựng lại sau cú bấm, dấu này sẽ mất.
      await userStatus.evaluate(el=>{el.dataset.r02='before-click';});
      const payloadReq=customer.waitForRequest(r=>r.url().endsWith('/api/v1/bookings/'+id+'/deposit/qr-payload'),{timeout:15000}).catch(()=>null);
      r02mark({ev:'click-show-qr'});
      await customer.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).click();
      r02payload=await payloadReq;r02mark({ev:r02payload?'qr-payload-request-seen':'qr-payload-request-not-seen'});
      r02img=await qr.waitFor({timeout:15000}).then(()=>true,()=>false);
      r02same=await customer.locator('[data-r02="before-click"]').count();
      r02decoded=r02img && await qr.evaluate(async i=>{await i.decode();return i.complete && i.naturalWidth>0;}).catch(()=>false);
      r02mark({ev:'after-click',imageVisible:r02img,sectionKeptIdentity:r02same===1,decoded:r02decoded,showButtonLabel:(await customer.getByRole('button',{name:/mã QR/}).first().textContent().catch(()=>''))});
    } finally {
      customer.off('request',r02req);customer.off('response',r02res);customer.off('requestfailed',r02fail);
      fs.writeFileSync(path.join(out,'qr-reopen-trace.json'),JSON.stringify(r02,null,2));
    }
    check('Reopen sends QR payload GET for this booking',!!r02payload,true);
    check('Deposit section not rebuilt after the QR click',r02same,1);
    check('QR image of this booking visible after one click',r02img,true);
    check('Reopened QR image decodes',r02decoded,true);
    check('Recheck and reopen send no report POST',r02.filter(e=>e.ev==='request' && e.method==='POST' && e.path.endsWith('/deposit/report')).length,0);
    check('QR image request belongs to this booking',r02.some(e=>e.ev==='response' && e.path==='/api/v1/bookings/'+id+'/deposit/qr' && e.status===200),true);
    await customer.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).click();
    await customer.getByText(/Bạn đã báo chuyển khoản lúc/).waitFor();
    check('Exactly one report event',sql("select count(*) from payment_events where kind='TRANSFER_REPORTED'"),'1');
    await customer.reload();await customer.getByText(/Bạn đã báo chuyển khoản lúc/).waitFor();
    await userStatus.getByText('Tình trạng cọc: Đã báo chuyển — chờ nhân viên đối chiếu',{exact:true}).waitFor();
    check('Reload keeps backend report time',await customer.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).count(),0);
    check('Customer claim never confirms', (await req(user,'/bookings/'+id)).body.booking.status,'PENDING');
    await customer.screenshot({path:path.join(out,'user-reported-qr.png'),fullPage:true});
    await queueStage('REPORTED_NO_RECEIPT','Khách đã báo chuyển');
    // R02-b: Chromium chuẩn hóa datetime-local giây 00 thành YYYY-MM-DDTHH:MM; điền đúng dạng chuẩn hóa (cùng thời điểm),
    // đọc lại input và đối chiếu transferTime trong payload. Không đổi 00 thành 01.
    const vnLocal=ms=>new Date(ms+7*3600000).toISOString().slice(0,19);
    const inputForm=v=>v.endsWith(':00')?v.slice(0,16):v;
    const transferTimes={};
    async function verify(ref,amount,target=id,{seconds,notBefore}={}) {
      // Backend từ chối thời điểm chuyển trước approvedAt hoặc ở tương lai; ô nhập theo giây.
      const approvedAt=Date.parse((await req(user,'/bookings/'+target)).body.booking.deposit.approvedAt);
      let t;
      if(seconds===undefined) {
        while(Date.now()<Math.ceil(approvedAt/1000)*1000+1000) await new Promise(r=>setTimeout(r,200));
        t=Math.floor(Date.now()/1000)*1000;
      } else {
        // Ca cố định: giây đầu tiên sau approvedAt (và sau notBefore) có số giây = seconds; chờ tới khi không còn ở tương lai.
        t=Math.ceil((Math.max(approvedAt,notBefore||0)+1)/1000)*1000;
        while(new Date(t).getUTCSeconds()!==seconds) t+=1000;
        while(Date.now()<t+1000) await new Promise(r=>setTimeout(r,200));
      }
      transferTimes[ref]=t;
      await operator.goto(base+'/staff/bookings/'+target);
      await operator.getByLabel('Mã tham chiếu giao dịch',{exact:true}).fill(ref);
      await operator.getByLabel('Số tiền thực nhận (VND)',{exact:true}).fill(String(amount));
      const timeInput=operator.getByLabel('Thời điểm chuyển (giờ VN)',{exact:true});
      await timeInput.fill(inputForm(vnLocal(t)));
      check('Transfer time input readback '+ref,await timeInput.inputValue(),inputForm(vnLocal(t)));
      if(seconds!==undefined) check('Transfer time case seconds '+ref,new Date(t).getUTCSeconds(),seconds);
      await operator.getByLabel('Tài khoản nguồn (giả lập)',{exact:true}).fill('DEMO-PAYER');
      await operator.getByLabel('Đã đối chiếu đúng đơn, nội dung, bên nhận DEMO và số tiền',{exact:true}).check();
      const response=operator.waitForResponse(r=>r.url().endsWith('/deposit/verify'));response.catch(()=>{});
      await operator.getByRole('button',{name:'Xác minh và ghi nhận',exact:true}).click();
      const readback=operator.waitForResponse(r=>r.url().endsWith('/bookings/'+target+'/deposit') && r.request().method()==='GET');readback.catch(()=>{});
      await operator.getByRole('button',{name:'Xác nhận ghi nhận DEMO',exact:true}).click();const verifyResponse=await response;check('Staff receipt '+ref,verifyResponse.status(),200);
      check('Transfer time payload equals intended VN time '+ref,vnLocal(Date.parse(verifyResponse.request().postDataJSON().transferTime)),vnLocal(t));
      check('Transfer time not before approval '+ref,t>=approvedAt,true);
      const ledger=await (await readback).json();check('Receipt present in ledger '+ref,ledger.payments.some(p=>p.providerTransaction===ref),true);
      check('Exactly one receipt for '+ref,sql(`select count(*) from payment_transactions where provider_transaction='${ref}'`),'1');
      check('Stored transfer time '+ref,sql(`select date_format(transfer_time,'%Y-%m-%dT%H:%i:%s') from payment_transactions where provider_transaction='${ref}'`),new Date(t).toISOString().slice(0,19));
    }
    await verify('BROWSER-A',200000,id,{seconds:0});
    check('Partial remains pending',(await req(user,'/bookings/'+id)).body.booking.status,'PENDING');
    await customer.goto(base+'/user/bookings/'+id);
    await userStatus.getByText('Tình trạng cọc: Đã có khoản nhận — đang đối soát',{exact:true}).waitFor();
    check('USER partial gives no missing-amount demand',await visible(customer.locator('main')).then(t=>t.includes('Còn thiếu')),false);
    check('USER partial hides verifier identity',await visible(customer.locator('main')).then(t=>t.includes('Xác minh bởi')),false);
    await customer.screenshot({path:path.join(out,'user-partial-qr.png'),fullPage:true});
    check('Partial missing amount',(await req(user,'/bookings/'+id)).body.booking.deposit.missingAmount,190000);
    await queueStage('RECEIVED_INCOMPLETE','Cần đối soát khoản nhận');
    await operator.goto(base+'/staff/bookings/'+id);
    const detail=operator.getByRole('region',{name:'Chi tiết đối soát cọc QR',exact:true});
    await detail.getByText('Tổng đã nhận (lịch sử)',{exact:true}).waitFor();
    check('Staff detail partial history',await detail.textContent().then(t=>t.includes('200.000')),true);
    await operator.screenshot({path:path.join(out,'staff-partial-detail.png'),fullPage:true});
    const beforeRead=sql('select concat((select count(*) from payment_transactions),":",(select count(*) from contracts),":",(select count(*) from booking_status_history))');
    await operator.route('**/api/v1/bookings/'+id+'/deposit',route=>route.abort(),{times:1});
    await operator.goto(base+'/staff/bookings/'+id);
    await operator.getByRole('button',{name:'Tải lại',exact:true}).waitFor();
    await operator.screenshot({path:path.join(out,'staff-read-error.png'),fullPage:true});
    await operator.getByRole('button',{name:'Tải lại',exact:true}).click();
    await operator.getByRole('region',{name:'Chi tiết đối soát cọc QR',exact:true}).getByText('Tổng đã nhận (lịch sử)',{exact:true}).waitFor();
    check('Read retry preserves ledger/contracts/history',sql('select concat((select count(*) from payment_transactions),":",(select count(*) from contracts),":",(select count(*) from booking_status_history))'),beforeRead);
    await verify('BROWSER-B',300000,id,{seconds:37,notBefore:transferTimes['BROWSER-A']});
    await queueStage('APPLIED','Đã ghi nhận cọc vào đơn');
    await customer.goto(base+'/user/bookings/'+id);await userStatus.getByText('Tình trạng cọc: Đã ghi nhận cọc vào đơn',{exact:true}).waitFor();
    check('Confirmed USER sees no QR transfer prompt',await customer.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).count(),0);
    check('Backend confirmed',(await req(user,'/bookings/'+id)).body.booking.status,'CONFIRMED');
    check('Applied exactly required',(await req(user,'/bookings/'+id)).body.booking.deposit.appliedAmount,390000);
    check('One contract',sql('select count(*) from contracts'),'1');
    check('Excess refund amount',sql('select sum(amount) from payment_refunds'),'110000');
    check('Excess refund starts approved, not refunded',sql('select status from payment_refunds'),'APPROVED');
    const userRefund=customer.getByRole('region',{name:'Tình trạng hoàn của bạn',exact:true});
    check('USER approved refund is not refunded',await visible(userRefund).then(t=>t.includes('Hoàn 110.000 ₫ · Đã duyệt, chưa hoàn tiền') && t.includes('Đã hoàn (đã xác minh): 0 ₫')),true);
    check('USER refund hides admin identity',await visible(customer.locator('main')).then(t=>t.includes('Duyệt bởi')),false);
    await customer.screenshot({path:path.join(out,'user-confirmed-qr.png'),fullPage:true});
    wait=customer.waitForResponse(r=>r.url().endsWith('/bookings/'+id+'/contract') && r.request().method()==='GET');
    await customer.getByRole('link',{name:'Hợp đồng',exact:true}).click();check('USER reads confirmed contract',(await wait).status(),200);
    await customer.screenshot({path:path.join(out,'user-contract-qr.png'),fullPage:true});
    await manager.goto(base+'/admin/payments');
    check('QR refunds do not offer VNPAY',await manager.getByRole('button',{name:'Gửi hoàn VNPAY Sandbox',exact:true}).count(),0);
    await manager.getByRole('button',{name:'Bắt đầu xử lý hoàn (QR DEMO)',exact:true}).click();
    await manager.getByRole('button',{name:'Xác nhận thao tác',exact:true}).click();
    await manager.getByLabel('Tài khoản nhận hoàn',{exact:true}).fill('DEMO-PAYER');
    await manager.getByLabel('Tham chiếu hoàn',{exact:true}).fill('BROWSER-REFUND');
    await manager.getByLabel('Thời điểm hoàn (giờ Việt Nam)',{exact:true}).fill(new Date(Date.now()+7*3600000).toISOString().slice(0,19));
    check('Starting refund is not completion',sql('select status from payment_refunds'),'PROCESSING');
    await customer.goto(base+'/user/bookings/'+id);
    check('USER processing refund is not refunded',await visible(userRefund).then(t=>t.includes('Hoàn 110.000 ₫ · Đang xử lý hoàn') && t.includes('Đã hoàn (đã xác minh): 0 ₫')),true);
    await manager.getByLabel('Đã đối chiếu tài khoản, số tiền và chứng từ hoàn DEMO',{exact:true}).check();
    wait=manager.waitForResponse(r=>r.url().endsWith('/complete-manual'));
    await manager.getByRole('button',{name:'Xác nhận đã hoàn DEMO',exact:true}).click();await manager.getByRole('button',{name:'Xác nhận thao tác',exact:true}).click();check('Manual completion response',(await wait).status(),200);
    check('Refund verified complete',sql('select status from payment_refunds'),'SUCCEEDED');
    check('Refund has bank reference',sql('select provider_transaction from payment_refunds'),'BROWSER-REFUND');
    await customer.goto(base+'/user/bookings/'+id);
    check('USER sees verified refund only after SUCCEEDED',await visible(userRefund).then(t=>t.includes('Hoàn 110.000 ₫ · Đã hoàn') && t.includes('Đã hoàn (đã xác minh): 110.000 ₫')),true);
    await customer.screenshot({path:path.join(out,'user-refund-succeeded-qr.png'),fullPage:true});
    await manager.screenshot({path:path.join(out,'admin-refund-qr.png'),fullPage:true});
    // G4.5: separate fixture booking (vehicle v3, pickup tomorrow => always <24h before start of pickup day).
    // Staff records the full DEMO deposit, then cancels as a late customer cancellation => REQUESTED refund that only Admin decides.
    const vnd=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(n).replaceAll('\u00a0',' ');
    const day2=new Date(Date.now()+1*86400000+7*3600000).toISOString().slice(0,10), end2=new Date(Date.now()+2*86400000+7*3600000).toISOString().slice(0,10);
    await customer.goto(base+`/user/bookings/new?vehicleId=v3&start=${day2}&end=${end2}&pickupBranchId=dn&returnBranchId=dn`);
    wait=customer.waitForResponse(r=>r.url().endsWith('/bookings/quote'));await customer.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();check('Fixture B quote',(await wait).status(),200);
    await customer.getByRole('checkbox',{name:'Tôi xác nhận thời gian, chi nhánh và tổng báo giá.',exact:true}).check();wait=customer.waitForResponse(r=>r.url().endsWith('/bookings') && r.request().method()==='POST');await customer.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true}).click();
    const r2=await wait;check('Fixture B request',r2.status(),201);const b2=await r2.json(),id2=b2.id;await customer.waitForURL('**/user/bookings/'+id2);
    check('Fixture B deposit required',b2.deposit.required,true);const dep2=b2.deposit.amount;
    await operator.goto(base+'/staff/bookings/'+id2);const panel2=operator.getByRole('region',{name:'Ảnh GPLX',exact:true});
    await panel2.getByLabel('Kết quả kiểm tra',{exact:true}).selectOption('APPROVED');await panel2.getByLabel('Nhận xét kiểm tra',{exact:true}).fill('Ảnh giả lập, chưa đối chiếu bản gốc.');wait=operator.waitForResponse(r=>r.url().endsWith('/license-photo-review'));await panel2.getByRole('button',{name:'Lưu kiểm tra hồ sơ',exact:true}).click();check('Fixture B photo review',(await wait).status(),200);
    wait=operator.waitForResponse(r=>r.url().endsWith('/deposit/approve'));await operator.getByRole('button',{name:'Duyệt hồ sơ và tạo mã QR cọc',exact:true}).click();check('Fixture B approve deposit',(await wait).status(),200);
    await verify('BROWSER-C',dep2,id2);
    check('Fixture B confirmed by full deposit',(await req(user,'/bookings/'+id2)).body.booking.status,'CONFIRMED');
    // Staff chỉ hủy CONFIRMED trong ngày nhận (bookingActions); trước đó Admin hủy theo yêu cầu khách sát giờ.
    await operator.goto(base+'/staff/bookings/'+id2);await operator.getByText('Hiện tại: Đã xác nhận',{exact:true}).waitFor();
    check('Staff has no cancel before pickup day',await operator.getByLabel('Chuyển trạng thái',{exact:true}).count(),0);
    await manager.goto(base+'/admin/bookings/'+id2);
    await manager.getByLabel('Chuyển trạng thái',{exact:true}).selectOption('CANCELLED');
    await manager.getByLabel('Lý do',{exact:true}).fill('Fixture: khách báo hủy sát giờ nhận.');
    await manager.getByLabel('Nguyên nhân hủy và chính sách hoàn cọc',{exact:true}).selectOption('LATE_CUSTOMER');
    wait=manager.waitForResponse(r=>r.url().endsWith('/bookings/'+id2+'/actions') && r.request().method()==='POST');await manager.getByRole('button',{name:'Xác nhận hủy đơn',exact:true}).click();check('Admin late-customer cancellation',(await wait).status(),200);
    const refund2=()=>sql(`select concat(status,':',kind,':',amount) from payment_refunds where booking_id='${id2}'`);
    check('Late cancellation queues Admin decision, not refund',refund2(),`REQUESTED:LATE_CUSTOMER:${dep2}`);
    const refundId2=sql(`select id from payment_refunds where booking_id='${id2}'`), paymentId2=sql(`select id from payment_transactions where booking_id='${id2}'`);
    const userRefund2=async()=>{await customer.goto(base+'/user/bookings/'+id2);return visible(customer.getByRole('region',{name:'Tình trạng hoàn của bạn',exact:true}));};
    let u2=await userRefund2();
    check('USER sees pending Admin decision with cause',u2.includes('Chờ quyết định hoàn') && u2.includes('Nguyên nhân: Khách hủy sát giờ') && u2.includes('Đã hoàn (đã xác minh): 0 ₫'),true);
    await customer.screenshot({path:path.join(out,'user-late-cancel-requested.png'),fullPage:true});
    await manager.goto(base+'/admin/payments');
    const adminRow=manager.getByRole('region',{name:'Yêu cầu hoàn '+refundId2,exact:true});
    check('Admin row shows cause code',await visible(adminRow).then(t=>t.includes('Nguyên nhân: Khách hủy sát giờ (LATE_CUSTOMER)') && t.includes('Chờ Admin quyết định')),true);
    check('Admin lifecycle summary present',await manager.getByLabel('Tóm tắt vòng đời hoàn',{exact:true}).count(),1);
    check('Admin loaded-range notice',await visible(manager.getByLabel('Phạm vi danh sách đã tải',{exact:true})).then(t=>t.includes('Đây không phải tổng toàn hệ thống')),true);
    check('Admin receipt shows verification and applied share',await visible(manager.getByRole('region',{name:'Khoản nhận '+paymentId2,exact:true})).then(t=>t.includes('mã người xác minh') && t.includes('Thời điểm chuyển:') && t.includes('Đã áp dụng')),true);
    const half=Math.floor(dep2/2);
    await adminRow.getByLabel('Số tiền hoàn (VND)',{exact:true}).fill(String(half));
    await adminRow.getByLabel('Lý do quyết định',{exact:true}).fill('Fixture: hoàn 50% theo quyết định Admin.');
    await adminRow.getByRole('button',{name:'Duyệt khoản hoàn',exact:true}).click();
    check('Decision review shows amount before POST',await visible(manager.getByRole('dialog',{name:'Xác nhận thao tác hoàn tiền',exact:true})).then(t=>t.includes(vnd(half))),true);
    check('No decision POST before confirmation',refund2(),`REQUESTED:LATE_CUSTOMER:${dep2}`);
    wait=manager.waitForResponse(r=>r.url().endsWith('/admin/refunds/'+refundId2+'/decide'));await manager.getByRole('button',{name:'Xác nhận thao tác',exact:true}).click();check('Admin partial decision',(await wait).status(),200);
    await manager.getByText(/Đã kiểm tra kết quả: Đã duyệt hoàn/).waitFor();
    check('Partial decision approved, not refunded',refund2(),`APPROVED:LATE_CUSTOMER:${half}`);
    check('Decision records approver',sql(`select approved_by is not null from payment_refunds where id='${refundId2}'`),'1');
    u2=await userRefund2();check('USER partial decision is not refunded',u2.includes(`Hoàn ${vnd(half)} · Đã duyệt, chưa hoàn tiền`) && u2.includes('Đã hoàn (đã xác minh): 0 ₫'),true);
    await manager.screenshot({path:path.join(out,'admin-late-cancel-approved.png'),fullPage:true});
    await adminRow.getByRole('button',{name:'Bắt đầu xử lý hoàn (QR DEMO)',exact:true}).click();
    wait=manager.waitForResponse(r=>r.url().endsWith('/process-manual'));await manager.getByRole('button',{name:'Xác nhận thao tác',exact:true}).click();check('Fixture B start processing',(await wait).status(),200);
    check('Processing is not completion (fixture B)',refund2(),`PROCESSING:LATE_CUSTOMER:${half}`);
    await adminRow.getByLabel('Tài khoản nhận hoàn',{exact:true}).fill('DEMO-PAYER');
    await adminRow.getByLabel('Tham chiếu hoàn',{exact:true}).fill('BROWSER-REFUND-C');
    await adminRow.getByLabel('Thời điểm hoàn (giờ Việt Nam)',{exact:true}).fill(new Date(Date.now()+7*3600000).toISOString().slice(0,19));
    await adminRow.getByLabel('Đã đối chiếu tài khoản, số tiền và chứng từ hoàn DEMO',{exact:true}).check();
    await adminRow.getByRole('button',{name:'Xác nhận đã hoàn DEMO',exact:true}).click();
    wait=manager.waitForResponse(r=>r.url().endsWith('/complete-manual'));await manager.getByRole('button',{name:'Xác nhận thao tác',exact:true}).click();check('Fixture B manual completion',(await wait).status(),200);
    check('Fixture B refund verified complete',refund2(),`SUCCEEDED:LATE_CUSTOMER:${half}`);
    check('Fixture B refund reference',sql(`select provider_transaction from payment_refunds where id='${refundId2}'`),'BROWSER-REFUND-C');
    check('Partial refund never exceeds receipt',Number(sql(`select sum(amount) from payment_refunds where booking_id='${id2}'`))<=dep2,true);
    // Select nằm trong <label> nên tên truy cập gồm cả chữ option; chọn qua label chứa nó.
    await manager.locator('label').filter({hasText:/^Trạng thái hoàn/}).locator('select').selectOption('');
    check('Admin row shows verified completion',await visible(adminRow).then(t=>t.includes('Đã hoàn — kết quả đã xác minh với tham chiếu BROWSER-REFUND-C')),true);
    await manager.screenshot({path:path.join(out,'admin-late-cancel-succeeded.png'),fullPage:true});
    u2=await userRefund2();check('USER sees refunded only after SUCCEEDED (fixture B)',u2.includes(`Hoàn ${vnd(half)} · Đã hoàn`) && u2.includes(`Đã hoàn (đã xác minh): ${vnd(half)}`),true);
    await customer.screenshot({path:path.join(out,'user-late-cancel-succeeded.png'),fullPage:true});
    // QR-G5.2: exact per-booking invariants for the main USER -> STAFF -> USER -> ADMIN booking A.
    check('A exactly one contract',sql(`select count(*) from contracts where booking_id='${id}'`),'1');
    check('A ledger two receipts, applied equals deposit',sql(`select concat(count(*),':',sum(amount),':',sum(applied_amount)) from payment_transactions where booking_id='${id}' and status='SUCCEEDED'`),'2:500000:390000');
    check('A confirmed exactly once',sql(`select count(*) from booking_status_history where booking_id='${id}' and next_status='CONFIRMED'`),'1');
    check('A one excess refund, succeeded',sql(`select concat(count(*),':',sum(amount),':',min(status)) from payment_refunds where booking_id='${id}'`),'1:110000:SUCCEEDED');
    check('A exactly one transfer report event',sql(`select count(*) from payment_events where booking_id='${id}' and kind='TRANSFER_REPORTED'`),'1');
    check('Fixture B keeps its single contract after cancellation',sql(`select count(*) from contracts where booking_id='${id2}'`),'1');

    // QR-G5.3a ownership: a second synthetic USER registered only in this isolated schema (generated test password, never logged).
    const reg=await req(null,'/auth/register','POST',{email:`g5.other.${Date.now()}@example.test`,fullName:'Khách khác G5',password:'G5-'+crypto.randomBytes(12).toString('hex')});
    check('Second synthetic USER registered in isolated schema',reg.status,201);const other=reg.body.token;
    for(const [name,ep] of [['booking',`/bookings/${id}`],['deposit ledger',`/bookings/${id}/deposit`],['QR payload',`/bookings/${id}/deposit/qr-payload`],['QR image',`/bookings/${id}/deposit/qr`]])
      check('Other USER cannot read A '+name,(await req(other,ep)).status,404);
    const stranger=await page(other);
    wait=stranger.waitForResponse(r=>r.url().endsWith('/api/v1/bookings/'+id) && r.request().method()==='GET');await stranger.goto(base+'/user/bookings/'+id);check('Other USER UI read of A is refused',(await wait).status(),404);
    check('Other USER UI shows no deposit panel or QR',await stranger.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).count()+await stranger.getByText('Cọc giữ chỗ',{exact:false}).count(),0);
    await stranger.screenshot({path:path.join(out,'other-user-denied.png'),fullPage:true});

    // QR-G5.3b expiry and late money: booking C (vehicle v3, day+4..+5). The expired state is a LABELLED PAST-DATED SQL FIXTURE
    // on this isolated schema only (approval/deadlines shifted into the past); application and database clocks are untouched.
    const day3=new Date(Date.now()+4*86400000+7*3600000).toISOString().slice(0,10), end3=new Date(Date.now()+5*86400000+7*3600000).toISOString().slice(0,10);
    await customer.goto(base+`/user/bookings/new?vehicleId=v3&start=${day3}&end=${end3}&pickupBranchId=dn&returnBranchId=dn`);
    wait=customer.waitForResponse(r=>r.url().endsWith('/bookings/quote'));await customer.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();check('Fixture C quote',(await wait).status(),200);
    await customer.getByRole('checkbox',{name:'Tôi xác nhận thời gian, chi nhánh và tổng báo giá.',exact:true}).check();wait=customer.waitForResponse(r=>r.url().endsWith('/bookings') && r.request().method()==='POST');await customer.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true}).click();
    const r3=await wait;check('Fixture C request',r3.status(),201);const b3=await r3.json(),id3=b3.id,dep3=b3.deposit.amount;await customer.waitForURL('**/user/bookings/'+id3);
    await operator.goto(base+'/staff/bookings/'+id3);const panel3=operator.getByRole('region',{name:'Ảnh GPLX',exact:true});
    await panel3.getByLabel('Kết quả kiểm tra',{exact:true}).selectOption('APPROVED');await panel3.getByLabel('Nhận xét kiểm tra',{exact:true}).fill('Ảnh giả lập, chưa đối chiếu bản gốc.');wait=operator.waitForResponse(r=>r.url().endsWith('/license-photo-review'));await panel3.getByRole('button',{name:'Lưu kiểm tra hồ sơ',exact:true}).click();check('Fixture C photo review',(await wait).status(),200);
    wait=operator.waitForResponse(r=>r.url().endsWith('/deposit/approve'));await operator.getByRole('button',{name:'Duyệt hồ sơ và tạo mã QR cọc',exact:true}).click();check('Fixture C approve deposit',(await wait).status(),200);
    check('Other USER cannot report for C',(await req(other,`/bookings/${id3}/deposit/report`,'POST',{idempotencyKey:'report-'+id3})).status,404);
    sql(`update bookings set deposit_approved_at=timestampadd(MINUTE,-120,utc_timestamp(6)),payment_due_at=timestampadd(MINUTE,-90,utc_timestamp(6)),review_due_at=timestampadd(MINUTE,-60,utc_timestamp(6)),original_hold_until=timestampadd(MINUTE,-60,utc_timestamp(6)),expires_at=timestampadd(MINUTE,-60,utc_timestamp(6)) where id='${id3}' and status='PENDING'`);
    check('LABELLED past-dated fixture C applied (isolated schema only)',sql(`select concat(status,':',payment_due_at<utc_timestamp(6),':',expires_at<utc_timestamp(6)) from bookings where id='${id3}'`),'PENDING:1:1');
    await customer.goto(base+'/user/bookings/'+id3);
    await userStatus.getByText('Tình trạng cọc: Đơn đã hết hạn giữ chỗ',{exact:true}).waitFor();
    check('Expired C offers no QR or report',await customer.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).count()+await customer.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).count(),0);
    check('Expired C makes no missing-amount demand',await visible(customer.locator('main')).then(t=>t.includes('Còn thiếu')),false);
    check('Report after deadline rejected by backend',(await req(user,`/bookings/${id3}/deposit/report`,'POST',{idempotencyKey:'report-'+id3})).status,409);
    check('Rejected late report records nothing',sql(`select count(*) from payment_events where booking_id='${id3}' and kind='TRANSFER_REPORTED'`),'0');
    check('Rejected late report does not extend hold',sql(`select expires_at<utc_timestamp(6) from bookings where id='${id3}'`),'1');
    await customer.screenshot({path:path.join(out,'user-expired-fixture-c.png'),fullPage:true});
    // G5-F01: pickup Staff records the late DEMO receipt through the UI on the expired booking, with the refund warning.
    await operator.goto(base+'/staff/bookings/'+id3);
    check('Staff sees late-receipt refund warning on expired booking',await visible(operator.getByLabel('Cảnh báo đơn hết hạn',{exact:true})).then(t=>t.includes('không xác nhận đơn, không giành lại lịch và được đưa vào hoàn')),true);
    await verify('BROWSER-LATE',dep3,id3);
    check('Late receipt never confirms C',(await req(user,'/bookings/'+id3)).body.booking.status==='CONFIRMED',false);
    check('Late receipt issues no contract for C',sql(`select count(*) from contracts where booking_id='${id3}'`),'0');
    const late3=sql(`select concat(status,':',kind,':',amount) from payment_refunds where booking_id='${id3}'`);
    check('Late money queued as approved refund of the full unapplied receipt',late3.replace(/:(LATE|UNAPPLIED):/,':K:'),`APPROVED:K:${dep3}`);
    check('Late receipt applied amount stays zero',sql(`select applied_amount from payment_transactions where booking_id='${id3}'`),'0');
    await customer.goto(base+'/user/bookings/'+id3);await userStatus.getByText('Tình trạng cọc: Đơn đã hết hạn giữ chỗ',{exact:true}).waitFor();
    const late3Text=await visible(customer.locator('main'));
    check('USER sees late-transfer explanation',late3Text.includes('Có khoản chuyển từ hạn đóng cọc trở đi. Khoản này không được áp dụng vào đơn'),true);
    // R02: thông báo VERIFICATION_LATE phải nằm trong vùng "Tình trạng cọc của bạn".
    const userStatus3=await visible(userStatus);
    check('USER sees from-deadline verification wording',userStatus3.includes('Có khoản được xác minh từ thời điểm hết hạn đối soát trở đi. Khoản này không được áp dụng vào đơn; xem tình trạng hoàn bên dưới.'),true);
    // Chỉ quét khu tình trạng cọc của USER: khung "Hồ sơ sự cố" có sẵn câu "không tự kết luận trách nhiệm".
    check('USER verification note assigns no blame',/lỗi của bạn|trách nhiệm|sau hạn đối soát của nhân viên/.test(await visible(userStatus)),false);
    check('USER status region asks no extra payment',/Còn thiếu|đóng thêm/.test(userStatus3),false);
    check('USER sees historical total, not money held',late3Text.includes(`Tổng đã nhận (lịch sử): ${vnd(dep3)}`) && late3Text.includes('không phải số tiền hệ thống đang giữ'),true);
    check('USER late refund approved but not refunded',await visible(customer.getByRole('region',{name:'Tình trạng hoàn của bạn',exact:true})).then(t=>t.includes('Đã duyệt, chưa hoàn tiền') && t.includes('Đã hoàn (đã xác minh): 0 ₫')),true);
    await customer.screenshot({path:path.join(out,'user-expired-late-money-c.png'),fullPage:true});
    await operator.goto(base+'/staff/bookings/'+id3);
    const staff3=await visible(operator.getByRole('region',{name:'Chi tiết đối soát cọc QR',exact:true}));
    check('Staff sees expired stage and late warnings for C',staff3.includes('Đã hết hạn') && staff3.includes('Có khoản chuyển từ hạn đóng cọc trở đi'),true);
    await operator.screenshot({path:path.join(out,'staff-expired-late-money-c.png'),fullPage:true});

    // QR-G5.3c Admin list read failure and recovery (GET only, no mutation).
    const mutationsBefore=sql("select concat((select count(*) from payment_refunds),':',(select count(*) from payment_transactions),':',(select count(*) from payment_events))");
    await manager.route('**/api/v1/admin/payments',route=>route.abort(),{times:1});
    await manager.goto(base+'/admin/payments');await manager.getByRole('button',{name:'Tải lại',exact:true}).waitFor();
    await manager.waitForTimeout(500);
    check('Admin list failure shows no stale rows',await manager.locator('[aria-label^="Khoản nhận "]').count(),0);
    await manager.screenshot({path:path.join(out,'admin-list-read-error.png'),fullPage:true});
    await manager.getByRole('button',{name:'Tải lại',exact:true}).click();
    await manager.locator('[aria-label^="Khoản nhận "]').first().waitFor();
    check('Admin list recovery mutates nothing',sql("select concat((select count(*) from payment_refunds),':',(select count(*) from payment_transactions),':',(select count(*) from payment_events))"),mutationsBefore);
    // D2: Admin tra cứu phía server theo tiền tố mã đơn (không phân biệt hoa thường) trên API thật.
    const d2q=id3.slice(0,8).toUpperCase();
    await manager.getByLabel('Tra cứu trên máy chủ (mã đơn, mã giao dịch, tham chiếu)',{exact:true}).fill(d2q);
    wait=manager.waitForResponse(r=>r.url().includes('/api/v1/admin/payments?q=') && r.request().method()==='GET');
    await manager.getByRole('button',{name:'Tra cứu máy chủ',exact:true}).click();
    const d2res=await wait;check('D2 server search request',d2res.status(),200);
    const d2body=await d2res.json();
    check('D2 server search returns only matching receipts',d2body.payments.length>0 && d2body.payments.every(p=>p.bookingId.toLowerCase().startsWith(d2q.toLowerCase()) || (p.providerTransaction||'').toLowerCase().startsWith(d2q.toLowerCase()) || p.id.toLowerCase().startsWith(d2q.toLowerCase())),true);
    check('D2 server search includes the late receipt of C',d2body.payments.some(p=>p.providerTransaction==='BROWSER-LATE'),true);
    await manager.getByLabel('Phạm vi tra cứu máy chủ',{exact:true}).waitFor();
    check('D2 search scope shown in UI',await visible(manager.getByLabel('Phạm vi tra cứu máy chủ',{exact:true})).then(t=>t.includes('“'+d2q+'”')),true);
    check('D2 short keyword rejected by API',(await req(admin,'/admin/payments?q=ab')).status,400);
    check('D2 search is Admin only',(await req(staff,'/admin/payments?q='+d2q)).status,403);
    await manager.screenshot({path:path.join(out,'admin-server-search.png'),fullPage:true});
    await manager.getByRole('button',{name:'Bỏ tra cứu',exact:true}).click();
    check('Staff cannot decide refunds',(await req(staff,'/admin/refunds/'+refundId2+'/decide','POST',{expectedVersion:0,amount:0,reason:'x'})).status,403);
    check('Guest cannot read QR',(await req(null,'/bookings/'+id+'/deposit/qr-payload')).status,401);
    check('User cannot access admin',(await req(user,'/admin/payments')).status,403);
    // D1: ledger theo vai trò trên API thật — USER không nhận mã nội bộ/khóa yêu cầu/events; Admin giữ đầy đủ.
    const d1User=(await req(user,'/bookings/'+id+'/deposit')).body, d1Admin=(await req(admin,'/bookings/'+id+'/deposit')).body;
    check('D1 USER ledger has no internal fields',!('events' in d1User) && d1User.payments.length===2 && d1User.payments.every(p=>!('verifierId' in p) && !('idempotencyKey' in p)) && d1User.refunds.every(r=>!('approvedBy' in r) && !('requestDate' in r)),true);
    check('D1 USER ledger keeps display fields',d1User.payments.every(p=>p.providerTransaction && p.transferTime && p.verifiedAt && Number.isSafeInteger(p.appliedAmount)),true);
    check('D1 Admin ledger keeps internal fields',d1Admin.events.length>0 && d1Admin.payments.every(p=>!!p.verifierId && !!p.idempotencyKey),true);
    check('Staff cannot report transfer for customer',(await req(staff,'/bookings/'+id+'/deposit/report','POST',{idempotencyKey:'report-'+id})).status>=400,true);
    check('No JS page errors',errors,[]);
  } catch(error) { for(const [name,p] of [["user",customer],["staff",operator],["admin",manager]]) {await p.screenshot({path:path.join(out,`failure-${name}.png`),fullPage:true}).catch(()=>{});} throw error;} finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
