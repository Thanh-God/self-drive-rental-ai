// Native two-tab identity proof. No API interception; fixture-only accounts/data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.KDRIVE_PLAYWRIGHT);
async function main() {
 const out=process.env.OTO2_EVIDENCE, origin='http://127.0.0.1:5382', checks=[], errors=[];
 assert.ok(fs.existsSync(path.join(out,'fixture-readback.json')));
 const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext(), a=await context.newPage(), b=await context.newPage();
  for(const p of [a,b]) {p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));}
  async function login(p,email) {
   await p.goto(origin+(email==='user@example.test'?'/login':'/vehicles'));
   // A shared existing identity redirects /login; use direct API only in tab B to
   // establish another identity, exactly the same storage commit as UI login.
   if(email!=='user@example.test') {
    await p.evaluate(async ({email,password})=>{
     const {loginRequest}=await import('/src/api/auth.js');
     const {storeSession}=await import('/src/utils/storage.js');
     const result=await loginRequest({email,password});
     if(storeSession(result.token,result.user).issue)throw new Error('Fixture login persistence failed');
    },{email,password:process.env.OTO2_SEED_PASSWORD});
    await p.reload();
   } else {
    await p.getByLabel('Email',{exact:true}).fill(email);
    await p.getByLabel('Mật khẩu',{exact:true}).fill(process.env.OTO2_SEED_PASSWORD);
    await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await p.waitForURL(url=>url.pathname!=='/login');
   }
   return p.evaluate(async()=>{
    const response=await fetch('/api/v1/auth/me',{headers:{Authorization:'Bearer '+localStorage.getItem('kdrive.jwt')}});
    if(!response.ok)throw new Error('Fixture identity unavailable');
    const {id,fullName,role}=await response.json();return{id,fullName,role};
   });
  }
  const userA=await login(a,'user@example.test');
  const originalAToken=await a.evaluate(()=>localStorage.getItem('kdrive.jwt'));
  await a.goto(origin+'/vehicles');
  await a.getByRole('button',{name:'Yêu thích Toyota Vios',exact:true}).click();
  await a.goto(origin+'/vehicles/favorites');await a.locator('.vehicle-card').waitFor();
  await a.evaluate(()=>{window.__r1bEvents=0;window.addEventListener('storage',e=>{if(e.key==='kdrive.jwt')window.__r1bEvents++;});});
  const userB=await login(b,'staff.dn@example.test');
  check('fixture accounts distinct',userA.id!==userB.id);
  await a.waitForFunction(()=>window.__r1bEvents>0);
  if(process.env.R1B_REPRO_BASELINE==='1') {
   check('baseline tab A still shows old account',await a.locator('header').innerText().then(text=>text.includes(userA.fullName)));
   const actual=await a.evaluate(async()=>{const {apiClient}=await import('/src/api/client.js');return(await apiClient.get('/auth/me')).data.id;});
   check('baseline client sends new account credential',actual,userB.id);
   check('baseline favorites still from old account',await a.locator('.vehicle-card h2').first().textContent(),'Toyota Vios');
  } else {
   await a.getByRole('button',{name:userB.fullName,exact:true}).waitFor();
   check('tab A hides old account',!(await a.locator('header').innerText()).includes(userA.fullName));
   await a.getByText('Chưa có xe yêu thích.',{exact:false}).waitFor();
   check('new account does not inherit favorites',await a.locator('.vehicle-card').count(),0);
   await b.goto(origin+'/vehicles');
   await b.getByRole('button',{name:'Yêu thích Hyundai Accent',exact:true}).click();
   await a.getByRole('button',{name:'Bỏ yêu thích Hyundai Accent',exact:true}).waitFor();
   check('new B favorites update in A tab',await a.locator('.vehicle-card h2').textContent(),'Hyundai Accent');
   await b.locator('header button[aria-expanded]:not([aria-label="Mở menu"])').click();
   const revoked=b.waitForResponse(r=>r.url().endsWith('/api/v1/auth/logout')&&r.request().method()==='POST');
   await b.getByRole('button',{name:'Đăng xuất',exact:true}).filter({visible:true}).click();
   check('B logout completes', (await revoked).status(),204);
   await a.locator('header').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
   await a.getByText('Chưa có xe yêu thích.',{exact:false}).waitFor();
   check('external logout gives guest scope',await a.locator('.vehicle-card').count(),0);
   check('external sync did not revoke original A',await a.evaluate(async token=>{
    const response=await fetch('/api/v1/auth/me',{headers:{Authorization:'Bearer '+token}});return response.status;
   },originalAToken),200);
   await login(b,'user@example.test');
   await a.getByRole('button',{name:userA.fullName,exact:true}).waitFor();
   await a.getByRole('button',{name:'Bỏ yêu thích Toyota Vios',exact:true}).waitFor();
   check('relogin restores A scope',await a.locator('.vehicle-card h2').textContent(),'Toyota Vios');
   const isolated=await browser.newContext(), c=await isolated.newPage();
   c.setDefaultTimeout(15000);c.on('pageerror',e=>errors.push(e.message));
   const isolatedB=await login(c,'staff.dn@example.test');
   check('independent profile has B',isolatedB.id,userB.id);
   check('independent profile leaves shared A unchanged',await a.evaluate(async()=>{
    const {apiClient}=await import('/src/api/client.js');return(await apiClient.get('/auth/me')).data.id;
   }),userA.id);
   await b.evaluate(()=>localStorage.clear());
   await a.locator('header').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
   await a.getByText('Chưa có xe yêu thích.',{exact:false}).waitFor();
   check('native storage clear hides A data/favorites',await a.locator('.vehicle-card').count(),0);
   check('clear in shared context leaves isolated profile authenticated',await c.evaluate(async()=>{
    const {apiClient}=await import('/src/api/client.js');return(await apiClient.get('/auth/me')).data.id;
   }),userB.id);
   await isolated.close();
  }
  check('runtime errors absent',errors,[]);
 } finally {
  await browser.close();
  fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({mode:process.env.R1B_REPRO_BASELINE==='1'?'baseline defect reproduction':'fixed proof',checks,errors,apiMocks:false,stage6:false},null,2));
 }
 console.log('PASS R1b '+checks.length+' assertions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
