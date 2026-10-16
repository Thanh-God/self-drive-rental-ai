// Actual API/browser proof; storage faults are injected locally, no API interception.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE;assert.ok(fs.existsSync(path.join(out,'fixture-readback.json')));
 const origin='http://127.0.0.1:5382',checks=[],errors=[];
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),p=await context.newPage();p.setDefaultTimeout(15000);
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/vehicles?q=Toyota&seats=5');await p.getByRole('button',{name:'Yêu thích Toyota Vios',exact:true}).click();
  await p.getByRole('link',{name:'Xe yêu thích (1)',exact:true}).click();await p.locator('.vehicle-card').waitFor();
  check('Favorite current API car',await p.locator('.vehicle-card h2').textContent(),'Toyota Vios');
  check('Filter retained',new URL(p.url()).searchParams.get('q'),'Toyota');
  await p.reload();await p.getByRole('button',{name:'Bỏ yêu thích Toyota Vios',exact:true}).waitFor();
  check('IDs only persisted',await p.evaluate(()=>JSON.parse(localStorage.getItem('kdrive.favorites.v1.guest'))),['v1']);
  const tab=await context.newPage();await tab.goto(origin+'/vehicles/favorites');await tab.getByRole('button',{name:'Bỏ yêu thích Toyota Vios',exact:true}).click();
  await p.getByText('Chưa có xe yêu thích.',{exact:false}).waitFor();check('Native cross-tab removal',await p.locator('.vehicle-card').count(),0);
  await tab.goto(origin+'/vehicles');await tab.getByRole('button',{name:'Yêu thích Toyota Vios',exact:true}).click();await p.locator('.vehicle-card').waitFor();await tab.close();
  for(const width of [1280,768,390]){await p.setViewportSize({width,height:1000});check('No overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'favorites-'+width+'.png'),fullPage:true});}
  await p.setViewportSize({width:1280,height:1000});
  async function login(email){await p.goto(origin+'/login');await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL(url=>url.pathname!=='/login');await p.goto(origin+'/vehicles/favorites');await p.getByRole('button',{name:'Tải lại danh sách',exact:true}).waitFor({state:'visible'});await p.getByText('Chưa có xe yêu thích.',{exact:false}).waitFor();}
  async function logout(){await p.locator('header button[aria-expanded]').first().click();const response=p.waitForResponse(r=>r.url().endsWith('/api/v1/auth/logout')&&r.request().method()==='POST');await p.getByRole('button',{name:'Đăng xuất',exact:true}).filter({visible:true}).click();check('Real logout complete',(await response).status(),204);await p.goto(origin+'/vehicles/favorites');await p.locator('.vehicle-card').waitFor();}
  await login('user@example.test');check('User does not inherit guest',await p.locator('.vehicle-card').count(),0);
  await p.goto(origin+'/vehicles');await p.getByRole('button',{name:'Yêu thích Hyundai Accent',exact:true}).click();
  await logout();check('Guest restored after logout',await p.locator('.vehicle-card h2').textContent(),'Toyota Vios');
  await login('staff.dn@example.test');check('Staff isolated from user and guest',await p.locator('.vehicle-card').count(),0);
  await logout();
  const fault=await browser.newContext();await fault.addInitScript(()=>{
   const originalSet=Storage.prototype.setItem,originalGet=Storage.prototype.getItem;
   window.__r2SetItem=originalSet;
   Storage.prototype.setItem=function(key,value){if(key.startsWith('kdrive.favorites.'))throw new DOMException('Quota','QuotaExceededError');return originalSet.call(this,key,value);};
   Storage.prototype.getItem=function(key){if(window.__r2ReadBlocked&&key.startsWith('kdrive.favorites.'))throw new DOMException('Blocked','SecurityError');return originalGet.call(this,key);};
  });
  const f=await fault.newPage();f.on('pageerror',e=>errors.push(e.message));await f.goto(origin+'/vehicles');await f.getByRole('button',{name:'Yêu thích Toyota Vios',exact:true}).click();await f.getByRole('article').filter({has:f.getByRole('button',{name:'Bỏ yêu thích Toyota Vios',exact:true})}).getByRole('status').waitFor();
  await f.getByRole('link',{name:'Xe yêu thích (1)',exact:true}).click();await f.getByRole('heading',{name:'Xe yêu thích',exact:true}).waitFor();await f.locator('.vehicle-card').waitFor();check('Quota fallback usable',await f.locator('.vehicle-card').count(),1);
  await f.evaluate(()=>{window.__r2ReadBlocked=true;window.__r2Events=0;window.addEventListener('storage',e=>{if(e.key==='kdrive.favorites.v1.guest')window.__r2Events++;});});
  const external=await fault.newPage();external.on('pageerror',e=>errors.push(e.message));await external.goto(origin+'/vehicles');
  await external.evaluate(()=>window.__r2SetItem.call(localStorage,'kdrive.favorites.v1.guest','["v2"]'));
  await f.waitForFunction(()=>window.__r2Events>0);await f.getByText('Không đọc được danh sách đã lưu',{exact:false}).first().waitFor();
  check('Native event read failure retains RAM selection',await f.locator('.vehicle-card h2').textContent(),'Toyota Vios');
  await f.getByRole('link',{name:'Về danh sách xe',exact:true}).click();await f.getByRole('button',{name:'Yêu thích Hyundai Accent',exact:true}).click();
  await f.getByRole('link',{name:'Xe yêu thích (2)',exact:true}).click();await f.getByRole('heading',{name:'Xe yêu thích',exact:true}).waitFor();await f.getByRole('button',{name:'Bỏ yêu thích Hyundai Accent',exact:true}).waitFor();
  check('Toggle after blocked refresh keeps both RAM IDs',await f.locator('.vehicle-card').count(),2);
  await f.evaluate(()=>{window.__r2ReadBlocked=false;window.__r2Events=0;});await external.evaluate(()=>localStorage.removeItem('kdrive.favorites.v1.guest'));
  await f.waitForFunction(()=>window.__r2Events>0);await f.getByText('Chưa có xe yêu thích.',{exact:false}).waitFor();
  check('Readable native clear replaces RAM selection',await f.locator('.vehicle-card').count(),0);
  check('Recovery clears storage warning',await f.getByText('Không đọc được danh sách đã lưu',{exact:false}).count(),0);
  await fault.close();
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,storageQuotaFaultInjected:true},null,2));}
 console.log('PASS favorites '+checks.length+' assertions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
