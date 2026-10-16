// Actual API/MySQL queue proof. Historical list-only rows are seeded by guarded runner.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE,meta=JSON.parse(fs.readFileSync(path.join(out,'fixture-readback.json'))),api='http://127.0.0.1:8382/api/v1',origin='http://127.0.0.1:5382',checks=[],errors=[];
 assert.ok(meta.queueFixture);const [old,today]=meta.queueFixture.rows;
 const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 async function http(method,url,body,token){const response=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,method+' '+url+' '+response.status);return response.json();}
 const staff=await http('POST','/auth/login',{email:'staff.dn@example.test',password:process.env.OTO2_SEED_PASSWORD}),user=await http('POST','/auth/login',{email:'user@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  async function count(expected){await p.waitForFunction(n=>document.querySelectorAll('article').length===n,expected);return p.locator('article').count();}
  await p.goto(origin+'/staff/queue');await p.waitForURL('**/login');await p.getByLabel('Email',{exact:true}).fill('staff.dn@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL('**/staff/queue');await p.locator('article').nth(1).waitFor();
  const status=p.getByLabel('Trạng thái',{exact:true}),queue=p.getByLabel('Hàng đợi',{exact:true});
  check('Vietnamese role in topbar',await p.locator('header').textContent().then(t=>t.includes('Nhân viên')&&!/\bSTAFF\b/.test(t)));
  check('Localized status options',await status.locator('option').allTextContents(),['Tất cả','Chờ xác nhận','Đã xác nhận','Đang thuê','Đã trả xe','Hoàn tất','Đã hủy','Đã từ chối','Hết hạn giữ lịch']);
  check('Default queue all',await queue.inputValue(),'all');
  await queue.selectOption('today');await p.locator('article').filter({hasText:today.id}).waitFor();check('Today creation excludes yesterday',await count(1),1);
  await queue.selectOption('all');await p.locator('article').nth(1).waitFor();check('All includes historical rows',await count(2),2);
  const start=new Date(Date.now()+12*86400000),input={vehicleId:'v3',pickupBranchId:'dn',returnBranchId:'dn',startAt:start.toISOString(),endAt:new Date(start.getTime()+86400000).toISOString()};
  const quote=await http('POST','/bookings/quote',input,user.token),fresh=await http('POST','/bookings',{...input,expectedTotal:quote.total},user.token);
  check('CreatedAt is actual server field',Number.isFinite(Date.parse(fresh.createdAt)));
  await p.getByRole('button',{name:'Tải lại danh sách',exact:true}).click();await p.locator('article').filter({hasText:fresh.id}).waitFor();check('New booking first after refresh',(await p.locator('article').first().textContent()).includes(fresh.id));
  const apiRows=await http('GET','/bookings',null,staff.token);check('Backend newest first independent of UI',apiRows.map(r=>r.id),[fresh.id,today.id,old.id]);
  await queue.selectOption('today');await p.locator('article').filter({hasText:fresh.id}).waitFor();check('Today includes current and fresh',await count(2),2);
  await status.selectOption('PENDING');await p.locator('article').filter({hasText:fresh.id}).waitFor();check('Status combines with Today',await count(1),1);
  await p.getByLabel('Tìm mã đơn, xe hoặc khách hàng',{exact:true}).fill('cannot-match-any-car');await p.getByText('Không có đơn phù hợp',{exact:true}).waitFor();check('Keyword combines with filters',await count(0),0);
  await p.getByLabel('Tìm mã đơn, xe hoặc khách hàng',{exact:true}).fill('');await status.selectOption('');await queue.selectOption('all');await p.locator('article').nth(2).waitFor();await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'queue-1440.png'),fullPage:true});
  for(const route of ['handover','return']){
   await p.goto(origin+'/staff/'+route);await p.getByLabel('Trạng thái',{exact:true}).waitFor();check('Operational status default '+route,await p.getByLabel('Trạng thái',{exact:true}).inputValue(),route==='handover'?'CONFIRMED':'IN_PROGRESS');
   await p.getByLabel('Trạng thái',{exact:true}).selectOption('');await p.getByLabel('Hàng đợi',{exact:true}).selectOption('today');await p.locator('article').filter({hasText:old.id}).waitFor();check('Today by '+route+' date',await count(1),1);check('Work date ignores creation day '+route,(await p.locator('article').textContent()).includes(old.id));
   await p.getByLabel('Hàng đợi',{exact:true}).selectOption('all');await p.locator('article').nth(2).waitFor();check('All removes only day '+route,await count(3),3);
  }
  await p.goto(origin+'/staff/queue');await p.locator('article').nth(2).waitFor();await p.setViewportSize({width:1280,height:1000});check('Desktop no overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'queue-1280.png'),fullPage:true});
  const other=await http('POST','/auth/login',{email:'staff.hn@example.test',password:process.env.OTO2_SEED_PASSWORD});check('Wrong branch cannot read queue records',await http('GET','/bookings',null,other.token),[]);
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,mobileDeferredByUser:true},null,2));}
 console.log('PASS staff queue '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
