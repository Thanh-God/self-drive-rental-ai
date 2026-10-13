const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.C11_PLAYWRIGHT);
const base = 'http://127.0.0.1:5297', api = 'http://127.0.0.1:8297/api/v1';
const out = process.env.C11_EVIDENCE;
const checks = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push({name, actual, expected}); }
async function login(email) {
  const r = await fetch(api+'/auth/login', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'LocationApiTestOnly123!'})});
  assert.equal(r.status,200); return (await r.json()).token;
}
async function main() {
  const token = await login('admin@example.test');
  const headers = {'content-type':'application/json',authorization:'Bearer '+token};
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(t=>localStorage.setItem('kdrive.jwt',t),token);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  try {
    let failedLoad=false;
    await page.route('**/admin/location-categories',async route=>{
      if(route.request().method()==='GET' && !failedLoad) {failedLoad=true; return route.abort('failed');}
      return route.continue();
    });
    await page.goto(base+'/admin/locations');
    await page.getByRole('button',{name:'Thử tải lại',exact:true}).first().waitFor();
    check('Transport failure is not represented as empty success',await page.getByText(/Chưa có địa điểm/).count(),0);
    await page.getByRole('button',{name:'Thử tải lại',exact:true}).first().click();
    await page.getByRole('heading',{name:'Địa điểm tham quan',exact:true}).waitFor();
    await page.unroute('**/admin/location-categories');
    await page.getByText(/Chưa có địa điểm/).waitFor();
    check('Fresh MySQL empty locations',(await(await fetch(api+'/admin/locations',{headers})).json()).length,0);
    check('Real location page URL',page.url(),base+'/admin/locations');
    check('No framework error overlay',await page.locator('vite-error-overlay').count(),0);
    await page.getByRole('tab',{name:/Loại địa điểm/}).click();
    await page.getByText(/Chưa có loại địa điểm/).waitFor();
    check('Fresh MySQL empty categories',(await(await fetch(api+'/admin/location-categories',{headers})).json()).length,0);
    const input = page.locator('input[name="categoryName"]');
    await input.fill('Browser category');
    let release, reached;
    const hold = new Promise(r=>release=r), ready = new Promise(r=>reached=r);
    let writes=0;
    await page.route('**/admin/location-categories',async route=>{
      if(route.request().method()!=='POST') return route.continue();
      writes++; const response=await route.fetch(); reached(); await hold; await route.fulfill({response});
    });
    await page.getByRole('button',{name:'Tạo loại',exact:true}).click();
    await Promise.race([ready,new Promise((_,r)=>setTimeout(()=>r(new Error('pending deadline')),15000))]);
    check('Pending button disabled',await page.getByRole('button',{name:'Đang lưu...',exact:true}).isDisabled(),true);
    await page.locator('form').evaluate(f=>{f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    check('Duplicate submission blocked',writes,1); release();
    await page.getByText('Đã tạo loại địa điểm.',{exact:true}).waitFor();
    await page.unroute('**/admin/location-categories');
    let category=(await(await fetch(api+'/admin/location-categories',{headers})).json()).find(c=>c.name==='Browser category');
    const edit = page.getByTestId('edit-category-'+category.id);
    await edit.click(); await input.fill('Browser edited');
    await page.getByRole('button',{name:'Lưu loại',exact:true}).click();
    await page.getByText('Đã cập nhật loại địa điểm.',{exact:true}).waitFor();
    category=(await(await fetch(api+'/admin/location-categories',{headers})).json()).find(c=>c.id===category.id);
    check('Actual API category edit',category.name,'Browser edited');
    await edit.click();
    const concurrent=await fetch(api+'/admin/location-categories/'+category.id,{method:'PUT',headers,body:JSON.stringify({name:'External edit',expectedRevision:category.revision})});
    check('External update 200',concurrent.status,200);
    await input.fill('Stale browser'); await page.getByRole('button',{name:'Lưu loại',exact:true}).click();
    await page.getByText(/Danh mục đã thay đổi/).waitFor();
    check('No false success after stale',await page.getByText('Đã cập nhật loại địa điểm.',{exact:true}).count(),0);
    await page.getByText('External edit',{exact:true}).waitFor();
    await edit.click(); await input.fill('Browser recovered');
    await page.getByRole('button',{name:'Lưu loại',exact:true}).click();
    await page.getByText('Đã cập nhật loại địa điểm.',{exact:true}).waitFor();
    await page.getByRole('tab',{name:/^Địa điểm/}).click();
    await page.locator('input[name="locationName"]').fill('Browser location');
    await page.locator('select[name="categoryId"]').selectOption(category.id);
    await page.locator('input[name="latitude"]').fill('0.12345678');
    await page.locator('input[name="longitude"]').fill('0');
    await page.getByRole('button',{name:'Tạo địa điểm',exact:true}).click();
    await page.getByRole('alert').waitFor();
    check('400 preserves coordinates',await page.locator('input[name="latitude"]').inputValue(),'0.12345678');
    await page.locator('input[name="latitude"]').fill('0');
    await page.getByRole('button',{name:'Tạo địa điểm',exact:true}).click();
    await page.getByText('Đã tạo địa điểm.',{exact:true}).waitFor();
    let location=(await(await fetch(api+'/admin/locations',{headers})).json()).find(l=>l.name==='Browser location');
    assert.ok(location);
    await page.getByTestId('edit-location-'+location.id).click();
    await page.locator('select[name="status"]').selectOption('INACTIVE');
    await page.locator('input[name="locationName"]').fill('Browser inactive');
    await page.getByRole('button',{name:'Lưu địa điểm',exact:true}).click();
    await page.getByText('Đã cập nhật địa điểm.',{exact:true}).waitFor();
    await page.reload(); await page.getByText('Browser inactive',{exact:true}).waitFor();
    location=await(await fetch(api+'/admin/locations/'+location.id,{headers})).json();
    check('Persistence after browser refresh',location.status,'INACTIVE');
    check('Category rename FK readback',location.categoryName,'Browser recovered');
    const payload={categoryId:location.categoryId,name:'Race location',latitude:0,longitude:0,status:'INACTIVE',expectedRevision:location.revision};
    const raced=await Promise.all([0,1].map(i=>fetch(api+'/admin/locations/'+location.id,{method:'PUT',headers,body:JSON.stringify({...payload,name:'Race location '+i})})));
    check('Location same-revision race',raced.map(r=>r.status).sort(),[200,409]);
    const fresh=await(await fetch(api+'/admin/locations/'+location.id,{headers})).json();
    const recovered=await fetch(api+'/admin/locations/'+location.id,{method:'PUT',headers,body:JSON.stringify({...payload,name:'Browser inactive',expectedRevision:fresh.revision})});
    check('Location fresh-revision recovery',recovered.status,200);
    await page.reload();await page.getByText('Browser inactive',{exact:true}).waitFor();
    for(const width of [1280,1440,1920]) {
      await page.setViewportSize({width,height:1000});
      check('No overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(out,'locations-'+width+'.png'),fullPage:true});
    }
    await page.goto(base+'/admin/catalog'); await page.getByRole('heading',{name:/Danh mục/}).first().waitFor();
    check('Catalog route preserved',page.url(),base+'/admin/catalog');
    await page.goto(base+'/admin/branches'); await page.getByRole('heading',{name:/Chi nhánh/}).first().waitFor();
    check('Branches route preserved',page.url(),base+'/admin/branches');
    const userToken=await login('user@example.test');
    const uc=await browser.newContext(); await uc.addInitScript(t=>localStorage.setItem('kdrive.jwt',t),userToken);
    const up=await uc.newPage(); await up.goto(base+'/admin/locations');
    await up.waitForURL('**/unauthorized'); check('USER UI protected',new URL(up.url()).pathname,'/unauthorized');
    check('No JavaScript errors',errors,[]);
    fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));
  } catch (error) {
    fs.writeFileSync(path.join(out,'failure-dom.txt'), await page.locator('body').innerText());
    await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});
    throw error;
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
