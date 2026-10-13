const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.C11_PLAYWRIGHT);
const out=process.env.C11_EVIDENCE,base='http://127.0.0.1:5299',api='http://127.0.0.1:8299/api/v1',checks=[];
function check(name,actual,expected){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));}
async function main(){
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
 const errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept().catch(e=>errors.push(e.message));});
 const email='password-feedback-'+Date.now()+'@example.test',oldPassword='Initial fixture 2026!',newPassword='Updated fixture 2026!';
 await page.goto(base+'/register');await page.getByLabel('Họ và tên',{exact:true}).fill('Password Fixture');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mật khẩu',{exact:true}).fill(oldPassword);await page.getByRole('button',{name:'Đăng ký',exact:true}).last().click();await page.waitForURL(base+'/');
 const oldToken=await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
 await page.goto(base+'/user/profile');await page.getByLabel('Số điện thoại',{exact:true}).fill('0901234567');
 const saved=page.waitForResponse(r=>r.url().endsWith('/me/profile')&&r.request().method()==='PUT');await page.getByRole('button',{name:'Lưu hồ sơ',exact:true}).click();check('Real profile update',(await saved).status(),200);
 const token=await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
 const me=await(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+token}})).json();check('Phone persisted',me.phone,'0901234567');
 await page.getByLabel('Số giấy phép',{exact:true}).fill('FIXTURE-LICENSE-2026');
 await page.getByLabel('Hệ giấy phép',{exact:true}).selectOption('VN_2025');
 await page.getByLabel('Hạng bằng',{exact:true}).selectOption('B');
 await page.getByLabel('Ngày hết hạn',{exact:true}).fill('2030-12-31');
 const licenseSaved=page.waitForResponse(r=>r.url().endsWith('/me/license')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Lưu thông tin GPLX',exact:true}).click();check('License form actual MySQL API',(await licenseSaved).status(),200);
 const readLicense=async()=> (await fetch(api+'/me/license',{headers:{authorization:'Bearer '+token}})).json();
 const license=await readLicense();check('License persisted',license.licenseNumber,'FIXTURE-LICENSE-2026');
 await page.goto(base+'/user/profile');await page.getByLabel('Ngày hết hạn',{exact:true}).fill('2020-01-01');
 const licenseRejected=page.waitForResponse(r=>r.url().endsWith('/me/license')&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Lưu thông tin GPLX',exact:true}).click();check('Expired license rejected',(await licenseRejected).status(),400);
 check('Rejected license does not overwrite persisted date',(await readLicense()).expiresOn,'2030-12-31');
 await page.goto(base+'/user/profile');await page.getByLabel('Số điện thoại',{exact:true}).fill('abc');
 let profileWrites=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/me/profile'))profileWrites++;});
 await page.getByRole('button',{name:'Lưu hồ sơ',exact:true}).click();await page.getByText('Số điện thoại cần 7–15 chữ số, có thể bắt đầu bằng +.',{exact:true}).waitFor();
 check('Invalid phone does not send write',profileWrites,0);
 // Real backend commits the request; explicitly delay its response past Axios timeout.
 // This tests unknown outcome UX, not the cause of the user's historical timeout.
 await page.getByLabel('Số điện thoại',{exact:true}).fill('0907654321');
 let release;const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/v1/me/profile',async route=>{
  if(route.request().method()!=='PUT')return route.continue();
  const response=await route.fetch();assert.equal(response.status(),200);
  await held;await route.fulfill({response}).catch(()=>{});
 });
 await page.getByRole('button',{name:'Lưu hồ sơ',exact:true}).click();
 try{
  await page.getByText(/Chưa xác nhận thao tác đã được lưu/).waitFor({timeout:26000});
  check('Timeout sends exactly one write',profileWrites,1);check('Timeout has no success alert',dialogs.length,0);
  const persisted=await(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+token}})).json();
  check('Committed request readback despite delayed response',persisted.phone,'0907654321');
  await page.screenshot({path:path.join(out,'profile-timeout-unknown.png'),fullPage:true});
 }finally{release();await page.unroute('**/api/v1/me/profile');}
 await page.goto(base+'/user/profile');check('Reload displays persisted phone',await page.getByLabel('Số điện thoại',{exact:true}).inputValue(),'0907654321');


 await page.goto(base+'/user/profile');await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill(oldPassword);
 let puts=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/me/password'))puts++;});
 const next=page.getByLabel('Mật khẩu mới',{exact:true}),confirmation=page.getByLabel('Nhập lại mật khẩu mới',{exact:true}),button=page.getByRole('button',{name:'Đổi mật khẩu',exact:true});
 await next.fill('87654321');await confirmation.fill('Different fixture 2026!');await button.click();
 await page.getByText('Mật khẩu cần có: chữ hoa, chữ thường, ký tự đặc biệt. Mật khẩu nhập lại chưa khớp.',{exact:true}).waitFor();check('Invalid composition and mismatch block write',puts,0);check('No false success dialog',dialogs.length,0);
 await page.screenshot({path:path.join(out,'password-errors.png'),fullPage:true});
 await next.fill(newPassword);await button.click();await page.getByText('Mật khẩu nhập lại chưa khớp.',{exact:true}).waitFor();check('Valid policy but mismatch still blocks write',puts,0);
 await confirmation.fill(newPassword);await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill('Wrong fixture 2026!');
 const rejected=page.waitForResponse(r=>r.url().endsWith('/me/password')&&r.request().method()==='PUT');await button.click();check('Wrong current password rejected by actual server',(await rejected).status(),400);
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Đổi mật khẩu').disabled);
 check('Rejected update has no success alert',dialogs.length,0);check('Rejected update keeps local session',await page.evaluate(()=>localStorage.getItem('kdrive.jwt')!==null),true);check('Rejected update keeps new input',await next.inputValue(),newPassword);
 await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill(oldPassword);
 const success=page.waitForResponse(r=>r.url().endsWith('/me/password')&&r.request().method()==='PUT');await button.click();check('Actual password update success',(await success).status(),200);await page.waitForURL('**/login');
 check('Exactly one native success alert',dialogs,[{type:'alert',message:'Đổi mật khẩu thành công. Các phiên đăng nhập cũ đã được thu hồi. Vui lòng đăng nhập lại.'}]);
 check('Device token cleared',await page.evaluate(()=>localStorage.getItem('kdrive.jwt')),null);check('Old token denied by backend',(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+oldToken}})).status,401);
 const login=async password=>fetch(api+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});
 check('Old password rejected',(await login(oldPassword)).status,401);check('New password accepted',(await login(newPassword)).status,200);check('Only wrong-current and valid PUTs sent',puts,2);check('No JS errors',errors,[]);
 fs.writeFileSync(path.join(out,'dialog.json'),JSON.stringify(dialogs,null,2));await page.screenshot({path:path.join(out,'after-password-change.png'),fullPage:true});
 console.log('PASS C13 profile browser scoped: '+checks.length+' assertions');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
