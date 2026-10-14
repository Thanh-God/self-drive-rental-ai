// Real desktop UI, API and independent MySQL readback; no SQL lifecycle bypasses.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require(process.env.C11_PLAYWRIGHT),out=process.env.C11_EVIDENCE;
const base='http://127.0.0.1:5300',api='http://127.0.0.1:8300/api/v1',checks=[];
const f=JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE,'fixture.json'),'utf8'));
const config=fs.readFileSync(path.join(out,'application.private.properties'),'utf8');
const password=config.match(/^spring.datasource.password=(.*)$/m)[1],schema=config.match(/jdbc:mysql:\/\/[^/]+\/([^?]+)/)[1];
assert.equal(f.port,33676);assert.match(f.name,/^kltn-c14-core-/);assert.match(schema,/^kdrive_c14_browser_[a-f0-9]+$/);
assert.equal(cp.execFileSync('docker',['inspect','--format','{{.Id}}',f.name],{encoding:'utf8',windowsHide:true}).trim(),f.id);
function check(name,actual,expected){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));}
function sql(q){try{return cp.execFileSync('docker',['exec','-e','MYSQL_PWD='+password,f.name,'mysql','-uroot','--default-character-set=utf8mb4','--batch','--raw','-N',schema,'-e',q],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();}catch{throw Error('Fixture SQL failed; private arguments omitted');}}
function snapshot(){return sql('SELECT id,status,version,total FROM bookings ORDER BY id;SELECT * FROM booking_status_history ORDER BY id;SELECT * FROM contracts ORDER BY id;SELECT * FROM invoices ORDER BY id;SELECT * FROM reviews ORDER BY id;SELECT * FROM incident_cases ORDER BY id;SELECT * FROM incident_events ORDER BY id;');}
async function req(t,url,method='GET',body){const r=await fetch(api+url,{method,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};}
async function token(email){const r=await req(null,'/auth/login','POST',{email,password:'BranchBookingTestOnly123!'});assert.equal(r.status,200);return r.body.token;}
const viInput=t=>new Date(t+7*3600000).toISOString().slice(0,16);
async function main(){
 const admin=await token('admin@example.test'),user=await token('user@example.test'),dn=await token('staff.dn@example.test'),hn=await token('staff.hn@example.test');
 check('Real MySQL version',sql('SELECT VERSION()').startsWith('8.4.'),true);
 check('License ready',(await req(user,'/me/license','PUT',{licenseNumber:'C14-FIXTURE-123',scheme:'VN_2025',licenseClass:'B',expiresOn:'2030-12-31',automaticOnly:false,version:0})).status,200);
 const outsider=(await req(null,'/auth/register','POST',{email:'c14-other@example.test',password:'C14FixtureOnly!',fullName:'Fixture outsider'}));check('Second user registered',outsider.status,201);
 const other=outsider.body.token;const browser=await chromium.launch({headless:true}),errors=[],ids=[];
 async function page(t){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(jwt=>localStorage.setItem('kdrive.jwt',jwt),t);const p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));return p;}
 const customer=await page(user),staffDn=await page(dn),staffHn=await page(hn),manager=await page(admin);
 async function action(p,t,id,next){await p.goto(base+'/staff/bookings/'+id);await p.getByLabel('Chuyển trạng thái',{exact:true}).selectOption(next);if(['IN_PROGRESS','RETURNED'].includes(next))await p.getByLabel('Tình trạng xe / ghi chú',{exact:true}).fill('C14 fixture vehicle checked');if(next==='IN_PROGRESS')await p.getByRole('checkbox',{name:'Đã kiểm tra GPLX và xe phù hợp đến hết chuyến.',exact:true}).check();const response=p.waitForResponse(r=>r.url().endsWith('/bookings/'+id+'/actions'));await p.getByRole('button',{name:'Cập nhật đơn',exact:true}).click();check(id+' browser '+next,(await response).status(),200);check(id+' SQL '+next,sql(`SELECT status FROM bookings WHERE id='${id}'`),next);}
 try{
  for(const flow of [{vehicle:'v1',drop:'dn',hours:24,total:650000,days:1,fee:0},{vehicle:'v3',drop:'hn',hours:25,total:2700000,days:2,fee:1500000}]){
   const start=Math.ceil((Date.now()+30000)/60000)*60000,end=start+flow.hours*3600000;
   await customer.goto(base+'/user/bookings/new?vehicleId='+flow.vehicle);
   await customer.getByLabel('Thời gian nhận (giờ Việt Nam)',{exact:true}).fill(viInput(start));
   await customer.getByLabel('Thời gian trả (giờ Việt Nam)',{exact:true}).fill(viInput(end));
   await customer.getByLabel('Chi nhánh nhận xe',{exact:true}).selectOption('dn');
   await customer.getByLabel('Chi nhánh trả xe',{exact:true}).selectOption(flow.drop);
   const quoteResponse=customer.waitForResponse(r=>r.url().endsWith('/bookings/quote'));
   await customer.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();const qr=await quoteResponse;check(flow.vehicle+' browser quote HTTP',qr.status(),200);const q=await qr.json();
   check(flow.vehicle+' independent golden total',q.total,flow.total);check(flow.vehicle+' 24h block rounding',q.rentalDays,flow.days);check(flow.vehicle+' route fee',q.oneWayFee,flow.fee);
   const createResponse=customer.waitForResponse(r=>r.url().endsWith('/bookings')&&r.request().method()==='POST');
   await customer.getByRole('checkbox',{name:'Tôi xác nhận thời gian, chi nhánh và tổng báo giá.',exact:true}).check();await customer.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true}).click();const cr=await createResponse;check(flow.vehicle+' browser creates real booking',cr.status(),201);const b=await cr.json(),id=b.id;ids.push(id);
   fs.writeFileSync(path.join(out,'workflow-ids.json'),JSON.stringify(ids));
   check(id+' persisted snapshot total',sql(`SELECT total FROM bookings WHERE id='${id}'`),String(flow.total));check(id+' no invoice before completion',sql(`SELECT COUNT(*) FROM invoices WHERE booking_id='${id}'`),'0');
   const before=snapshot();check('Guest cannot read booking',(await req(null,'/bookings/'+id)).status,401);check('Non-owner cannot read booking',(await req(other,'/bookings/'+id)).status,404);
   for(const [name,t] of [['USER',user],['ADMIN',admin],['wrong branch STAFF',hn]])check(name+' cannot confirm '+id,(await req(t,'/bookings/'+id+'/actions','POST',{next:'CONFIRMED',version:0})).status,403);
   check('Forbidden requests leave data unchanged',snapshot(),before);
   await action(staffDn,dn,id,'CONFIRMED');const contract=sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`);
   const noChange=snapshot();check('Stale transition rejected',(await req(dn,'/bookings/'+id+'/actions','POST',{next:'IN_PROGRESS',version:0,licenseChecked:true,condition:'stale'})).status,409);check('Stale transition no write',snapshot(),noChange);
   if(Date.now()<start+1000)await staffDn.waitForTimeout(start+1000-Date.now());
   await action(staffDn,dn,id,'IN_PROGRESS');await action(flow.drop==='dn'?staffDn:staffHn,flow.drop==='dn'?dn:hn,id,'RETURNED');await action(flow.drop==='dn'?staffDn:staffHn,flow.drop==='dn'?dn:hn,id,'COMPLETED');
   check(id+' actual return location',sql(`SELECT actual_return_branch_id FROM bookings WHERE id='${id}'`),flow.drop);check(id+' car location after return',sql(`SELECT current_branch_id FROM vehicles WHERE id='${flow.vehicle}'`),flow.drop);
   check(id+' five history rows',sql(`SELECT COUNT(*) FROM booking_status_history WHERE booking_id='${id}'`),'5');check(id+' two handover rows',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${id}'`),'2');check(id+' invoice total',sql(`SELECT total FROM invoices WHERE booking_id='${id}'`),String(flow.total));check(id+' stable contract',sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`),contract);
   await customer.goto(base+'/user/bookings/'+id);await customer.getByLabel('Nội dung',{exact:true}).fill('C14 chuyến thuê đã hoàn tất');const reviewed=customer.waitForResponse(r=>r.url().endsWith('/reviews')&&r.request().method()==='POST');await customer.getByRole('button',{name:'Gửi đánh giá',exact:true}).click();check(id+' browser review',(await reviewed).status(),200);
   const reviewBefore=snapshot();check('Duplicate review rejected',(await req(user,'/reviews','POST',{bookingId:id,rating:5,content:'again'})).status,409);check('Non-owner review rejected',(await req(other,'/reviews','POST',{bookingId:id,rating:5,content:'outside'})).status,404);check('Review negatives no writes',snapshot(),reviewBefore);
   const review=(await req(admin,'/admin/reviews')).body.find(r=>r.booking_id===id);check('Admin hides actual review',(await req(admin,'/admin/reviews/'+review.id,'PATCH',{hidden:true,version:review.version})).status,200);check('Public hides moderated review',(await req(null,'/vehicles/'+flow.vehicle+'/reviews')).body.length,0);check('Admin restores actual review',(await req(admin,'/admin/reviews/'+review.id,'PATCH',{hidden:false,version:review.version+1})).status,200);check('Public restores review',(await req(null,'/vehicles/'+flow.vehicle+'/reviews')).body.length,1);
   // Use actual recorded handover time, not planned start or an edited DB timestamp.
   const custody=sql(`SELECT DATE_FORMAT(occurred_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM vehicle_handover_records WHERE booking_id='${id}' AND kind='HANDOVER'`);
   const incident={bookingId:id,kind:'VIOLATION',occurredAt:custody,description:'C14 báo sau trả xe',evidenceReference:'C14-fixture-only',blockVehicle:false};
   const beforeIncident=snapshot();check('Outside custody incident rejected',(await req(user,'/incidents','POST',{...incident,occurredAt:new Date(start-60000).toISOString()})).status,400);check('Invalid incident no writes',snapshot(),beforeIncident);
   const ir=await req(user,'/incidents','POST',incident);check('Late actual-custody incident accepted',ir.status,200);let c=ir.body;
   const update=async(t,next,values={})=>{const r=await req(t,'/incidents/'+c.id+'/actions','POST',{next,version:c.version,note:'C14 căn cứ fixture',assessedDamage:1000,thirdPartyCoverage:200,requestedAmount:800,responsibilityBasis:'C14 hồ sơ đối chiếu',...values});check('Incident '+next,r.status,200);c=r.body;};
   await update(flow.drop==='dn'?dn:hn,'ASSESSED');await update(admin,'CLAIMED');await update(user,'DISPUTED');await update(flow.drop==='dn'?dn:hn,'ASSESSED',{requestedAmount:700});await update(admin,'CLOSED');
   check('Incident full audit six events',sql(`SELECT COUNT(*) FROM incident_events WHERE case_id='${c.id}'`),'6');check('Incident never changes invoice',sql(`SELECT total FROM invoices WHERE booking_id='${id}'`),String(flow.total));
   const invoice=sql(`SELECT snapshot FROM invoices WHERE booking_id='${id}'`);sql(`UPDATE vehicles SET name='C14 catalog renamed',daily_price=999999 WHERE id='${flow.vehicle}'`);
   check('Catalog edits preserve invoice',sql(`SELECT snapshot FROM invoices WHERE booking_id='${id}'`),invoice);check('Catalog edits preserve contract',sql(`SELECT snapshot FROM contracts WHERE booking_id='${id}'`),contract);
   await customer.reload();await customer.getByText('C14 chuyến thuê đã hoàn tất',{exact:true}).waitFor();await customer.screenshot({path:path.join(out,flow.vehicle+'-completed.png'),fullPage:true});
  }
  const from=new Date(Date.now()+7*3600000).toISOString().slice(0,10);await manager.goto(base+'/admin');await manager.getByTestId('report-metrics').waitFor();
  await manager.getByLabel('Từ ngày',{exact:true}).fill(from);await manager.getByLabel('Đến ngày',{exact:true}).fill(from);await manager.getByRole('button',{name:'Xem báo cáo',exact:true}).click();await manager.waitForFunction(()=>document.querySelector('[data-metric="Đơn tạo trong khoảng"]')?.innerText==='2');
  const rb=snapshot(),report=await req(admin,'/admin/reports/operations?from='+from+'&to='+from);check('Linked report HTTP',report.status,200);check('Linked report created',report.body.createdBookings.total,2);check('Linked report completed',report.body.completedBookings,2);check('Linked report invoices',report.body.issuedInvoices,2);check('Linked report exact VND',report.body.invoiceTotalVnd,'3350000');check('SQL linked totals',sql('SELECT COUNT(*),SUM(total) FROM invoices'),'2\t3350000');
  for(const label of ['Đơn tạo trong khoảng','Đơn hoàn tất trong khoảng','Hóa đơn phát hành'])check('UI '+label,await manager.locator('[data-metric="'+label+'"]').innerText(),'2');check('UI total exact VND',(await manager.locator('[data-metric="Tổng giá trị hóa đơn"]').innerText()).includes('3.350.000'),true);
  check('Report is read only',snapshot(),rb);check('Invoice not payment claim',(await manager.locator('main').innerText()).includes('không xác nhận tiền đã thanh toán'),true);
  await manager.screenshot({path:path.join(out,'linked-report.png'),fullPage:true});await manager.getByLabel('Từ ngày',{exact:true}).fill('2026-09-01');await manager.getByLabel('Đến ngày',{exact:true}).fill('2026-09-01');await manager.getByRole('button',{name:'Xem báo cáo',exact:true}).click();await manager.getByText('Chưa có dữ liệu trong khoảng đã chọn.',{exact:true}).waitFor();check('Empty range honest zero',await manager.locator('[data-metric="Đơn tạo trong khoảng"]').innerText(),'0');
  await manager.route('**/api/v1/admin/reports/operations?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'C14 controlled unavailable'})}));
  await manager.getByRole('button',{name:'Làm mới',exact:true}).click();await manager.getByRole('button',{name:'Thử tải lại',exact:true}).waitFor();check('Report error removes stale metrics',await manager.getByTestId('report-metrics').count(),0);
  await manager.unroute('**/api/v1/admin/reports/operations?*');await manager.getByRole('button',{name:'Thử tải lại',exact:true}).click();await manager.getByTestId('report-metrics').waitFor();check('Report retry recovers actual empty range',await manager.locator('[data-metric="Đơn tạo trong khoảng"]').innerText(),'0');
  check('Runtime errors',errors,[]);check('Business schema plus history',sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${schema}'`),'26');check('FK count',sql(`SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='${schema}'`),'37');
  fs.writeFileSync(path.join(out,'sql-final.txt'),snapshot());fs.writeFileSync(path.join(out,'report-api.json'),JSON.stringify(report.body,null,2));console.log('PASS C14 browser '+checks.length+' assertions');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
