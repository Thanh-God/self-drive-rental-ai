const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.C11_PLAYWRIGHT);
const out=process.env.C11_EVIDENCE,base='http://127.0.0.1:5298',api='http://127.0.0.1:8298/api/v1',checks=[];
function check(name,actual,expected){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,'browser-checkpoints.json'),JSON.stringify(checks,null,2));}
async function login(email){const r=await fetch(api+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'AuthSecurityOnly123!'})});assert.equal(r.status,200);return(await r.json()).token;}
async function main(){
 const admin=await login('admin@example.test'),headers={'content-type':'application/json',authorization:'Bearer '+admin};
 const photos=JSON.parse(fs.readFileSync('frontend/public/media/vehicles/licenses.json','utf8'));
 const vehicles=await(await fetch(api+'/vehicles')).json();
 for(const vehicle of vehicles){const photo=photos.find(p=>p.model===vehicle.name);assert.ok(photo);const state=await(await fetch(api+`/admin/vehicles/${vehicle.id}/images`,{headers})).json();if(!state.images.length){const r=await fetch(api+`/admin/vehicles/${vehicle.id}/images`,{method:'POST',headers,body:JSON.stringify({url:photo.url,attribution:photo.attribution,expectedRevision:state.revision})});assert.equal(r.status,201);}}
 const browser=await chromium.launch({headless:true});let page;
 try{
  const guest=await browser.newContext({viewport:{width:1440,height:1000}});page=await guest.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/register');await page.getByRole('heading',{name:'Đăng ký tài khoản',exact:true}).waitFor();
  await page.getByLabel('Họ và tên',{exact:true}).fill('Fixture Browser');await page.getByLabel('Họ và tên',{exact:true}).focus();
  const focus=await page.getByLabel('Họ và tên',{exact:true}).evaluate(e=>({color:getComputedStyle(e).outlineColor,width:getComputedStyle(e).outlineWidth}));
  check('Focus is thin teal',focus,{color:'rgb(0, 123, 115)',width:'2px'});
  check('No repeated header tagline',(await page.locator('header').innerText()).includes('Thuê xe tự lái'),false);
  check('Password hints present',await page.getByText(/Ít nhất 8 ký tự/).count(),1);
  await page.getByLabel('Mật khẩu',{exact:true}).fill('A strong browser password 2026!');await page.getByRole('button',{name:'Hiện mật khẩu',exact:true}).click();
  check('Show password type',await page.getByLabel('Mật khẩu',{exact:true}).getAttribute('type'),'text');
  await page.getByRole('button',{name:'Ẩn mật khẩu',exact:true}).click();
  const email='browser-'+Date.now()+'@example.test';await page.getByLabel('Email',{exact:true}).fill(email);
  check('Registration has no repeated password',await page.getByLabel('Nhập lại mật khẩu',{exact:true}).count(),0);
  let posts=0;page.on('request',r=>{if(r.url().endsWith('/auth/register')&&r.method()==='POST')posts++;});
  await page.screenshot({path:path.join(out,'register-1440.png'),fullPage:true});
  await page.getByRole('button',{name:'Đăng ký',exact:true}).last().click();await page.waitForURL(base+'/');
  await page.getByRole('heading',{name:/Mỗi chuyến đi/}).waitFor();check('Actual registration single request',posts,1);
  const me=await page.evaluate(async()=>{const r=await fetch('/api/v1/auth/me',{headers:{authorization:'Bearer '+localStorage.getItem('kdrive.jwt')}});return await r.json();});check('Server role is USER',me.role,'USER');
  for(const width of [1280,1440,1920]){
   await page.setViewportSize({width,height:1000});await page.locator('.urban-hero-photo img').waitFor();
   const badge=await page.locator('.urban-hero-photo .vehicle-gallery > div:first-child > div:nth-of-type(2)').evaluate(e=>{const b=e.getBoundingClientRect(),frame=e.closest('.urban-hero-photo').getBoundingClientRect();return {left:b.left-frame.left,top:b.top-frame.top,right:b.right-frame.left};});
   check('Hero badge inset left '+width,badge.left>=40,true);check('Hero badge inset top '+width,badge.top>=70,true);
   check('Hero image loads '+width,await page.locator('.urban-hero-photo img').evaluate(e=>e.complete&&e.naturalWidth>0),true);
   check('No horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   check('User nav contains bookings '+width,await page.locator('header nav').getByRole('link',{name:'Đơn thuê của tôi',exact:true}).isVisible(),true);
   await page.screenshot({path:path.join(out,'homepage-'+width+'.png'),fullPage:true});
  }
  await page.locator('header nav').getByRole('link',{name:'Tìm xe',exact:true}).click();await page.waitForURL('**/vehicles');
  await page.getByRole('heading',{name:'Danh sách xe',exact:true}).waitFor();
  check('Active nav marked',await page.locator('header nav').getByRole('link',{name:'Tìm xe',exact:true}).getAttribute('aria-current'),'page');
  await page.locator('header nav').getByRole('link',{name:'Hồ sơ & GPLX',exact:true}).click();await page.waitForURL('**/user/profile');
  await page.getByLabel('Mật khẩu hiện tại',{exact:true}).waitFor();check('Email remains read-only',await page.getByLabel('Email',{exact:true}).getAttribute('readonly'),'');
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(out,'profile-1440.png'),fullPage:true});
  await page.getByLabel('Mật khẩu hiện tại',{exact:true}).fill('A strong browser password 2026!');await page.getByLabel('Mật khẩu mới',{exact:true}).fill('Next strong browser password 2026!');await page.getByLabel('Nhập lại mật khẩu mới',{exact:true}).fill('Mismatch browser password 2026!');
  let puts=0;page.on('request',r=>{if(r.url().endsWith('/me/password')&&r.method()==='PUT')puts++;});
  await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();await page.getByText('Mật khẩu nhập lại chưa khớp.',{exact:true}).waitFor();check('Mismatch causes no password write',puts,0);
  const oldToken=await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
  await page.getByLabel('Nhập lại mật khẩu mới',{exact:true}).fill('Next strong browser password 2026!');
  await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();await page.waitForURL('**/login');
  check('Current device logged out',await page.evaluate(()=>localStorage.getItem('kdrive.jwt')),null);
  check('Old token actually denied',(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+oldToken}})).status,401);
  check('One password write',puts,1);
  async function customerLogin(){
   await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mật khẩu',{exact:true}).fill('Next strong browser password 2026!');
   await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(url=>url.pathname==='/'||url.pathname==='/user/profile');
   await page.goto(base+'/');await page.getByRole('heading',{name:/Mỗi chuyến đi/}).waitFor();
   return await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
  }
  async function clickLogout(){await page.getByRole('button',{name:'Fixture Browser',exact:true}).click();await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.waitForURL('**/login',{waitUntil:'commit'});await page.getByRole('heading',{name:'Đăng nhập',exact:true}).waitFor();}
  const successToken=await customerLogin();
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/auth/logout',async route=>{await gate;await route.continue();});
  const logoutResponse=page.waitForResponse(r=>r.url().endsWith('/auth/logout')).catch(()=>null);
  await clickLogout();check('Pending logout already clears device',await page.evaluate(()=>localStorage.getItem('kdrive.jwt')),null);
  check('Pending logout renders guest login link',await page.locator('header').getByRole('link',{name:'Đăng nhập',exact:true}).isVisible(),true);
  release();const response=await logoutResponse;assert.ok(response,'Actual logout response required');check('Logout response status',response.status(),204);await page.unroute('**/auth/logout');
  check('Successful logout actually revokes JWT',(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+successToken}})).status,401);
  await page.screenshot({path:path.join(out,'logout-success-1440.png'),fullPage:true});
  for(const kind of ['server-error','network-error','forbidden','expired']){
   const token=await customerLogin();
   await page.route('**/auth/logout',route=>kind==='network-error'?route.abort('failed'):route.fulfill({status:kind==='expired'?401:kind==='forbidden'?403:500,contentType:'application/json',body:'{"message":"Injected logout failure"}'}));
   await clickLogout();check('Failed logout clears device '+kind,await page.evaluate(()=>localStorage.getItem('kdrive.jwt')),null);
   check('Failed logout removes stored user '+kind,await page.evaluate(()=>localStorage.getItem('kdrive.user')),null);
   if(kind!=='expired'){
    await page.getByText(/Đã đăng xuất trên thiết bị này.*Chưa xác nhận/).waitFor();
    check('Warning persists after navigation '+kind,await page.getByRole('alert').filter({hasText:'Chưa xác nhận'}).isVisible(),true);
    check('Failed revocation not falsely claimed '+kind,(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+token}})).status,200);
    await page.screenshot({path:path.join(out,'logout-'+kind+'-1440.png'),fullPage:true});
   }
   await page.unroute('**/auth/logout');
  }
  await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill('admin@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill('AuthSecurityOnly123!');
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL('**/admin');
  const adminSession=await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
  const workspaceLogout=page.waitForResponse(r=>r.url().endsWith('/auth/logout')&&r.status()===204);
  await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.waitForURL('**/login');await workspaceLogout;
  check('Workspace logout clears device',await page.evaluate(()=>localStorage.getItem('kdrive.jwt')),null);
  check('Workspace JWT revoked',(await fetch(api+'/auth/me',{headers:{authorization:'Bearer '+adminSession}})).status,401);
  check('No runtime errors',errors,[]);
  fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));
 }catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});fs.writeFileSync(path.join(out,'failure-dom.txt'),await page.locator('body').innerText());}throw error;}
 finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
