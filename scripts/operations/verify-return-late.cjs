// G5.3: dated synthetic A/B fixtures, real UI late-return and settlement workflow.
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
  check('DB date Vietnam',sql('SELECT DATE(UTC_TIMESTAMP()+INTERVAL 7 HOUR)'),today); check('Fresh bookings',sql('SELECT COUNT(*) FROM bookings'),'0');
  sql("UPDATE vehicles SET current_branch_id='dn',status='ACTIVE',daily_price=650000 WHERE id IN ('v1','v3')");
  const browser=await chromium.launch({headless:true}), pages=[];
  async function login(email) {
    const c=await browser.newContext({viewport:{width:1440,height:900}}),p=await c.newPage();pages.push(p);p.setDefaultTimeout(15000);
    p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await p.goto(base+'/login');await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Mật khẩu',{exact:true}).fill(accountPassword);
    const r=await responseFor(p,'/api/v1/auth/login','POST',()=>p.getByRole('button',{name:'Đăng nhập',exact:true}).click());check('Login '+email,r.status(),200);await p.waitForURL(u=>!u.pathname.endsWith('/login'));return p;
  }
  async function shot(p,name,region) {if(region)await region.scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,name+'.png'),fullPage:false});check(name+' no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  async function handover(p,id,status) {
    await detail(p,'staff',id);await p.getByLabel('Chuyển trạng thái',{exact:true}).selectOption('IN_PROGRESS');await p.getByLabel('Tình trạng xe / ghi chú',{exact:true}).fill('SYNTHETIC branch handover check');await p.getByLabel('Đã kiểm tra GPLX và xe phù hợp đến hết chuyến.',{exact:true}).check();
    const form=p.locator('form').filter({has:p.getByLabel('Chuyển trạng thái',{exact:true})});const r=await responseFor(p,bookingPath(id)+'/actions','POST',()=>form.getByRole('button').click());check('Handover HTTP '+id,r.status(),status);return r.json();
  }
  async function receive(p,id,maintenance=false) {
    await detail(p,'staff',id);await p.getByLabel('Tình trạng xe / ghi chú nhận trả',{exact:true}).fill('SYNTHETIC real UI return; maintenance='+maintenance);
    if(maintenance)await p.getByLabel('Xe cần bảo trì sau khi nhận.',{exact:true}).check();
    let r=await responseFor(p,bookingPath(id)+'/return-preview','GET',()=>p.getByRole('button',{name:'Xem trước nhận trả',exact:true}).click());check('Late preview HTTP',r.status(),200);const q=await r.json();check('Late days',q.assessment.lateDays,3);check('Snapshot daily price',q.assessment.dailyPriceVnd,650000);check('Late amount',q.assessment.amountVnd,1950000);check('Late timing',q.assessment.timing,'LATE');
    await shot(p,maintenance?'maintenance-preview':'late-preview',p.getByRole('region',{name:'Dự kiến nhận trả',exact:true}));
    r=await responseFor(p,bookingPath(id)+'/actions','POST',()=>p.getByRole('button',{name:'Xác nhận đã nhận xe',exact:true}).click());check('Return HTTP',r.status(),200);return detail(p,'staff',id);
  }
  async function settle(p,role,id,amount,ref) {
    await detail(p,role,id);const form=p.getByRole('form',{name:'Xử lý công nợ vượt hạn',exact:true});await form.getByLabel('Số tiền (VND)',{exact:true}).fill(String(amount));
    if(role==='staff') {await form.getByLabel('Phương thức thu',{exact:true}).selectOption('CASH');await form.getByLabel('Tham chiếu phiếu thu / giao dịch',{exact:true}).fill(ref);}
    await form.getByLabel('Lý do / ghi chú công nợ',{exact:true}).fill(role==='staff'?'DEMO đối chiếu thu một phần':'DEMO miễn phần còn lại có lý do');await form.getByRole('button',{name:'Kiểm tra ghi nhận',exact:true}).click();
    const dialog=p.getByRole('dialog',{name:'Xác nhận xử lý khoản vượt hạn',exact:true});await dialog.waitFor();await shot(p,role+'-settlement-review',dialog);
    const r=await responseFor(p,bookingPath(id)+'/return-settlements','POST',()=>dialog.getByRole('button',{name:'Xác nhận ghi nhận',exact:true}).click());check(role+' settlement HTTP',r.status(),200);return detail(p,role,id);
  }
  try {
    const user=await login('user@example.test'),staff=await login('staff.dn@example.test'),admin=await login('admin@example.test');
    await user.goto(base+'/user/profile');await user.getByLabel('Số giấy phép',{exact:true}).fill('SYNTHETIC-RETURN-LATE-G5');await user.getByLabel('Hệ giấy phép',{exact:true}).selectOption('VN_2025');await user.getByLabel('Hạng bằng',{exact:true}).selectOption('B');await user.getByLabel('Ngày hết hạn',{exact:true}).fill('2035-12-31');
    let r=await responseFor(user,'/api/v1/me/license','PUT',()=>user.getByRole('button',{name:'Lưu thông tin GPLX',exact:true}).click());check('License declaration UI',r.status(),200);
    const ip=await browser.newPage();await ip.setContent('<h1>GPLX GIẢ LẬP — KHÔNG PHẢI GIẤY TỜ THẬT</h1>');const image=await ip.screenshot();await ip.close();
    for(const label of ['Ảnh mặt trước','Ảnh mặt sau'])await user.getByLabel(label,{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
    r=await responseFor(user,'/api/v1/me/license/photos','PUT',()=>user.getByRole('button',{name:'Lưu hai mặt ảnh GPLX',exact:true}).click());check('License photos UI',r.status(),200);
    await user.goto(base+`/user/bookings/new?vehicleId=v1&start=${day(1)}&end=${day(3)}&pickupBranchId=dn&returnBranchId=dn`);
    r=await responseFor(user,'/api/v1/bookings/quote','POST',()=>user.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click());check('Real policy quote',r.status(),200);const quote=await r.json();check('Policy terms from backend',quote.returnPolicy.terms.dailyPriceVnd,650000);
    const ids={a:randomUUID(),b:randomUUID(),c:randomUUID(),d:randomUUID()};
    function seed(id,vehicle,start,end,status,name) {
      const accepted=stamp(-7),policy={...quote.returnPolicy,acceptedAt:accepted},s=stamp(start),e=stamp(end,true),total=650000*(end-start);
      insert('bookings',{id,user_id:'demo-user',vehicle_id:vehicle,pickup_branch_id:'dn',return_branch_id:'dn',start_at:dbStamp(s),end_at:dbStamp(e),created_at:dbStamp(accepted),expires_at:dbStamp(accepted),status,daily_price:650000,rental_days:end-start,rental_total:total,one_way_fee:0,total,customer_name:'SYNTHETIC G5',vehicle_name:name,pickup_name:'Đà Nẵng',return_name:'Đà Nẵng',policy_version:'calendar-2026-10-17',version:2,return_policy_version:policy.version,return_policy_snapshot:JSON.stringify(policy.terms),return_policy_accepted_at:dbStamp(accepted)});
      insert('contracts',{id:randomUUID(),booking_id:id,issued_at:dbStamp(accepted),snapshot:JSON.stringify({customer:'SYNTHETIC G5',vehicle:name,pickup:'Đà Nẵng',return:'Đà Nẵng',startAt:s,endAt:e,rentalTotal:total,oneWayFee:0,total,rentalDays:end-start,policyVersion:'calendar-2026-10-17',returnPolicy:policy,terms:'SYNTHETIC dated fixture contract'}),terms_version:'terms-2026-09-28'});
      const history=[[null,'PENDING',accepted],['PENDING','CONFIRMED',accepted]];
      if(status==='IN_PROGRESS') {insert('vehicle_handover_records',{id:randomUUID(),booking_id:id,kind:'HANDOVER',actor_id:'demo-staff-dn',branch_id:'dn',occurred_at:dbStamp(s),condition_note:'SYNTHETIC dated HANDOVER fixture, not real UI handover',maintenance:0});history.push(['CONFIRMED','IN_PROGRESS',s]);}
      for(const [previous,next,time] of history)insert('booking_status_history',{id:randomUUID(),booking_id:id,previous_status:previous,next_status:next,actor_id:'demo-staff-dn',occurred_at:dbStamp(time),reason:'SYNTHETIC dated setup'});
    }
    seed(ids.a,'v1',-5,-3,'IN_PROGRESS','G5 A trả muộn');seed(ids.b,'v1',0,2,'CONFIRMED','G5 B chờ xe');seed(ids.c,'v3',-5,-3,'IN_PROGRESS','G5 C cần bảo trì');seed(ids.d,'v3',0,2,'CONFIRMED','G5 D chờ xe bảo trì');
    fs.writeFileSync(path.join(out,'fixture-boundaries.json'),JSON.stringify({ids,today,setup:'SQL dated bookings/contracts/HANDOVER; terms from real quote; no deposit requirement. UI return/settlement/completion and B handover only.'},null,2));
    const originals=sql('SELECT id,total,start_at,end_at,return_policy_snapshot,return_policy_accepted_at,deposit_required,deposit_amount FROM bookings ORDER BY id'),contracts=sql('SELECT booking_id,snapshot FROM contracts ORDER BY booking_id');
    sql("UPDATE vehicles SET daily_price=990000 WHERE id IN ('v1','v3')");
    await detail(staff,'staff',ids.b);const photos=staff.getByRole('region',{name:'Ảnh GPLX',exact:true});await photos.getByLabel('Kết quả kiểm tra',{exact:true}).selectOption('APPROVED');await photos.getByLabel('Nhận xét kiểm tra',{exact:true}).fill('SYNTHETIC photos only');r=await responseFor(staff,bookingPath(ids.b)+'/license-photo-review','POST',()=>photos.getByRole('button',{name:'Lưu kiểm tra hồ sơ',exact:true}).click());check('Staff photo approval UI',r.status(),200);
    const a=await detail(staff,'staff',ids.a);check('A overdue warning',a.scheduleWarnings.items.some(i=>i.kind==='OVERDUE'),true);const b=await detail(staff,'staff',ids.b);check('B warning links A',b.scheduleWarnings.items.some(i=>i.kind==='PREDECESSOR_NOT_RETURNED'&&i.relatedBookingId===ids.a),true);await shot(staff,'B-before-return',staff.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}));
    const denied=await handover(staff,ids.b,409);check('A active reason',JSON.stringify(denied).includes('Xe còn đang được thuê'),true);check('No handover for B',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${ids.b}'`),'0');
    const u=await detail(user,'user',ids.a);check('USER no internal warning field',Object.hasOwn(u,'scheduleWarnings'),false);check('USER no return form',await user.getByRole('form',{name:'Ghi nhận trả xe',exact:true}).count(),0);
    await detail(admin,'admin',ids.a);check('Admin no staff actions',await admin.getByLabel('Chuyển trạng thái',{exact:true}).count(),0);
    const wrong=await login('staff.hn@example.test');r=await responseFor(wrong,bookingPath(ids.a),'GET',()=>wrong.goto(base+'/staff/bookings/'+ids.a));check('Wrong branch404',r.status(),404);
    await user.goto(base+`/user/bookings/new?vehicleId=v1&start=${day(4)}&end=${day(5)}&pickupBranchId=dn&returnBranchId=dn`);r=await responseFor(user,'/api/v1/bookings/quote','POST',()=>user.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click());check('Overdue protects far future quote',r.status(),409);
    const returned=await receive(staff,ids.a);check('A returned',returned.status,'RETURNED');check('A unpaid',returned.returnSettlement.outstandingAmount,1950000);check('A amount uses saved price',returned.returnAssessment.dailyPriceVnd,650000);check('No complete action with debt',await staff.getByLabel('Chuyển trạng thái',{exact:true}).count(),0);check('No invoice while unpaid',sql(`SELECT COUNT(*) FROM invoices WHERE booking_id='${ids.a}'`),'0');
    // Over-collection is blocked by real input constraints before send; server rejection covered natively.
    const debt=staff.getByRole('form',{name:'Xử lý công nợ vượt hạn',exact:true});await debt.getByLabel('Số tiền (VND)',{exact:true}).fill('1950001');check('Overamount invalid UI',await debt.getByLabel('Số tiền (VND)',{exact:true}).evaluate(e=>e.checkValidity()),false);check('No ledger before confirmation',sql(`SELECT COUNT(*) FROM booking_return_settlements WHERE booking_id='${ids.a}'`),'0');
    const bReady=await detail(staff,'staff',ids.b);check('B warning clears after A returns',bReady.scheduleWarnings.items,[]);
    await detail(admin,'admin',ids.b);check('Admin B warning gone',await admin.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).count(),0);
    const part=await settle(staff,'staff',ids.a,1500000,'G5-LATE-RECEIPT');check('Partial received',part.returnSettlement.receivedAmount,1500000);check('Partial outstanding',part.returnSettlement.outstandingAmount,450000);check('Partial status',part.returnSettlement.status,'PARTIAL');check('Partial cannot complete UI',await staff.getByLabel('Chuyển trạng thái',{exact:true}).count(),0);check('Still no invoice',sql(`SELECT COUNT(*) FROM invoices WHERE booking_id='${ids.a}'`),'0');
    const userPartial=await detail(user,'user',ids.a);check('USER reads balance',userPartial.returnSettlement.outstandingAmount,450000);check('USER no settlement form',await user.getByRole('form',{name:'Xử lý công nợ vượt hạn',exact:true}).count(),0);await shot(user,'user-partial',user.getByRole('region',{name:'Xử lý khoản vượt hạn',exact:true}));
    const waived=await settle(admin,'admin',ids.a,450000);check('Waiver amount',waived.returnSettlement.waivedAmount,450000);check('Final balance',waived.returnSettlement.outstandingAmount,0);check('Combined settled not all cash',waived.returnSettlement.status,'SETTLED');check('DEMO explicit',waived.returnSettlement.demo,true);check('Admin still no complete',await admin.getByLabel('Chuyển trạng thái',{exact:true}).count(),0);
    await detail(staff,'staff',ids.a);await staff.getByLabel('Chuyển trạng thái',{exact:true}).selectOption('COMPLETED');r=await responseFor(staff,bookingPath(ids.a)+'/actions','POST',()=>staff.locator('form').filter({has:staff.getByLabel('Chuyển trạng thái',{exact:true})}).getByRole('button').click());check('Staff completes settled A',r.status(),200);
    const final=await detail(user,'user',ids.a);check('USER reads completed',final.status,'COMPLETED');check('Ledger entries2',final.returnSettlement.entries.length,2);check('Audit actors and kinds',final.returnSettlement.entries.map(e=>[e.kind,e.actorId]).sort(),[['RECEIPT','demo-staff-dn'],['WAIVER','demo-admin']]);
    await user.getByRole('link',{name:'Hóa đơn',exact:true}).click();await user.getByRole('heading',{name:'Hóa đơn thuê xe',exact:true}).waitFor();await user.getByRole('region',{name:'Xử lý khoản vượt hạn',exact:true}).waitFor();await shot(user,'user-late-invoice',user.getByRole('region',{name:'Xử lý khoản vượt hạn',exact:true}));
    check('Invoice2800000',sql(`SELECT total FROM invoices WHERE booking_id='${ids.a}'`),'2800000');check('One invoice',sql(`SELECT COUNT(*) FROM invoices WHERE booking_id='${ids.a}'`),'1');check('One RETURN',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${ids.a}' AND kind='RETURN'`),'1');
    const inv=JSON.parse(sql(`SELECT snapshot FROM invoices WHERE booking_id='${ids.a}'`));check('Invoice saved fee',inv.returnAssessment.amountVnd,1950000);check('Invoice saved waiver',inv.returnSettlement.waivedAmount,450000);check('Invoice saved received',inv.returnSettlement.receivedAmount,1500000);
    await handover(staff,ids.b,200);check('B starts only after actual return',sql(`SELECT status FROM bookings WHERE id='${ids.b}'`),'IN_PROGRESS');check('Only one active on v1',sql("SELECT COUNT(*) FROM bookings WHERE vehicle_id='v1' AND status='IN_PROGRESS'"),'1');
    await receive(staff,ids.c,true);check('Vehicle maintenance persisted',sql("SELECT status FROM vehicles WHERE id='v3'"),'MAINTENANCE');const d=await detail(staff,'staff',ids.d);check('Return removes predecessor warning even maintenance',d.scheduleWarnings.items,[]);const blocked=await handover(staff,ids.d,409);check('Maintenance not-ready reason',JSON.stringify(blocked).includes('Xe không sẵn sàng'),true);check('D still confirmed',sql(`SELECT status FROM bookings WHERE id='${ids.d}'`),'CONFIRMED');await shot(staff,'maintenance-still-blocked');
    check('All booking prices/dates/policy/deposit unchanged',sql('SELECT id,total,start_at,end_at,return_policy_snapshot,return_policy_accepted_at,deposit_required,deposit_amount FROM bookings ORDER BY id'),originals);check('All contracts immutable',sql('SELECT booking_id,snapshot FROM contracts ORDER BY booking_id'),contracts);check('No payment or refund mutation',sql('SELECT (SELECT COUNT(*) FROM payment_transactions)+(SELECT COUNT(*) FROM payment_refunds)'),'0');check('C unpaid not completed',sql(`SELECT status FROM bookings WHERE id='${ids.c}'`),'RETURNED');check('No C invoice',sql(`SELECT COUNT(*) FROM invoices WHERE booking_id='${ids.c}'`),'0');
    check('No JS errors',errors,[]);check('Same VN date at end',sql('SELECT DATE(UTC_TIMESTAMP()+INTERVAL 7 HOUR)'),today);fs.writeFileSync(path.join(out,'console-health.json'),JSON.stringify({errors,consoleErrors,expected:'409 business refusals and404 wrongbranch only'},null,2));
  } catch(e) {for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:path.join(out,'failure-'+i+'.png'),fullPage:false}).catch(()=>{});throw e;}
  finally {await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
