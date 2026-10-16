// R3b desktop proof on isolated real API/MySQL; one booking, no API interception.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE,api='http://127.0.0.1:8382/api/v1',origin='http://127.0.0.1:5382',checks=[],errors=[];assert.ok(fs.existsSync(path.join(out,'fixture-readback.json')));
 const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 async function http(method,url,body,token){const r=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,method+' '+url+' '+r.status);return r.json();}
 const admin=await http('POST','/auth/login',{email:'admin@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const staff=await http('POST','/auth/login',{email:'staff.dn@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const vehicle=await http('GET','/vehicles/v1');
 const day=new Date(Date.now()+5*86400000),start=day.toISOString().slice(0,10)+'T10:00',end=new Date(day.getTime()+2*86400000).toISOString().slice(0,10)+'T10:00';
 const query=new URLSearchParams({start,end,pickupBranchId:'dn',returnBranchId:'dn',brand:'toyota'});
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000},permissions:['clipboard-read','clipboard-write']}),p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/vehicles/v1?'+query);await p.getByText('Chi nhánh hiện tại:',{exact:false}).filter({hasText:'Đà Nẵng'}).waitFor();
  check('Branch name not raw ID',await p.getByText('Chi nhánh hiện tại:',{exact:false}).textContent().then(t=>!t.includes(': dn')));
  check('Operating state avoids availability promise',await p.locator('aside.panel').textContent().then(t=>t.includes('Đang khai thác')&&!t.includes('Sẵn sàng thuê')));
  check('Trip summary names',await p.locator('.vehicle-trip-summary').textContent().then(t=>t.includes('Đà Nẵng')));
  check('Empty tray removed',await p.getByRole('complementary',{name:'Lựa chọn so sánh'}).count(),0);
  const next=p.getByRole('link',{name:'Kiểm tra giá & lịch',exact:true});check('Trip URL retained',new URL(await next.getAttribute('href'),origin).searchParams.get('start'),start);
  await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'detail-1280.png'),fullPage:true});
  await next.click();await p.waitForURL('**/login');await p.getByLabel('Email',{exact:true}).fill('user@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL(url=>url.pathname==='/user/bookings/new');
  const form=p.getByRole('form',{name:'Chuyến đi thuê xe',exact:true});await form.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).waitFor();
  check('Dates restored after login',await form.getByLabel('Thời gian nhận (giờ Việt Nam)',{exact:true}).inputValue(),start);
  await form.getByRole('link',{name:'Kiểm tra GPLX',exact:true}).waitFor();
  const quoteResponse=p.waitForResponse(r=>r.url().endsWith('/api/v1/bookings/quote')&&r.request().method()==='POST');await form.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();const quoted=await (await quoteResponse).json();
  let section=p.getByRole('region',{name:'Báo giá chuyến đi',exact:true});await section.waitFor();check('Real server total shown',(await section.textContent()).includes(Number(quoted.total).toLocaleString('vi-VN')));
  const consent=p.getByLabel('Tôi xác nhận thời gian, chi nhánh và tổng báo giá.',{exact:true}),send=p.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true});
  check('Consent initially unchecked',await consent.isChecked(),false);check('Send disabled without consent',await send.isDisabled());
  await consent.check();await form.getByLabel('Thời gian trả (giờ Việt Nam)',{exact:true}).fill(end.replace('10:00','11:00'));await section.waitFor({state:'detached'});check('Date edit hides quote',await section.count(),0);
  await form.getByLabel('Thời gian trả (giờ Việt Nam)',{exact:true}).fill(end);await form.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();await section.waitFor();check('Fresh quote needs new consent',await consent.isChecked(),false);
  await http('PUT','/admin/vehicles/v1',{...vehicle,dailyPrice:vehicle.dailyPrice+100000},admin.token);
  await consent.check();const stale=p.waitForResponse(r=>r.url().endsWith('/api/v1/bookings')&&r.request().method()==='POST');await send.click();check('Stale price rejected by actual backend',(await stale).status(),409);await section.waitFor({state:'detached'});await p.getByText('Giá đã thay đổi',{exact:false}).waitFor();check('Stale quote not left actionable',await send.count(),0);
  await form.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();await section.waitFor();check('Requote still unchecked',await consent.isChecked(),false);
  await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'booking-1280.png'),fullPage:true});
  await consent.check();const created=p.waitForResponse(r=>r.url().endsWith('/api/v1/bookings')&&r.request().method()==='POST');await send.click();const createdResponse=await created;check('Single actual booking created',createdResponse.status(),201);const booking=await createdResponse.json();await p.waitForURL('**/user/bookings/'+booking.id);await p.locator('.booking-identity code').waitFor();
  check('Short heading',await p.locator('h1').textContent(),'Đơn thuê · '+booking.id.slice(0,8));check('Full ID preserved',await p.locator('.booking-identity code').textContent(),booking.id);check('User version hidden',await p.getByText('Phiên bản',{exact:false}).count(),0);
  await p.getByRole('button',{name:'Sao chép mã đơn',exact:true}).click();await p.getByText('Đã sao chép mã đơn đầy đủ.',{exact:true}).waitFor();check('Actual clipboard full ID',await p.evaluate(()=>navigator.clipboard.readText()),booking.id);
  const history=p.locator('.booking-history');check('History initially collapsed',await history.evaluate(e=>e.open),false);await history.locator('summary').press('Enter');check('Keyboard opens history',await history.evaluate(e=>e.open));check('Real pending event',await history.locator('li').count(),1);
  const progress=p.getByRole('region',{name:'Tiến trình đơn thuê',exact:true});check('Pending contract absent',await progress.getByRole('link',{name:'Hợp đồng',exact:true}).count(),0);
  await http('POST','/bookings/'+booking.id+'/actions',{next:'CONFIRMED',version:booking.version},staff.token);await p.getByRole('button',{name:'Tải lại đơn',exact:true}).click();await progress.getByText('Hiện tại: Đã xác nhận',{exact:true}).waitFor();check('Contract link only after confirmed',await progress.getByRole('link',{name:'Hợp đồng',exact:true}).count(),1);check('Invoice not yet issued',await progress.getByRole('link',{name:'Hóa đơn',exact:true}).count(),0);
  for(const width of [1280,1440]){await p.setViewportSize({width,height:1000});check('Order no overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'order-'+width+'.png'),fullPage:true});}
  await progress.getByRole('link',{name:'Hợp đồng',exact:true}).click();await p.getByRole('heading',{name:'Hợp đồng thuê xe',exact:true}).waitFor();check('Document uses full ID',new URL(p.url()).pathname,'/user/bookings/'+booking.id+'/contract');
  const otherEmail='r3b-other@example.test';await http('POST','/auth/register',{email:otherEmail,fullName:'R3b Other Fixture',password:process.env.OTO2_SEED_PASSWORD});
  const otherContext=await browser.newContext({viewport:{width:1280,height:1000}}),b=await otherContext.newPage();b.setDefaultTimeout(15000);b.on('pageerror',e=>errors.push(e.message));await b.goto(origin+'/user/bookings/'+booking.id);await b.waitForURL('**/login');await b.getByLabel('Email',{exact:true}).fill(otherEmail);await b.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);const denied=b.waitForResponse(r=>r.url().endsWith('/api/v1/bookings/'+booking.id)&&r.request().method()==='GET');await b.getByRole('button',{name:'Đăng nhập',exact:true}).click();check('Other user actual API denied',(await denied).status(),404);await b.waitForURL('**/user/bookings/'+booking.id);await b.getByRole('button',{name:'Thử tải lại',exact:true}).waitFor();check('Other user sees no full ID data',await b.locator('.booking-identity').count(),0);
  await b.goto(origin+'/user/bookings/new?vehicleId=v1&'+query);const missingLicense=b.waitForResponse(r=>r.url().endsWith('/api/v1/bookings/quote')&&r.request().method()==='POST');await b.getByRole('button',{name:'Kiểm tra lịch & báo giá',exact:true}).click();check('Missing GPLX rejected',(await missingLicense).status(),400);await b.getByRole('link',{name:'Cập nhật giấy phép lái xe',exact:true}).waitFor();check('Missing GPLX no submit control',await b.getByRole('button',{name:'Gửi yêu cầu thuê',exact:true}).count(),0);
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,stage6:false,mobileDeferredByUser:true},null,2));}
 console.log('PASS R3b desktop '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
