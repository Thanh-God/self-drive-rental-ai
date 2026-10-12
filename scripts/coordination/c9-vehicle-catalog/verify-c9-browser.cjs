const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deferred, dispatcher, bounded, assertNoUnexpected } = require('../c8-account-assignment-browser/browser-controls.cjs');
const { chromium } = require(process.env.C9_PLAYWRIGHT_MODULE);
const base = process.env.C9_BASE_URL, api = process.env.C9_API_BASE_URL;
const evidence = process.env.C9_EVIDENCE_DIR, schema = process.env.C9_SCHEMA;
const checks = [], http = [], consoleIssues = [], expected = [];
let browser;
function record(name, actual, wanted) { assert.deepEqual(actual, wanted, name); checks.push({name, actual, expected:wanted, passed:true}); console.log(`PASS ${name}`); }
function sql(query) {
  const result = spawnSync('docker',['exec','-e',`MYSQL_PWD=${process.env.C9_DB_PASSWORD}`,process.env.C9_CONTAINER,'mysql','-uroot','--batch','--raw','--skip-column-names','-e',`USE ${schema}; ${query}`],{encoding:'utf8'});
  assert.equal(result.status,0,'SQL command must succeed'); return result.stdout.trim();
}
const q = value => `'${String(value).replaceAll("'","''")}'`;
async function main() {
  assert.match(schema,/^kdrive_c9_[a-f0-9]+$/);
  record('Isolated marker',sql(`SELECT COUNT(*) FROM ${process.env.C9_MARKER_SCHEMA}.__kdrive_test_fixture_marker WHERE target_schema=${q(schema)} AND marker_token=${q(process.env.C9_MARKER_TOKEN)};`),'1');
  const login = await fetch(`${api}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@example.test',password:process.env.C9_SEED_PASSWORD})});
  record('Admin login',login.status,200); const {token}=await login.json();
  const headers={'content-type':'application/json',authorization:`Bearer ${token}`};
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.addInitScript(token=>{if(!localStorage.getItem('kdrive.jwt'))localStorage.setItem('kdrive.jwt',token);},token);
  const scenarios=new Map(); await context.route('**/api/v1/**',dispatcher(scenarios));
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('response',r=>{if(r.status()>=400)http.push({method:r.request().method(),url:r.url(),status:r.status()});});
  page.on('requestfailed',r=>http.push({method:r.method(),url:r.url(),failure:r.failure()?.errorText}));
  page.on('pageerror',e=>consoleIssues.push({type:'pageerror',text:e.message}));
  page.on('console',m=>{if(m.type()==='error')consoleIssues.push({type:'console',text:m.text(),url:m.location().url});});
  await page.goto(`${base}/admin/catalog`);await page.getByRole('heading',{name:'Danh mục xe',exact:true}).waitFor();
  record('Catalog route contains no branch management heading',await page.getByRole('heading',{name:'Chi nhánh & tuyến nhận/trả',exact:true}).count(),0);
  const created=[];
  for(const [kind,title,table] of [['vehicle-brands','Hãng xe','vehicle_brands'],['vehicle-categories','Loại xe','vehicle_categories']]) {
    const section=page.getByRole('region',{name:title,exact:true});const form=section.locator('form');const name=`Browser ${kind} ${Date.now()}`;
    await form.locator('input').fill(name);const key=`POST ${base}/api/v1/admin/${kind}`;
    const reached=deferred(),release=deferred(),finished=deferred();scenarios.set(key,{reached,release,finished,count:0});
    await form.getByRole('button',{name:'Tạo mới',exact:true}).click();await bounded(reached.promise,'POST reached real backend');
    record(`${kind} busy`,await form.getByRole('button',{name:'Đang lưu...',exact:true}).isDisabled(),true);
    await form.evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    record(`${kind} one pending POST`,scenarios.get(key).count,1);release.resolve();await bounded(finished.promise,'POST released');scenarios.delete(key);
    await section.getByText(name,{exact:true}).waitFor();record(`${kind} persisted one row`,sql(`SELECT COUNT(*) FROM ${table} WHERE name=${q(name)};`),'1');
    await form.locator('input').fill(name);expected.push({method:'POST',url:`${base}/api/v1/admin/${kind}`,status:409});
    await form.getByRole('button',{name:'Tạo mới',exact:true}).click();await section.getByText('Tên danh mục đã tồn tại.',{exact:true}).waitFor();
    record(`${kind} duplicate preserved row`,sql(`SELECT COUNT(*) FROM ${table} WHERE name=${q(name)};`),'1');
    await form.locator('input').fill('   ');expected.push({method:'POST',url:`${base}/api/v1/admin/${kind}`,status:400});
    const beforeInvalid=sql(`SELECT COUNT(*) FROM ${table};`);
    await form.getByRole('button',{name:'Tạo mới',exact:true}).click();await section.getByText('Tên phải có từ 1 đến 100 ký tự.',{exact:true}).waitFor();
    record(`${kind} invalid UI create does not write`,sql(`SELECT COUNT(*) FROM ${table};`),beforeInvalid);
    record(`${kind} invalid UI preserves input`,await form.locator('input').inputValue(),'   ');
    await section.getByRole('button',{name:`Sửa ${name}`,exact:true}).click();
    const list=await fetch(`${api}/admin/${kind}`,{headers});const item=(await list.json()).find(row=>row.name===name);
    const renamed=`Updated ${name}`;const edited=await fetch(`${api}/admin/${kind}/${item.id}`,{method:'PUT',headers,body:JSON.stringify({name:renamed,expectedRevision:item.revision})});record(`${kind} concurrent operator update`,edited.status,200);
    await form.locator('input').fill(`Stale ${name}`);expected.push({method:'PUT',url:`${base}/api/v1/admin/${kind}/${item.id}`,status:409});
    await form.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await section.getByText('Danh mục đã thay đổi. Vui lòng tải lại.',{exact:true}).waitFor();
    record(`${kind} stale no overwrite`,sql(`SELECT name FROM ${table} WHERE id=${q(item.id)};`),renamed);
    await form.getByRole('button',{name:'Tải lại bản mới',exact:true}).click();await section.getByText(renamed,{exact:true}).waitFor();
    await section.getByRole('button',{name:`Sửa ${renamed}`,exact:true}).click();const final=`Final ${name}`;await section.locator('form input').fill(final);
    const putKey=`PUT ${base}/api/v1/admin/${kind}/${item.id}`;const pr=deferred(),pl=deferred(),pf=deferred();scenarios.set(putKey,{reached:pr,release:pl,finished:pf,count:0});
    await section.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await bounded(pr.promise,'PUT reached');await section.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    record(`${kind} one pending PUT`,scenarios.get(putKey).count,1);pl.resolve();await bounded(pf.promise,'PUT finished');scenarios.delete(putKey);await section.getByText(final,{exact:true}).waitFor();
    created.push({kind,id:item.id,name:final});
    record(`${kind} update SQL`,sql(`SELECT name FROM ${table} WHERE id=${q(item.id)};`),final);
    await page.waitForLoadState("networkidle");await page.reload();await section.getByText(final,{exact:true}).waitFor();record(`${kind} reload persistence`,true,true);
    const getKey=`GET ${base}/api/v1/admin/${kind}`;scenarios.set(getKey,{error:500,message:'Catalog read control',count:0});expected.push({method:'GET',url:`${base}/api/v1/admin/${kind}`,status:500});
    await page.waitForLoadState("networkidle");await page.reload();await section.getByText('Catalog read control',{exact:true}).waitFor();scenarios.delete(getKey);await section.getByRole('button',{name:'Thử tải lại',exact:true}).click();await section.getByText(final,{exact:true}).waitFor();record(`${kind} real retry restores data`,true,true);
  }
  await page.screenshot({path:path.join(evidence,'catalog-page.png'),fullPage:true});
  for(const role of ['USER','STAFF']) {
    const email=sql(`SELECT email FROM users WHERE role=${q(role)} AND status='ACTIVE' ORDER BY id LIMIT 1;`);
    const response=await fetch(`${api}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:process.env.C9_SEED_PASSWORD})});record(`${role} login verified`,response.status,200);
    const session=await response.json();record(`${role} session role verified`,session.user.role,role);
    const peer=await browser.newContext();await peer.addInitScript(token=>localStorage.setItem('kdrive.jwt',token),session.token);await peer.route('**/api/v1/**',dispatcher(new Map()));
    const peerPage=await peer.newPage();await peerPage.goto(`${base}/admin/catalog`);await peerPage.waitForURL(url=>url.pathname!=='/admin/catalog');
    record(`${role} cannot see catalog heading`,await peerPage.getByRole('heading',{name:'Danh mục xe',exact:true}).count(),0);
    await peerPage.waitForLoadState('networkidle');await peer.close();
  }
  const guest=await browser.newContext();const guestPage=await guest.newPage();await guestPage.goto(`${base}/admin/catalog`);await guestPage.waitForURL('**/login');record('Guest catalog redirects login',new URL(guestPage.url()).pathname,'/login');await guestPage.waitForLoadState('networkidle');await guest.close();
  await page.waitForLoadState("networkidle");await page.goto(`${base}/admin/branches`);await page.getByRole('heading',{name:'Chi nhánh & tuyến nhận/trả',exact:true}).waitFor();record('Branch management preserved at separate route',true,true);
  await page.waitForLoadState('networkidle');await page.goto(`${base}/admin/vehicles`);for(const [kind,label] of [['vehicle-brands','Hãng xe'],['vehicle-categories','Loại xe']]) {
    const item=created.find(row=>row.kind===kind);const option=page.getByLabel(label,{exact:true}).locator(`option[value="${item.id}"]`);
    await option.waitFor({state:'attached'});record(`${kind} new ID and label propagated into vehicle form`,await option.textContent(),item.name);
  }
  await page.waitForLoadState('networkidle');assertNoUnexpected(http,consoleIssues,expected);record('No unexpected HTTP or console failures',true,true);
  for(const [file,data] of [['browser-checks.json',checks],['browser-http.json',http],['browser-console.json',consoleIssues]])fs.writeFileSync(path.join(evidence,file),JSON.stringify(data,null,2));
  await page.screenshot({path:path.join(evidence,'catalog-integration.png'),fullPage:true});await browser.close();console.log(`ALL ${checks.length} C9 BROWSER CHECKS PASSED`);
}
main().catch(error=>{console.error(error);fs.writeFileSync(path.join(evidence,'browser-failure.json'),JSON.stringify({error:error.message,checks,http,consoleIssues},null,2));if(browser)browser.close().catch(()=>{});process.exitCode=1;});
