const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
async function main(){
 const out=process.env.OTO2_EVIDENCE,checks=[],errors=[];assert.ok(fs.existsSync(path.join(out,'fixture-readback.json')));
 const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 const api='http://127.0.0.1:8382/api/v1';
 async function http(method,url,body,token){const r=await fetch(api+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();}
 const admin=await http('POST','/auth/login',{email:'admin@example.test',password:process.env.OTO2_SEED_PASSWORD});
 const records=await http('GET','/vehicles');await http('POST','/admin/vehicles',{...records[0],id:null,name:'R3a Fixture Car',plate:'R3A-LAYOUT',dailyPrice:700000,version:0},admin.token);
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:5382/vehicles?sort=price-asc');await p.locator('.vehicle-card').nth(3).waitFor();
  check('Empty tray absent',await p.getByRole('complementary',{name:'Lựa chọn so sánh'}).count(),0);
  check('Compare entry at zero',await p.getByRole('link',{name:'So sánh xe (0)',exact:true}).count(),1);
  check('Privacy collapsed',await p.locator('.favorites-privacy').evaluate(el=>!el.open));
  check('Card information precedes secondary actions',await p.locator('.vehicle-card').first().evaluate(el=>Boolean(el.firstElementChild.querySelector('h2'))));
  check('Operating state truthful',await p.locator('.vehicle-card').first().textContent().then(t=>t.includes('Đang khai thác')&&!t.includes('Sẵn sàng thuê')));
  check('Toolbar secondary surface',await p.locator('.vehicle-list-tools a.btn-secondary').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  check('Primary detail orange',await p.locator('.vehicle-card a.btn').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 126, 51)');
  check('Secondary targets at least 44px',await p.locator('.vehicle-card-actions button').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=44)));
  const names=await p.locator('.vehicle-card h2').allTextContents();assert.ok(names.length>=3);
  await p.getByRole('button',{name:'Yêu thích '+names[0],exact:true}).click();
  check('Favorite entry updates',await p.getByRole('link',{name:'Xe yêu thích (1)',exact:true}).count(),1);
  for(const name of names.slice(0,3))await p.getByRole('button',{name:'So sánh '+name,exact:true}).click();
  await p.getByText('Đã chọn 3/3 xe',{exact:false}).waitFor();
  check('Selected chips',await p.locator('.compare-selection-chips button').count(),3);
  if(names.length>3){await p.getByRole('button',{name:'So sánh '+names[3],exact:true}).click();await p.getByText('Hãy bỏ một xe',{exact:false}).waitFor();check('Fourth refused',new URL(p.url()).searchParams.get('compare').split(',').length,3);}
  await p.evaluate(()=>scrollTo(0,0));
  await p.screenshot({path:path.join(out,'list-selected-1440.png'),fullPage:true});
  await p.getByRole('button',{name:'Bỏ '+names[0]+' khỏi lựa chọn so sánh',exact:true}).focus();await p.keyboard.press('Enter');
  check('Keyboard removal returns focus',await p.getByRole('link',{name:'So sánh xe (2)',exact:true}).evaluate(el=>el===document.activeElement));
  check('Sort preserved',new URL(p.url()).searchParams.get('sort'),'price-asc');
  await p.getByRole('button',{name:'Bỏ tất cả xe',exact:true}).click();
  await p.getByRole('complementary',{name:'Lựa chọn so sánh'}).waitFor({state:'detached'});
  check('Cleared tray absent',await p.getByRole('complementary',{name:'Lựa chọn so sánh'}).count(),0);
  check('Clear focus preserved',await p.getByRole('link',{name:'So sánh xe (0)',exact:true}).evaluate(el=>el===document.activeElement));
  for(const width of [1440,1280]){await p.setViewportSize({width,height:1000});check('No overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'list-'+width+'.png'),fullPage:true});}
  await p.getByRole('link',{name:'Xe yêu thích (1)',exact:true}).click();await p.getByRole('heading',{name:'Xe yêu thích',exact:true}).waitFor();await p.locator('.vehicle-card').waitFor();check('Favorite API record survives navigation',await p.locator('.vehicle-card h2').textContent(),names[0]);
  await p.goto('http://127.0.0.1:5382/vehicles?compare=..%2Fbad');await p.getByRole('complementary',{name:'Lựa chọn so sánh'}).getByRole('status').waitFor();check('Invalid selection reported',true);
  const day=new Date(Date.now()+5*86400000),start=day.toISOString().slice(0,10),end=new Date(day.getTime()+2*86400000).toISOString().slice(0,10);
  const query=new URLSearchParams({start,end,pickupBranchId:'dn',returnBranchId:'dn',sort:'price-asc'});
  await p.goto('http://127.0.0.1:5382/vehicles?'+query);await p.getByText('Tổng chuyến:',{exact:false}).first().waitFor();
  const apiQuery=new URLSearchParams({pickupDate:start,returnDate:end,pickupBranchId:'dn',returnBranchId:'dn'});
  const response=await context.request.get('http://127.0.0.1:8382/api/v1/vehicles/search?'+apiQuery);assert.ok(response.ok());const result=await response.json();assert.ok(result.items.length);
  for(const item of result.items){const card=p.locator('.vehicle-card').filter({has:p.getByRole('heading',{name:item.vehicle.name,exact:true})});check('Server trip total '+item.vehicle.id,(await card.textContent()).includes(Number(item.total).toLocaleString('vi-VN')));const href=await card.locator('a.btn').getAttribute('href');check('Trip preserved '+item.vehicle.id,new URL(href,'http://localhost').searchParams.get('start'),start);}
  await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'list-trip-1280.png'),fullPage:true});
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,mobileDeferredByUser:true},null,2));}
 console.log('PASS R3a desktop '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
