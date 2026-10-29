// G5.2: real UI early-return journey; separately labelled dated on-time SQL fixture.
// No bank, real identity, production clock override, or website database.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.C11_PLAYWRIGHT);
const out = process.env.C11_EVIDENCE, base = 'http://127.0.0.1:5300';
const fixture = JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE, 'fixture.json')));
const config = fs.readFileSync(path.join(out, 'application.private.properties'), 'utf8');
assert(config.includes('app.return-policy-enabled=true')); assert(config.includes('app.deposit-method=DEMO_QR_MANUAL'));
const password = config.match(/^spring.datasource.password=(.*)$/m)[1];
const accountPassword = config.match(/^app.seed-password=(.*)$/m)[1];
const schema = config.match(/jdbc:mysql:\/\/127.0.0.1:33676\/([^?]+)/)[1];
assert.match(schema, /^kdrive_c14_browser_[a-f0-9]+$/); assert.equal(fixture.port, 33676);
const checks = [], errors = [], consoleErrors = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push({name, actual, expected}); fs.writeFileSync(path.join(out,'browser-assertions.json'), JSON.stringify(checks,null,2)); }
function sql(q) { try { return cp.execFileSync('docker',['exec','-e','MYSQL_PWD='+password,fixture.name,'mysql','--default-character-set=utf8mb4','-uroot','-N','--raw',schema,'-e',q],{encoding:'utf8',windowsHide:true,timeout:15000}).trim(); } catch { throw Error('Isolated SQL failed; private details withheld'); } }
const lit = x => x === null ? 'NULL' : typeof x === 'number' ? String(x) : `CONVERT(0x${Buffer.from(String(x)).toString('hex')} USING utf8mb4)`;
function insert(table, values) { sql(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.values(values).map(lit).join(',')})`); }
const today = new Date(Date.now()+7*3600000).toISOString().slice(0,10);
function day(offset) { return new Date(Date.parse(today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10); }
function stamp(offset, end=false) { return new Date(Date.parse(day(offset)+'T00:00:00+07:00')+(end?86400000-1:0)).toISOString(); }
const dbStamp = value => value.replace('T',' ').replace('Z','');
const bookingPath = id => '/api/v1/bookings/'+id;
async function responseFor(p, suffix, method, action) { const wait=p.waitForResponse(r=>new URL(r.url()).pathname===suffix && r.request().method()===method); await action(); return await wait; }
async function detail(p, role, id) { const r=await responseFor(p,bookingPath(id),'GET',()=>p.goto(base+`/${role}/bookings/${id}`)); check(role+' detail response',r.status(),200); return (await r.json()).booking; }
function stable(id) { return sql(`SELECT total,rental_total,one_way_fee,daily_price,rental_days,start_at,end_at,return_policy_version,return_policy_snapshot,return_policy_accepted_at,deposit_amount,deposit_required,deposit_txn_ref FROM bookings WHERE id='${id}'`); }
async function main() {
  check('database Vietnam date',sql('SELECT DATE(UTC_TIMESTAMP()+INTERVAL 7 HOUR)'),today);
  check('fresh bookings',sql('SELECT COUNT(*) FROM bookings'),'0');
  sql("UPDATE vehicles SET current_branch_id='dn',status='ACTIVE',daily_price=650000 WHERE id IN ('v1','v3')");
  const browser=await chromium.launch({headless:true}); const pages=[];
  async function login(email) {
    const context=await browser.newContext({viewport:{width:1440,height:900}}), p=await context.newPage(); pages.push(p); p.setDefaultTimeout(15000);
    p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await p.goto(base+'/login'); await p.getByLabel('Email',{exact:true}).fill(email); await p.getByLabel('Mật khẩu',{exact:true}).fill(accountPassword);
    const r=await responseFor(p,'/api/v1/auth/login','POST',()=>p.getByRole('button',{name:'Đăng nhập',exact:true}).click()); check('UI login '+email,r.status(),200); await p.waitForURL(u=>!u.pathname.endsWith('/login')); return p;
  }
  async function shot(p,name) { await p.screenshot({path:path.join(out,name+'.png'),fullPage:false}); check(name+' no page overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); }
  async function action(p,id,next) {
    await detail(p,'staff',id); await p.getByLabel('Chuyển trạng thái',{exact:true}).selectOption(next);
    if(next==='IN_PROGRESS') { await p.getByLabel('Tình trạng xe / ghi chú',{exact:true}).fill('SYNTHETIC vehicle handed over in isolated QA'); await p.getByLabel('Đã kiểm tra GPLX và xe phù hợp đến hết chuyến.',{exact:true}).check(); }
    const form=p.locator('form').filter({has:p.getByLabel('Chuyển trạng thái',{exact:true})});
    const r=await responseFor(p,bookingPath(id)+'/actions','POST',()=>form.getByRole('button').click()); check('UI action '+next,r.status(),200); check('DB action '+next,sql(`SELECT status FROM bookings WHERE id='${id}'`),next);
  }
  async function document(p,id,kind) {
    await detail(p,'user',id); const label=kind==='contract'?'Hợp đồng':'Hóa đơn'; await p.getByRole('link',{name:label,exact:true}).click(); await p.getByRole('heading',{name:label+' thuê xe',exact:true}).waitFor();
    if(kind==='contract') await p.getByRole('region',{name:'Chính sách trả xe đã lưu',exact:true}).waitFor();
    else await p.getByText('Hóa đơn không phải bằng chứng thanh toán.',{exact:true}).waitFor();
    await shot(p,id.slice(0,8)+'-'+kind);
  }
  async function returnAndComplete(user,staff,id,timing,total) {
    const original=stable(id), contract=sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`);
    const refunds=sql('SELECT COUNT(*) FROM payment_refunds');
    const u=await detail(user,'user',id); check('USER active booking',u.status,'IN_PROGRESS'); check('USER no return form',await user.getByRole('form',{name:'Ghi nhận trả xe',exact:true}).count(),0);
    await detail(staff,'staff',id); await staff.getByLabel('Tình trạng xe / ghi chú nhận trả',{exact:true}).fill('SYNTHETIC '+timing+' inspection, no damage');
    const preview=await responseFor(staff,bookingPath(id)+'/return-preview','GET',()=>staff.getByRole('button',{name:'Xem trước nhận trả',exact:true}).click()); check('Preview response',preview.status(),200); const assessment=(await preview.json()).assessment;
    check('Preview timing',assessment.timing,timing); check('Preview fee',assessment.amountVnd,0); check('Preview snapshot daily price',assessment.dailyPriceVnd,650000); check('Preview no writes',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${id}' AND kind='RETURN'`),'0');
    await staff.getByRole('region',{name:'Dự kiến nhận trả',exact:true}).waitFor(); await shot(staff,timing+'-preview');
    const returned=await responseFor(staff,bookingPath(id)+'/actions','POST',()=>staff.getByRole('button',{name:'Xác nhận đã nhận xe',exact:true}).click()); check('UI receive',returned.status(),200);
    const read=await detail(user,'user',id); check('Readback returned',read.status,'RETURNED'); check('Readback timing',read.returnAssessment.timing,timing); check('Readback no debt',read.returnAssessment.collectionStatus,'NOT_DUE');
    await user.getByRole('region',{name:'Kết quả nhận trả',exact:true}).waitFor(); await shot(user,timing+'-returned');
    check('Return preserved booking',stable(id),original); check('Return preserved contract',sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`),contract);
    await action(staff,id,'COMPLETED'); const complete=await detail(user,'user',id); check('USER complete readback',complete.status,'COMPLETED');
    check('One return',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${id}' AND kind='RETURN'`),'1'); check('One invoice',sql(`SELECT COUNT(*) FROM invoices WHERE booking_id='${id}'`),'1'); check('Invoice original total',sql(`SELECT total FROM invoices WHERE booking_id='${id}'`),String(total));
    check('No automatic refund',sql('SELECT COUNT(*) FROM payment_refunds'),refunds); check('No overdue receipts',sql(`SELECT COUNT(*) FROM booking_return_settlements WHERE booking_id='${id}'`),'0'); check('Completion preserves original',stable(id),original); check('Completion preserves contract',sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`),contract);
    await document(user,id,'invoice');
  }
  try {
    const user=await login('user@example.test'), staff=await login('staff.dn@example.test');
    await user.goto(base+'/user/profile'); await user.getByLabel('Số giấy phép',{exact:true}).fill('SYNTHETIC-RETURN-G5'); await user.getByLabel('Hệ giấy phép',{exact:true}).selectOption('VN_2025'); await user.getByLabel('Hạng bằng',{exact:true}).selectOption('B'); await user.getByLabel('Ngày hết hạn',{exact:true}).fill('2035-12-31');
    let r=await responseFor(user,'/api/v1/me/license','PUT',()=>user.getByRole('button',{name:'Lưu thông tin GPLX',exact:true}).click()); check('License declaration',r.status(),200);
    const imagePage=await browser.newPage(); await imagePage.setContent('<h1>GPLX GIẢ LẬP — KHÔNG PHẢI GIẤY TỜ THẬT</h1>'); const image=await imagePage.screenshot(); await imagePage.close();
    for(const label of ['Ảnh mặt trước','Ảnh mặt sau']) await user.getByLabel(label,{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
    r=await responseFor(user,'/api/v1/me/license/photos','PUT',()=>user.getByRole('button',{name:'Lưu hai mặt ảnh GPLX',exact:true}).click()); check('Synthetic photos saved',r.status(),200);
    await user.goto(base+`/user/bookings/new?vehicleId=v1&start=${today}&end=${day(2)}&pickupBranchId=dn&returnBranchId=dn`);
    async function quote() { const response=await responseFor(user,'/api/v1/bookings/quote','POST',()=>user.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click()); check('Quote API',response.status(),200); return response.json(); }
    const q=await quote(); check('Policy version quoted',q.returnPolicy.version,'same-branch-return-v1');
    const agree=user.getByLabel('Tôi đã đọc chính sách trả xe sớm/muộn.',{exact:true}); const price=user.getByLabel('Tôi xác nhận thời gian, chi nhánh và tổng báo giá.',{exact:true});
    await price.check(); check('Missing policy prevents send',await user.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true}).isDisabled(),true); await agree.check(); await quote(); check('Requote resets policy consent',await agree.isChecked(),false); await price.check(); await agree.check();
    r=await responseFor(user,'/api/v1/bookings','POST',()=>user.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true}).click()); check('UI create',r.status(),201); const created=await r.json(), id=created.id; await user.waitForURL('**/user/bookings/'+id);
    check('Exactly one request',sql('SELECT COUNT(*) FROM bookings'),'1'); check('Rental total',created.rentalTotal,1300000); check('Fee',created.oneWayFee,0); check('Deposit',created.deposit.amount,390000); check('Policy accepted timestamp exists',Boolean(created.returnPolicy.acceptedAt),true);
    await detail(staff,'staff',id); const review=staff.getByRole('region',{name:'Ảnh GPLX',exact:true}); await review.getByLabel('Kết quả kiểm tra',{exact:true}).selectOption('APPROVED'); await review.getByLabel('Nhận xét kiểm tra',{exact:true}).fill('SYNTHETIC fixture images only');
    r=await responseFor(staff,bookingPath(id)+'/license-photo-review','POST',()=>review.getByRole('button',{name:'Lưu kiểm tra hồ sơ',exact:true}).click()); check('Staff photo review',r.status(),200);
    r=await responseFor(staff,bookingPath(id)+'/deposit/approve','POST',()=>staff.getByRole('button',{name:'Duyệt hồ sơ và tạo mã QR cọc',exact:true}).click()); check('Staff deposit approval',r.status(),200);
    await detail(user,'user',id); await user.getByRole('button',{name:'Hiển thị mã QR cọc',exact:true}).click(); const qr=user.getByAltText('Mã QR cọc giả lập'); await qr.waitFor(); check('QR decoded',await qr.evaluate(async i=>{await i.decode();return i.naturalWidth>0;}),true);
    r=await responseFor(user,bookingPath(id)+'/deposit/report','POST',()=>user.getByRole('button',{name:'Gửi báo đã chuyển khoản',exact:true}).click()); check('USER demo report',r.status(),200); check('Report does not confirm',sql(`SELECT status FROM bookings WHERE id='${id}'`),'PENDING');
    await detail(staff,'staff',id); await staff.getByLabel('Mã tham chiếu giao dịch',{exact:true}).fill('G5-EARLY-DEMO'); await staff.getByLabel('Số tiền thực nhận (VND)',{exact:true}).fill('390000'); await staff.getByLabel('Thời điểm chuyển (giờ VN)',{exact:true}).fill(new Date(Date.now()+7*3600000).toISOString().slice(0,19)); await staff.getByLabel('Tài khoản nguồn (giả lập)',{exact:true}).fill('DEMO-ONLY'); await staff.getByLabel('Đã đối chiếu đúng đơn, nội dung, bên nhận DEMO và số tiền',{exact:true}).check(); await staff.getByRole('button',{name:'Xác minh và ghi nhận',exact:true}).click();
    r=await responseFor(staff,bookingPath(id)+'/deposit/verify','POST',()=>staff.getByRole('button',{name:'Xác nhận ghi nhận DEMO',exact:true}).click()); check('Staff exact demo receipt',r.status(),200);
    const confirmed=await detail(user,'user',id); check('Confirmed by deposit',confirmed.status,'CONFIRMED'); check('Exact deposit applied',confirmed.deposit.appliedAmount,390000);
    const contract=JSON.parse(sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`)); check('Contract policy equals saved booking',contract.returnPolicy,confirmed.returnPolicy); await document(user,id,'contract');
    await action(staff,id,'IN_PROGRESS');
    // Alter catalog price only in isolated fixture: saved policy/price must remain authoritative.
    sql("UPDATE vehicles SET daily_price=990000 WHERE id='v1'");
    await returnAndComplete(user,staff,id,'EARLY',1300000);
    // An occupied future date inside the original booking remains unavailable, even after completion.
    await user.goto(base+`/user/bookings/new?vehicleId=v1&start=${day(1)}&end=${day(2)}&pickupBranchId=dn&returnBranchId=dn`);
    r=await responseFor(user,'/api/v1/bookings/quote','POST',()=>user.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click()); check('Early return retains original occupied dates',r.status(),409); check('Failed quote creates no booking',sql('SELECT COUNT(*) FROM bookings'),'1'); await shot(user,'early-still-reserved');
    // Separate on-time fixture: never claim this SQL setup was a UI booking in the past.
    const ontime=randomUUID(), accepted=stamp(-3), start=stamp(-2), end=stamp(0,true);
    insert('bookings',{id:ontime,user_id:'demo-user',vehicle_id:'v3',pickup_branch_id:'dn',return_branch_id:'dn',start_at:dbStamp(start),end_at:dbStamp(end),created_at:dbStamp(accepted),expires_at:dbStamp(accepted),status:'IN_PROGRESS',daily_price:650000,rental_days:2,rental_total:1300000,one_way_fee:0,total:1300000,customer_name:'SYNTHETIC G5',vehicle_name:'G5 fixture đúng hạn',pickup_name:'Đà Nẵng',return_name:'Đà Nẵng',policy_version:created.policyVersion,version:2,return_policy_version:confirmed.returnPolicy.version,return_policy_snapshot:JSON.stringify(confirmed.returnPolicy.terms),return_policy_accepted_at:dbStamp(accepted)});
    const fixtureContract={...contract,vehicle:'G5 fixture đúng hạn',startAt:start,endAt:end,returnPolicy:{...confirmed.returnPolicy,acceptedAt:accepted}}; delete fixtureContract.deposit;
    insert('contracts',{id:randomUUID(),booking_id:ontime,issued_at:dbStamp(accepted),snapshot:JSON.stringify(fixtureContract),terms_version:'terms-2026-09-28'});
    insert('vehicle_handover_records',{id:randomUUID(),booking_id:ontime,kind:'HANDOVER',actor_id:'demo-staff-dn',branch_id:'dn',occurred_at:dbStamp(start),condition_note:'SYNTHETIC dated fixture, not UI handover',maintenance:0});
    for(const [prev,next,time] of [[null,'PENDING',accepted],['PENDING','CONFIRMED',accepted],['CONFIRMED','IN_PROGRESS',start]]) insert('booking_status_history',{id:randomUUID(),booking_id:ontime,previous_status:prev,next_status:next,actor_id:'demo-staff-dn',occurred_at:dbStamp(time),reason:'SYNTHETIC dated fixture'});
    fs.writeFileSync(path.join(out,'fixture-boundaries.json'),JSON.stringify({early:{id,setup:'UI create/QR/hand over; catalog price changed only'},onTime:{id:ontime,setup:'SQL dated IN_PROGRESS + contract/HANDOVER, no deposit requirement; UI return/complete only'},today},null,2));
    await returnAndComplete(user,staff,ontime,'ON_TIME',1300000);
    await user.goto(base+'/user/bookings'); await user.getByRole('link',{name:'Chi tiết',exact:true}).first().waitFor(); check('Both finished in database',sql("SELECT COUNT(*) FROM bookings WHERE status='COMPLETED'"),'2'); await shot(user,'user-finished-list');
    // Intentional network failure, no mocked success data.
    await user.route('**/api/v1/bookings/'+ontime,route=>route.abort('failed')); await user.goto(base+'/user/bookings/'+ontime); await user.getByRole('button',{name:'Thử tải lại',exact:true}).waitFor(); check('API failure no policy data',await user.getByRole('region',{name:'Chính sách trả xe đã lưu',exact:true}).count(),0); await shot(user,'api-error');
    check('No JS errors',errors,[]); check('Test stayed within Vietnam day',sql('SELECT DATE(UTC_TIMESTAMP()+INTERVAL 7 HOUR)'),today);
    fs.writeFileSync(path.join(out,'console-health.json'),JSON.stringify({errors,consoleErrors,expected:'409 occupied schedule and deliberate transport failure'},null,2));
  } catch(error) { for(let i=0;i<pages.length;i++) await pages[i].screenshot({path:path.join(out,'failure-'+i+'.png'),fullPage:false}).catch(()=>{}); throw error; }
  finally { await browser.close(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
