// Real API/MySQL lifecycle and desktop UI proof on the guarded isolated fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE,api='http://127.0.0.1:8382/api/v1',origin='http://127.0.0.1:5382',checks=[],errors=[];
 const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 async function http(method,url,body,token){const r=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,method+' '+url+' '+r.status);return r.json();}
 const staff=await http('POST','/auth/login',{email:'staff.dn@example.test',password:process.env.OTO2_SEED_PASSWORD}),user=await http('POST','/auth/login',{email:'user@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const start=new Date(Date.now()+30000),input={vehicleId:'v1',pickupBranchId:'dn',returnBranchId:'dn',startAt:start.toISOString(),endAt:new Date(start.getTime()+86400000).toISOString()};
 const quote=await http('POST','/bookings/quote',input,user.token),booking=await http('POST','/bookings',{...input,expectedTotal:quote.total},user.token);
 await http('POST','/bookings/'+booking.id+'/actions',{next:'CONFIRMED',version:booking.version},staff.token);
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/login');await p.getByLabel('Email',{exact:true}).fill('staff.dn@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL(url=>url.pathname.startsWith('/staff'));
  await p.goto(origin+'/staff/handover');const waiting=p.getByRole('button',{name:'Chờ bàn giao',exact:true}),delivered=p.getByRole('button',{name:'Đã bàn giao',exact:true});
  await p.locator('article').filter({hasText:booking.id}).waitFor();check('Waiting default',await waiting.getAttribute('aria-pressed'),'true');check('Confirmed is waiting',await p.locator('article').count(),1);
  await delivered.click();await p.getByText('Không có đơn phù hợp',{exact:true}).waitFor();check('Confirmed excluded from delivered',await p.locator('article').count(),0);
  await waiting.click();await p.locator('article').filter({hasText:booking.id}).waitFor();await p.screenshot({path:path.join(out,'waiting-1440.png'),fullPage:true});await p.getByRole('link',{name:'Chi tiết',exact:true}).click();
  // Wait only for the real planned pickup time; do not mutate fixture state or clock.
  const remaining=start.getTime()-Date.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining+100));
  await p.getByRole('button',{name:'Tải lại đơn',exact:true}).click();await p.getByLabel('Chuyển trạng thái',{exact:true}).locator('option[value="IN_PROGRESS"]').waitFor({state:'attached'});
  await p.getByLabel('Chuyển trạng thái',{exact:true}).selectOption('IN_PROGRESS');const submit=p.getByRole('button',{name:'Bàn giao xe',exact:true});
  let writes=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/actions'))writes++;});await submit.click();check('Empty required handover fields stop POST',writes,0);
  await p.getByLabel('Tình trạng xe / ghi chú',{exact:true}).fill('Xe nguyên trạng, đủ phụ kiện');await p.getByLabel('Đã kiểm tra GPLX và xe phù hợp đến hết chuyến.',{exact:true}).check();
  const saved=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/actions'));await submit.click();check('Actual backend handover accepted',(await saved).status(),200);
  await p.getByText('Đã bàn giao xe thành công — đơn chuyển sang Đang thuê.',{exact:true}).waitFor();await p.getByText('Hiện tại: Đang thuê',{exact:true}).waitFor();check('Single handover POST',writes,1);
  const readback=await http('GET','/bookings/'+booking.id,null,staff.token);check('Persisted IN_PROGRESS',readback.booking.status,'IN_PROGRESS');check('Persisted handover record',readback.records.some(r=>r.kind==='HANDOVER'));
  await p.getByRole('link',{name:'Xem danh sách Đã bàn giao',exact:true}).click();await p.waitForURL('**/staff/handover?group=delivered');await p.locator('article').filter({hasText:booking.id}).waitFor();check('Delivered deep link active',await delivered.getAttribute('aria-pressed'),'true');check('Delivered state badge',await p.locator('article').textContent().then(t=>t.includes('Đang thuê')));
  await p.getByRole('button',{name:'Tải lại danh sách',exact:true}).click();await p.locator('article').filter({hasText:booking.id}).waitFor();check('Refresh retains group',await delivered.getAttribute('aria-pressed'),'true');
  await p.getByLabel('Tìm mã đơn, xe hoặc khách hàng',{exact:true}).fill('cannot-match');await p.getByText('Không có đơn phù hợp',{exact:true}).waitFor();check('Search composes with group',await p.locator('article').count(),0);await p.getByLabel('Tìm mã đơn, xe hoặc khách hàng',{exact:true}).fill('');await p.locator('article').waitFor();
  for(const width of [1280,1440]){await p.setViewportSize({width,height:1000});check('No horizontal overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(out,'delivered-'+width+'.png'),fullPage:true});}
  await waiting.click();await p.getByText('Không có đơn phù hợp',{exact:true}).waitFor();check('Delivered removed from waiting',await p.locator('article').count(),0);check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,mobileDeferredByUser:true},null,2));}
 console.log('PASS handover groups '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
