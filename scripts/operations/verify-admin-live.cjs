// Real API + isolated MySQL + desktop Chromium; only explicit GET failure injection.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium}=require(process.env.C11_PLAYWRIGHT),out=process.env.C11_EVIDENCE;
const base='http://127.0.0.1:5300',api='http://127.0.0.1:8300/api/v1',checks=[],errors=[],consoleErrors=[],network=[];
const fixture=JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE,'fixture.json')));
const config=fs.readFileSync(path.join(out,'application.private.properties'),'utf8');
const password=config.match(/^spring.datasource.password=(.*)$/m)[1],schema=config.match(/jdbc:mysql:\/\/[^/]+\/([^?]+)/)[1];
assert.equal(fixture.port,33676);assert.match(schema,/^kdrive_c14_browser_[a-f0-9]+$/);
function check(name,actual,expected=true){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));}
function sql(q){try{return cp.execFileSync('docker',['exec','-e','MYSQL_PWD='+password,fixture.name,'mysql','-uroot','--batch','--raw','-N',schema,'-e',q],{encoding:'utf8',windowsHide:true,timeout:15000}).trim();}catch{throw Error('Fixture SQL failed; private arguments withheld');}}
async function req(t,url,method='GET',body){const r=await fetch(api+url,{method,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};}
async function token(email){const r=await req(null,'/auth/login','POST',{email,password:'BranchBookingTestOnly123!'});assert.equal(r.status,200);return r.body.token;}
const day=offset=>new Date(Date.now()+7*3600000+offset*86400000).toISOString().slice(0,10);
async function main(){
 const admin=await token('admin@example.test'),user=await token('user@example.test'),staff=await token('staff.dn@example.test');
 check('License prerequisite',(await req(user,'/me/license','PUT',{licenseNumber:'ADMIN-LIVE-ONLY',scheme:'VN_2025',licenseClass:'B',expiresOn:'2030-12-31',automaticOnly:false,version:0})).status,200);
 check('MySQL fixture identity',cp.execFileSync('docker',['inspect','--format','{{.Id}}',fixture.name],{encoding:'utf8',windowsHide:true}).trim(),fixture.id);
 if(!(await req(admin,'/vehicles/catalog')).body.amenities.length)assert.equal((await req(admin,'/admin/amenities','POST',{name:'ADM fixture Bluetooth'})).status,201);
 const catalog=(await req(admin,'/vehicles/catalog')).body;
 const branches=(await req(admin,'/branches')).body;
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(jwt=>localStorage.setItem('kdrive.jwt',jwt),admin);
 const p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});p.on('response',r=>{if(r.url().includes('/api/v1/'))network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()});});
 async function responseClick(label,suffix,method='PUT'){const pending=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith(suffix)&&r.request().method()===method);await p.getByRole('button',{name:label,exact:true}).click();return pending;}
 try{
  await p.goto(base+'/admin/vehicles');await p.getByLabel('Tên xe',{exact:true}).fill('ADM UI Vehicle');await p.getByLabel('Biển số',{exact:true}).fill('ADM-UI-001');await p.getByLabel('Giá/ngày (VND)',{exact:true}).fill('600000');
  const createdResponse=await responseClick('Tạo xe','/admin/vehicles','POST');check('UI creates actual vehicle',createdResponse.status(),200);const created=await createdResponse.json();
  await p.getByRole('tab',{name:'Hình ảnh',exact:true}).waitFor();await p.getByLabel('URL ảnh xe',{exact:true}).fill('https://example.org/admin-fixture.jpg');await p.getByLabel('Tác giả / nguồn / giấy phép',{exact:true}).fill('Synthetic fixture reference; not production media');
  check('UI image save',(await responseClick('Thêm ảnh xe','/images','POST')).status(),201);
  await p.getByRole('tab',{name:'Tiện nghi',exact:true}).click();
  const am=p.getByRole('form',{name:'Tiện nghi xe'});const boxes=am.getByRole('checkbox');if(await boxes.count()){await boxes.first().check();check('UI amenity save',(await responseClick('Lưu tiện nghi','/amenities')).status(),200);}
  await p.getByRole('tab',{name:'Thông tin xe',exact:true}).click();
  await p.getByLabel('Mô tả',{exact:true}).fill('Unsaved tab draft');await p.getByRole('tab',{name:'Hình ảnh',exact:true}).click();await p.getByRole('tab',{name:'Thông tin xe',exact:true}).click();check('Tab navigation preserves draft',await p.getByLabel('Mô tả',{exact:true}).inputValue(),'Unsaved tab draft');
  const versions=[];
  for(let i=0;i<2;i++){await p.getByLabel('Mô tả',{exact:true}).fill('UI save '+i);const r=await responseClick('Lưu thay đổi','/admin/vehicles/'+created.id);check('F01 save '+i,r.status(),200);versions.push((await r.json()).version);await p.getByRole('button',{name:'Lưu thay đổi',exact:true}).waitFor();}
  check('F01 version increments',versions[1],versions[0]+1);check('F01 SQL persisted version',sql(`SELECT version FROM vehicles WHERE id='${created.id}'`),String(versions[1]));
  const ids=[],bookings=[];
  for(let i=0;i<45;i++){
   const r=await req(admin,'/admin/vehicles','POST',{name:'ADM Car '+String(i).padStart(2,'0'),plate:'ADM-'+String(i).padStart(3,'0'),brandId:catalog.brands[0].id,categoryId:catalog.categories[0].id,homeBranchId:'dn',currentBranchId:'dn',seats:5,transmission:'AUTO',dailyPrice:500000,status:'ACTIVE',description:'Isolated admin fixture',version:0});assert.equal(r.status,200);ids.push(r.body.id);
   const input={vehicleId:r.body.id,pickupBranchId:'dn',returnBranchId:'dn',pickupDate:day(i===0?0:1),returnDate:day(i===0?1:2)};
   const q=await req(user,'/bookings/quote','POST',input);assert.equal(q.status,200,JSON.stringify(q.body));const b=await req(user,'/bookings','POST',{...input,expectedTotal:q.body.total});assert.equal(b.status,201);bookings.push(b.body);
  }
  check('Real fixture bookings',sql('SELECT COUNT(*) FROM bookings'),'45');
  let b=bookings[0];for(const next of ['CONFIRMED','IN_PROGRESS','RETURNED','COMPLETED']){const r=await req(staff,'/bookings/'+b.id+'/actions','POST',{next,version:b.version,condition:'Real fixture custody check',licenseChecked:true,maintenance:false});assert.equal(r.status,200);b=r.body;}
  await p.goto(base+'/admin/bookings');await p.getByText('Trang 1 / 3',{exact:false}).waitFor();check('Booking first page size',await p.locator('article').count(),20);await p.getByRole('button',{name:'Trang sau',exact:true}).click();check('Booking second page size',await p.locator('article').count(),20);
  await p.getByRole('button',{name:'Trang sau',exact:true}).click();check('Booking last page size',await p.locator('article').count(),5);await p.getByLabel('Sắp xếp',{exact:true}).selectOption('createdAt_asc');check('Sort resets first page',await p.locator('article').count(),20);check('Oldest actual booking first',await p.locator('article').first().locator('span[title]').getAttribute('title'),b.id);
  await p.getByLabel('Tìm mã đơn, xe hoặc khách hàng',{exact:true}).fill(b.id);await p.waitForFunction(()=>document.querySelectorAll('article').length===1);check('UUID search before paging',await p.locator('article').count(),1);
  await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testCopiedId=text;}}}));await p.getByRole('button',{name:'Sao chép mã đơn '+b.id,exact:true}).click();check('F04 full UUID copy success',await p.evaluate(()=>window.testCopiedId),b.id);
  await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Injected clipboard denial');}}}));await p.getByRole('button',{name:'Sao chép mã đơn '+b.id,exact:true}).click();
  const full=p.getByLabel('Mã đầy đủ đơn '+b.id,{exact:true});await full.waitFor({state:'visible'});check('F04 manual full UUID',await full.inputValue(),b.id);check('F04 readonly',await full.getAttribute('readonly')!==null);
  await p.getByRole('link',{name:'Chi tiết',exact:true}).click();await p.getByRole('heading',{name:'Thông tin thuê',exact:true}).waitFor();
  const date=day(0).split('-').reverse().join('/');check('F03 detail calendar VN date',(await p.locator('body').innerText()).includes(date));await p.getByText('Lịch sử trạng thái',{exact:true}).click();check('F03 history dd/mm/yyyy',/\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}/.test(await p.locator('.booking-history').innerText()));
  check('F03 SQL actual custody records',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${b.id}'`),'2');
  await p.screenshot({path:path.join(out,'admin-detail-1440.png'),fullPage:true});
  const before=sql('SELECT id,status,version FROM bookings ORDER BY id');check('USER cannot edit Admin vehicle',(await req(user,'/admin/vehicles/'+created.id,'PUT',created)).status,403);check('Guest cannot read Admin accounts',(await req(null,'/admin/accounts')).status,401);check('Forbidden requests preserve bookings',sql('SELECT id,status,version FROM bookings ORDER BY id'),before);
  for(const width of [1440,1280]){
   await p.setViewportSize({width,height:1000});await p.goto(base+'/admin/vehicles');await p.getByLabel('Tìm kiếm xe',{exact:true}).waitFor();check('Vehicle paging '+width,await p.locator('article').count(),20);
   await p.getByLabel('Tìm kiếm xe',{exact:true}).fill('adm-ui-001');await p.getByText('Hiển thị 1/1 xe',{exact:false}).waitFor();check('Plate insensitive search '+width,await p.locator('article').count(),1);
   if(width===1440){await p.getByLabel('Tìm kiếm xe',{exact:true}).fill('ADM-000');await p.getByRole('heading',{name:'ADM Car 00',exact:true}).waitFor();p.once('dialog',d=>d.accept());check('Referenced vehicle delete rejected',(await responseClick('Xóa xe','/admin/vehicles/'+ids[0],'DELETE')).status(),409);check('Rejected delete retains vehicle',await p.locator('article').count(),1);await p.getByLabel('Tìm kiếm xe',{exact:true}).fill('adm-ui-001');await p.getByRole('heading',{name:'ADM UI Vehicle',exact:true}).waitFor();}
   check('Desktop no horizontal overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'admin-vehicles-'+width+'.png'),fullPage:true});
   await p.goto(base+'/admin/branches');const edit=p.getByRole('button',{name:'Chỉnh sửa tuyến '+branches.find(x=>x.id==='dn').name+' đến '+branches.find(x=>x.id==='hn').name,exact:true});await edit.click();
   const routes=(await req(admin,'/branch-routes')).body;const route=routes.find(x=>x.pickupBranchId==='dn'&&x.returnBranchId==='hn'),reverse=routes.find(x=>x.pickupBranchId==='hn'&&x.returnBranchId==='dn');
   const form=p.locator('form').filter({has:p.getByRole('heading',{name:'Cấu hình tuyến',exact:true})});await form.getByRole('spinbutton').fill(String(route.fee+1));
   assert.equal((await req(admin,'/admin/branch-routes','PUT',{...route,fee:route.fee+2,expectedVersion:route.version})).status,200);
   check('F02 real concurrent409 '+width,(await responseClick('Lưu tuyến','/admin/branch-routes')).status(),409);
   await p.route('**/api/v1/branch-routes',r=>width===1440?r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Injected read failure'})}):r.abort('connectionfailed'),{times:1});
   await p.getByRole('button',{name:'Tải lại dữ liệu tuyến',exact:true}).click();await p.getByRole('button',{name:'Thử tải lại',exact:true}).waitFor();await p.getByRole('button',{name:'Thử tải lại',exact:true}).click();
   await p.waitForFunction(expected=>document.querySelector('form input[type="number"]')?.value===String(expected),route.fee+2);check('F02 retry fresh fee '+width,await form.getByRole('spinbutton').inputValue(),String(route.fee+2));
   check('F02 save after recovery '+width,(await responseClick('Lưu tuyến','/admin/branch-routes')).status(),200);
   const after=(await req(admin,'/branch-routes')).body;check('Reverse route unchanged '+width,after.find(x=>x.pickupBranchId==='hn'&&x.returnBranchId==='dn'),reverse);await p.screenshot({path:path.join(out,'admin-routes-'+width+'.png'),fullPage:true});
  }
  for(const [role,t,url] of [['USER',user,'/user/bookings'],['STAFF',staff,'/staff/fleet']]){const c=await browser.newContext();await c.addInitScript(jwt=>localStorage.setItem('kdrive.jwt',jwt),t);const page=await c.newPage();await page.goto(base+url);await page.getByRole('heading',{name:role==='USER'?'Đơn thuê của tôi':'Tình trạng đội xe',exact:true}).waitFor();check(role+' no vehicle create control',await page.getByRole('button',{name:'Tạo xe',exact:true}).count(),0);await c.close();}
  check('No page errors',errors,[]);check('Only deliberate HTTP/network errors in console',consoleErrors.filter(x=>!/(409|500|net::ERR_CONNECTION_FAILED|net::ERR_FAILED)/.test(x)),[]);
 }finally{fs.writeFileSync(path.join(out,'console.json'),JSON.stringify({errors,consoleErrors},null,2));fs.writeFileSync(path.join(out,'network.json'),JSON.stringify(network,null,2));await p.screenshot({path:path.join(out,'last-page.png'),fullPage:true}).catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
