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
  async function logout(){await p.locator('header button[aria-expanded]').first().click();await p.getByRole('button',{name:'Đăng xuất',exact:true}).filter({visible:true}).click();await p.goto(origin+'/vehicles/favorites');await p.locator('.vehicle-card').waitFor();}
  await login('user@example.test');check('User does not inherit guest',await p.locator('.vehicle-card').count(),0);
  await p.goto(origin+'/vehicles');await p.getByRole('button',{name:'Yêu thích Hyundai Accent',exact:true}).click();
  await logout();check('Guest restored after logout',await p.locator('.vehicle-card h2').textContent(),'Toyota Vios');
  await login('staff.dn@example.test');check('Staff isolated from user and guest',await p.locator('.vehicle-card').count(),0);
  await logout();
  const fault=await browser.newContext();await fault.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('kdrive.favorites.'))throw new DOMException('Quota','QuotaExceededError');return original.call(this,key,value);};});
  const f=await fault.newPage();await f.goto(origin+'/vehicles');await f.getByRole('button',{name:'Yêu thích Toyota Vios',exact:true}).click();await f.getByRole('article').filter({has:f.getByRole('button',{name:'Bỏ yêu thích Toyota Vios',exact:true})}).getByRole('status').waitFor();
  await f.getByRole('link',{name:'Xe yêu thích (1)',exact:true}).click();await f.locator('.vehicle-card').waitFor();check('Quota fallback usable',await f.locator('.vehicle-card').count(),1);await fault.close();
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,storageQuotaFaultInjected:true},null,2));}
 console.log('PASS favorites '+checks.length+' assertions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
