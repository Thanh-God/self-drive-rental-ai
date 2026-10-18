// Native desktop browser against the isolated C14 harness API/MySQL, no interception.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.C11_PLAYWRIGHT);
const out=process.env.C11_EVIDENCE,origin='http://127.0.0.1:5300',api='http://127.0.0.1:8300/api/v1';
async function main(){
 const checks=[],errors=[],consoleMessages=[];const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 async function http(method,url,body,token,status=200){const r=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status,method+' '+url);return status===204?null:r.json();}
 const password='BranchBookingTestOnly123!',admin=await http('POST','/auth/login',{email:'admin@example.test',password}),user=await http('POST','/auth/login',{email:'user@example.test',password});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(['error','warning'].includes(msg.type()))consoleMessages.push({level:msg.type(),text:msg.text()});});
  await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill('admin@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(u=>u.pathname!=='/login');
  await page.goto(origin+'/admin/vehicles');await page.getByRole('heading',{name:'Quản lý xe',exact:true}).waitFor();await page.locator('article').first().waitFor();
  check('Page identity',new URL(page.url()).pathname,'/admin/vehicles');check('Meaningful title',Boolean(await page.title()));check('Nonblank cards',await page.locator('article').count()>0);check('No error overlay',await page.locator('vite-error-overlay').count(),0);
  const name='Xe kiểm thử mới '+Date.now(),plate='QA-'+Date.now().toString().slice(-10);
  await page.getByLabel('Tên xe',{exact:true}).fill(name);await page.getByLabel('Biển số',{exact:true}).fill(plate);await page.getByLabel('Giá/ngày (VND)',{exact:true}).fill('700000');
  const created=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/admin/vehicles'));await page.getByRole('button',{name:'Tạo xe',exact:true}).click();const createdResponse=await created;check('Create success',createdResponse.status(),200);const vehicle=await createdResponse.json();await page.locator('article').first().getByRole('heading',{name,exact:true}).waitFor();check('Created timestamp supplied',Boolean(vehicle.createdAt));
  await page.reload();await page.locator('article').first().getByRole('heading',{name,exact:true}).waitFor();check('New first survives reload',true);
  for(const width of [1280,1440]){
   await page.setViewportSize({width,height:1000});
   check('No overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const rows=await page.locator('article').evaluateAll(cards=>cards.map(card=>{const content=card.firstElementChild,actions=card.lastElementChild,buttons=[...actions.querySelectorAll('button')];return {below:actions.getBoundingClientRect().top>=content.getBoundingClientRect().bottom,left:buttons.map(b=>Math.round(b.getBoundingClientRect().left)),labels:buttons.map(b=>b.textContent.trim())};}));
   check('Every action row below content '+width,rows.every(r=>r.below));check('Every card has edit and delete '+width,rows.every(r=>r.labels.includes('Chỉnh sửa')&&r.labels.includes('Xóa xe')));
   await page.screenshot({path:path.join(out,'vehicle-admin-'+width+'.png'),fullPage:true});
  }
  let card=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});await card.getByRole('button',{name:'Chỉnh sửa',exact:true}).click();await page.getByRole('heading',{name:'Cập nhật xe',exact:true}).waitFor();check('Edit populates correct car',await page.getByLabel('Tên xe',{exact:true}).inputValue(),name);
  const updated=name+' sửa';await page.getByLabel('Tên xe',{exact:true}).fill(updated);const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/admin/vehicles/'+vehicle.id));await page.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();const savedVehicle=await (await saved).json();check('Edit preserves createdAt',savedVehicle.createdAt,vehicle.createdAt);await page.getByText('Đã cập nhật xe.',{exact:true}).waitFor();
  check('Reset retains brand',await page.getByLabel('Hãng xe',{exact:true}).inputValue()!=='');check('Reset retains category',await page.getByLabel('Loại xe',{exact:true}).inputValue()!=='');check('Reset retains branch',await page.getByLabel('Chi nhánh quản lý',{exact:true}).inputValue()!=='');
  card=page.locator('article').filter({has:page.getByRole('heading',{name:updated,exact:true})});await card.waitFor();
  let deletes=0;page.on('request',r=>{if(r.method()==='DELETE')deletes++;});page.once('dialog',d=>d.dismiss());await card.getByRole('button',{name:'Xóa xe',exact:true}).click();check('Cancel no delete request',deletes,0);check('Cancel preserves row',await card.count(),1);
  page.once('dialog',d=>d.accept());const deleted=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/admin/vehicles/'+vehicle.id));await card.getByRole('button',{name:'Xóa xe',exact:true}).click();check('Delete unused success',(await deleted).status(),204);await card.waitFor({state:'detached'});await http('GET','/vehicles/'+vehicle.id,null,null,404);check('Deleted detail404',true);
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),add=n=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  await http('PUT','/me/license',{licenseNumber:'QA-VEHICLE-123',scheme:'VN_2025',licenseClass:'B',expiresOn:'2030-12-31',automaticOnly:false,version:0},user.token);
  const input={vehicleId:'v1',pickupBranchId:'dn',returnBranchId:'dn',pickupDate:add(3),returnDate:add(7)},quote=await http('POST','/bookings/quote',input,user.token),booking=await http('POST','/bookings',{...input,expectedTotal:quote.total},user.token,201);
  await page.reload();const historical=page.locator('article').filter({has:page.getByRole('heading',{name:'Toyota Vios',exact:true})});await historical.waitFor();page.once('dialog',d=>d.accept());const blocked=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/admin/vehicles/v1'));await historical.getByRole('button',{name:'Xóa xe',exact:true}).click();check('History delete conflict',(await blocked).status(),409);await page.getByRole('alert').filter({hasText:'Ngừng khai thác'}).waitFor();check('History row kept',await historical.count(),1);check('Booking retained',(await http('GET','/bookings/'+booking.id,null,user.token)).booking.id,booking.id);
  await page.screenshot({path:path.join(out,'vehicle-delete-history.png'),fullPage:false});check('No runtime errors',errors,[]);check('No unexpected console errors',consoleMessages.filter(m=>m.level==='error'&&!m.text.includes('409')),[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));fs.writeFileSync(path.join(out,'console-errors.json'),JSON.stringify({errors,consoleMessages}));}
 console.log('PASS vehicle admin '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
