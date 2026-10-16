// Compare real API prices and a real occupying booking on an owned fixture only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE;assert.ok(out && fs.existsSync(path.join(out,'fixture-readback.json')));
 const api='http://127.0.0.1:8382/api/v1',origin='http://127.0.0.1:5382';
 const checks=[],errors=[];const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 async function http(method,url,body,token){const r=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,'Fixture HTTP '+method+' '+url+' '+r.status);return r.json();}
 const admin=await http('POST','/auth/login',{email:'admin@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const user=await http('POST','/auth/login',{email:'user@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const original=await http('GET','/vehicles');const v1=original.find(v=>v.id==='v1'),v3=original.find(v=>v.id==='v3');
 const extra=await http('POST','/admin/vehicles',{...v1,id:null,name:'Compare Fixture Car',plate:'OTO3-COMPARE',dailyPrice:700000,version:0},admin.token);
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto(origin+'/vehicles');await p.locator('.vehicle-card').nth(3).waitFor();
  for(const car of [v1,v3,extra]){await p.getByRole('button',{name:'So sánh '+car.name,exact:true}).click();await p.getByRole('button',{name:'Bỏ so sánh '+car.name,exact:true}).waitFor();}
  check('Three selected',new URL(p.url()).searchParams.get('compare').split(',').length,3);
  await p.getByRole('button',{name:'So sánh Mitsubishi Xpander',exact:true}).click();await p.getByText('Đã chọn 3 xe. Hãy bỏ một xe trước khi thêm xe khác.',{exact:true}).waitFor();
  check('Fourth rejected',new URL(p.url()).searchParams.get('compare').split(',').length,3);
  await p.getByRole('link',{name:'So sánh xe (3)',exact:true}).click();await p.locator('.compare-column h2').nth(2).waitFor();
  check('Static route, three columns',await p.locator('.compare-column').count(),3);check('No fabricated trip total without dates',await p.locator('[data-trip-total]').count(),0);
  await p.getByRole('link',{name:'Thay đổi chuyến',exact:true}).click();
  const date=new Date(Date.now()+5*86400000),start=date.toISOString().slice(0,10),end=new Date(date.getTime()+86400000).toISOString().slice(0,10);
  const form=p.getByRole('form',{name:'Tìm xe theo chuyến'});
  await form.getByLabel('Điểm nhận',{exact:true}).selectOption('dn');await form.getByLabel('Ngày nhận',{exact:true}).fill(start);await form.getByLabel('Ngày trả',{exact:true}).fill(end);await form.getByRole('button',{name:'Tìm xe',exact:true}).click();
  await p.waitForURL(url=>url.searchParams.get('start')===start);
  check('Trip edit preserves selection',new URL(p.url()).searchParams.get('compare').split(',').length,3);
  await p.getByRole('link',{name:'So sánh xe (3)',exact:true}).click();await p.locator('[data-trip-total]').nth(2).waitFor();
  check('Independent server totals',await p.locator('[data-trip-total]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.tripTotal))),[650000,600000,700000]);
  const selected=p.url();await p.reload();await p.locator('[data-trip-total]').nth(2).waitFor();check('Reload retains conditions',p.url(),selected);
  await http('PUT','/admin/vehicles/v1',{...v1,dailyPrice:800000},admin.token);
  await p.getByRole('button',{name:'Kiểm tra lại giá & lịch',exact:true}).click();await p.locator('[data-trip-total="800000"]').waitFor();check('Price edit refreshed',await p.locator('[data-trip-total="800000"]').count(),1);
  const input={vehicleId:'v1',pickupBranchId:'dn',returnBranchId:'dn',startAt:new Date(start+'T00:00:00+07:00').toISOString(),endAt:new Date(end+'T00:00:00+07:00').toISOString()};
  const quote=await http('POST','/bookings/quote',input,user.token);await http('POST','/bookings',{...input,expectedTotal:quote.total},user.token);
  await p.getByRole('button',{name:'Kiểm tra lại giá & lịch',exact:true}).click();
  const blocked=p.locator('.compare-column').filter({has:p.getByRole('heading',{name:'Toyota Vios',exact:true})});
  await blocked.getByText('Không còn phù hợp lịch/tuyến đã chọn. Hãy đổi chuyến hoặc kiểm tra lại.',{exact:true}).waitFor();
  check('Occupied vehicle has no total',await blocked.locator('[data-trip-total]').count(),0);check('Occupied vehicle has no booking action',await blocked.getByRole('link',{name:'Chọn xe này & báo giá',exact:true}).count(),0);
  for(const width of [1440,1280]){await p.setViewportSize({width,height:1000});check('No page overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'compare-'+width+'.png'),fullPage:true});}
  const available=p.locator('.compare-column').filter({has:p.getByRole('heading',{name:'Hyundai Accent',exact:true})});await available.getByRole('link',{name:'Chọn xe này & báo giá',exact:true}).click();await p.waitForURL('**/login');
  await p.getByLabel('Email',{exact:true}).fill('user@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL('**/user/bookings/new?*');
  check('Correct chosen vehicle after login',new URL(p.url()).searchParams.get('vehicleId'),'v3');check('Trip retained in booking URL',new URL(p.url()).searchParams.get('start'),start);
  await p.getByLabel('Ngày nhận (giờ Việt Nam)',{exact:true}).waitFor();check('Booking time prefilled',await p.getByLabel('Ngày nhận (giờ Việt Nam)',{exact:true}).inputValue(),start);
  await p.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();await p.getByText('600.000',{exact:false}).first().waitFor();
  check('No framework overlay',await p.locator('vite-error-overlay').count(),0);check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,mocks:false},null,2));}
 console.log('PASS real comparison '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
