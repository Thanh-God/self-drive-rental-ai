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
 const licenseResponse=await fetch(api+'/me/license',{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id:null,licenseNumber:'FIXTURE-LICENSE-2026',scheme:'VN_2025',licenseClass:'B',expiresOn:'2030-12-31',automaticOnly:false,status:'PENDING',version:0})});check('Real license save',licenseResponse.status,200);
 const license=await(await fetch(api+'/me/license',{headers:{authorization:'Bearer '+token}})).json();check('License persisted',license.licenseNumber,'FIXTURE-LICENSE-2026');

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
 console.log('PASS password feedback browser: '+checks.length+' assertions');
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
