// Stage5 focused guide/history smoke, not stage6 full rental journey.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE;assert.ok(fs.existsSync(path.join(out,'fixture-readback.json')));
 const api='http://127.0.0.1:8382/api/v1',origin='http://127.0.0.1:5382',checks=[],errors=[];
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 async function http(method,url,body,token){const r=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,method+' '+url+' '+r.status);return r.json();}
 const user=await http('POST','/auth/login',{email:'user@example.test',password:process.env.OTO2_SEED_PASSWORD}),staff=await http('POST','/auth/login',{email:'staff.dn@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const start=new Date(Date.now()+5*86400000),end=new Date(start.getTime()+86400000);
 const input={vehicleId:'v1',pickupBranchId:'dn',returnBranchId:'dn',startAt:start.toISOString(),endAt:end.toISOString()};
 const quote=await http('POST','/bookings/quote',input,user.token),booking=await http('POST','/bookings',{...input,expectedTotal:quote.total},user.token);
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1280,height:1000}});p.setDefaultTimeout(15000);p.on('pageerror',error=>errors.push(error.message));
  await p.goto(origin+'/rental-guide');await p.getByRole('heading',{name:'Hướng dẫn thuê xe',exact:true}).waitFor();
  check('Seven FAQ items',await p.locator('details').count(),7);await p.getByText('Giá thuê được tính thế nào?',{exact:true}).click();await p.getByText('Đơn mới tính số ngày giữa ngày nhận và ngày trả',{exact:false}).waitFor();
  for(const width of [1280,1440]){await p.setViewportSize({width,height:1000});check('Guide no overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'guide-'+width+'.png'),fullPage:true});}
  await p.goto(origin+'/user/bookings/'+booking.id);await p.waitForURL('**/login');await p.getByLabel('Email',{exact:true}).fill('user@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL('**/user/bookings/'+booking.id);
  const progress=p.getByRole('region',{name:'Tiến trình đơn thuê',exact:true});await progress.getByText('Hiện tại: Chờ xác nhận',{exact:true}).waitFor();
  check('Real initial history',await progress.locator('ol li').count(),1);check('Pending no document link',await progress.getByRole('link',{name:'Hợp đồng',exact:true}).count(),0);
  await http('POST','/bookings/'+booking.id+'/actions',{next:'CONFIRMED',version:booking.version},staff.token);
  await p.getByRole('button',{name:'Tải lại đơn',exact:true}).click();await progress.getByText('Hiện tại: Đã xác nhận',{exact:true}).waitFor();
  check('Reload actual history',await progress.locator('ol li').count(),2);check('Contract issued link',await progress.getByRole('link',{name:'Hợp đồng',exact:true}).count(),1);check('Invoice not yet linked',await progress.getByRole('link',{name:'Hóa đơn',exact:true}).count(),0);
  await progress.getByRole('link',{name:'Hợp đồng',exact:true}).click();await p.getByRole('heading',{name:'Hợp đồng thuê xe',exact:true}).waitFor();await p.getByRole('heading',{name:'Điều khoản',exact:true}).waitFor();check('Actual document route',new URL(p.url()).pathname.endsWith('/contract'),true);
  await p.goto(origin+'/user/bookings/'+booking.id);await p.getByText('Hiện tại: Đã xác nhận',{exact:true}).waitFor();
  for(const width of [1280,1440]){await p.setViewportSize({width,height:1000});check('Order no overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'progress-'+width+'.png'),fullPage:true});}
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,stage6:false},null,2));}
 console.log('PASS stage5 '+checks.length+' assertions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
