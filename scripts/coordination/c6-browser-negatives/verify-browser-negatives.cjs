const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { assertSections, assertUnchanged, assertSafeDom, assertConsoleHealth } = require('./evidence-contract.cjs');
const root = path.resolve(__dirname, '../../..');
const runDir = process.env.RUN_DIR || process.argv[2];
if (!runDir || !fs.statSync(runDir).isDirectory()) throw Error('Explicit existing RUN_DIR required');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.runtime/phase5-rerun-20261004-1823/browsers');
const { chromium } = require(path.join(root, '.runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright'));
const base = process.env.BASE_URL || 'http://127.0.0.1:5226';
const container = process.env.C6_FIXTURE_CONTAINER;
const schema = process.env.C6_FIXTURE_SCHEMA;
const meta = process.env.C6_FIXTURE_MARKER_SCHEMA;
if (!/^kltn-c6-browser-neg-[a-f0-9]{12}$/.test(container || '') || schema !== 'kdrive_c6_browser_neg' || meta !== `${schema}_meta`) throw Error('Isolated fixture identity required');
const sections = {};
const result = { TestSuite:'C6 F01/F03 real browser', sections, AllAssertionsPassed:false };
const events = [];
const save = (name, data) => fs.writeFileSync(path.join(runDir, name), JSON.stringify(data,null,2));
// Password stays inside container; it is never part of the command arguments or evidence.
function sql(query) {
  const p = spawnSync('docker', ['exec','-i',container,'sh','-c',`MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --skip-column-names --default-character-set=utf8mb4 --database=${schema}`], {input:query,encoding:'utf8',timeout:15000});
  if(p.error || p.status !== 0) throw Error(`SQL readback failed exit=${p.status}`);
  return p.stdout.trim();
}
assert.equal(sql(`SELECT marker_token FROM ${meta}.__kdrive_test_fixture_marker WHERE id=1 AND target_schema='${schema}';`),process.env.C6_FIXTURE_MARKER_TOKEN);
function rows(booking) {
  assert.match(booking,/^c6-[a-z-]+$/);
  const raw=sql(`SELECT JSON_OBJECT('id',id,'booking_id',booking_id,'rating',rating,'content',content,'hidden',hidden,'created_at',created_at,'moderated_by',moderated_by,'moderated_at',moderated_at,'version',version) FROM reviews WHERE booking_id='${booking}' ORDER BY id;`);
  return raw ? raw.split('\n').map(line=>JSON.parse(line)) : [];
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function visible(locator) { await locator.waitFor({state:'visible',timeout:15000}); }
async function absent(locator) { assert.equal(await locator.count(),0); }
async function main() {
 const browser=await chromium.launch({headless:true});
 const contexts=[];
 const faults=[];
 try {
  async function session(role='user') {
   const context=await browser.newContext({viewport:{width:1365,height:900}});contexts.push(context);
   await context.addInitScript(()=>{window.__xssScriptExecuted=false;window.__xssImageExecuted=false;});
   const page=await context.newPage();
   page.on('pageerror',e=>faults.push({type:'pageerror',message:e.message}));
   page.on('console',m=>{if(m.type()==='error')faults.push({type:'console',message:m.text()});});
   page.on('response',r=>{const u=new URL(r.url());if(u.pathname.includes('/review'))events.push({method:r.request().method(),path:u.pathname,status:r.status()});});
   if(role !== 'guest') {
    await page.goto(`${base}/login`);
    await page.locator('input[type=email]').fill(`${role}@example.test`);
    await page.locator('input[type=password]').fill(process.env.SEED_PASSWORD);
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await page.waitForFunction(()=>!!localStorage.getItem('kdrive.jwt'));
   }
   return page;
  }
  async function booking(page,id){await page.goto(`${base}/user/bookings/${id}`);await visible(page.getByRole('heading',{name:'Thông tin thuê',exact:true}));}
  const form=page=>page.locator('form').filter({has:page.getByRole('heading',{name:'Đánh giá chuyến thuê',exact:true})});
  const own=page=>page.locator('section').filter({has:page.getByRole('heading',{name:'Đánh giá của bạn',exact:true})});
  async function submit(page,id,content) {
   await booking(page,id);await visible(form(page));await form(page).locator('textarea').fill(content);
   const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/reviews')&&r.request().method()==='POST');
   await form(page).getByRole('button',{name:'Gửi đánh giá',exact:true}).click();
   assert.equal((await response).status(),200);await visible(own(page));
  }
  async function screenshot(page,name){assert.ok(await page.title());assert.equal(await page.locator('vite-error-overlay').count(),0);await page.screenshot({path:path.join(runDir,`${name}.png`),fullPage:true});}
  console.log('Held POST: backend commit while actual response held');
  const user=await session();await booking(user,'c6-held');await visible(form(user));
  const postReady=deferred(),postRelease=deferred();let posts=0;
  await user.route('**/api/v1/reviews',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   posts++;const response=await route.fetch();assert.equal(response.status(),200);postReady.resolve();
   await postRelease.promise;await route.fulfill({response});
  });
  await form(user).locator('textarea').fill('C6 held response persisted');
  await form(user).getByRole('button',{name:'Gửi đánh giá',exact:true}).click();await postReady.promise;
  await visible(form(user).getByRole('button',{name:'Đang gửi...',exact:true}));
  assert.equal(await form(user).getByRole('button').isDisabled(),true);
  const heldRows=rows('c6-held');assert.equal(heldRows.length,1);
  // A second real form submission while busy exercises the submit guard as well as disabled UI.
  await form(user).evaluate(el=>el.requestSubmit());
  await user.waitForTimeout(300);assert.equal(posts,1);assertUnchanged(heldRows,rows('c6-held'));
  await screenshot(user,'held-post');postRelease.resolve();await visible(own(user));await absent(form(user));
  await user.unroute('**/api/v1/reviews');await user.reload();await visible(own(user));assertUnchanged(heldRows,rows('c6-held'));
  sections.HeldReviewPost={BackendReachedBeforeRelease:true,Disabled:true,SecondSubmitBlocked:true,ExactlyOneRequestAndRow:true,ReloadPersisted:true};
  save('held-post-sql.json',{beforeRelease:heldRows,afterReload:rows('c6-held'),posts});

  console.log('GET: actual null/existing response held; explicit 500 and real retry');
  async function delayed(id,existing) {
   const page=await session();const ready=deferred(),release=deferred();let requests=0;
   const url=`**/api/v1/bookings/${id}/review`;
   await page.route(url,async route=>{requests++;const response=await route.fetch();assert.equal(response.status(),200);
    const text=await response.text();if(existing)assert.equal(JSON.parse(text).content,'C6 held response persisted');else assert.ok(text===''||text==='null');
    ready.resolve();await release.promise;await route.fulfill({response});});
   await booking(page,id);await ready.promise;await visible(page.locator('section.panel.space-y-2 [aria-busy=true]'));await visible(page.getByRole('status').filter({hasText:'Đang tải đánh giá...'}));await absent(form(page));await absent(own(page));
   await screenshot(page,existing?'get-existing-loading':'get-null-loading');release.resolve();
   await visible(existing?own(page):form(page));await absent(page.getByText('Đang tải đánh giá...',{exact:true}));await screenshot(page,existing?'get-existing-released':'get-null-released');assert.equal(requests,1);await page.unroute(url);return page;
  }
  await delayed('c6-held',true);const getPage=await delayed('c6-get-null',false);
  let failOnce=true,retries=0;
  await getPage.route('**/api/v1/bookings/c6-get-null/review',async route=>{
   if(failOnce){failOnce=false;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'C6 injected review transport error'})});}
   else {retries++;const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({response});}
  });
  await getPage.reload();await visible(getPage.getByText('C6 injected review transport error',{exact:true}));await absent(form(getPage));
  await screenshot(getPage,'get-500');await getPage.getByRole('button',{name:'Thử tải lại đánh giá',exact:true}).click();
  await visible(form(getPage));await absent(getPage.getByText('C6 injected review transport error',{exact:true}));await screenshot(getPage,'get-retry-success');assert.equal(retries,1);assert.equal(rows('c6-get-null').length,0);
  sections.GetReviewDelayed={NullFromBackend:true,ExistingFromBackend:true,LoadingTextNoForm:true,Error500:true,RealRetryClearsError:true,RequestCounts:true};

  console.log('409: two actual admin UI contexts, SQL full row and audit');
  await submit(user,'c6-stale','C6 stale admin unique review');
  const initial=rows('c6-stale');assert.equal(initial.length,1);assert.equal(initial[0].version,0);assert.equal(initial[0].moderated_by,null);
  const adminA=await session('admin'),adminB=await session('admin');
  await adminA.goto(`${base}/admin/reviews`);await adminB.goto(`${base}/admin/reviews`);
  const article=p=>p.locator('article').filter({has:p.getByText('C6 stale admin unique review',{exact:true})});
  await visible(article(adminA).getByRole('button',{name:'Ẩn đánh giá',exact:true}));await visible(article(adminB).getByRole('button',{name:'Ẩn đánh giá',exact:true}));
  const patchPath=`/api/v1/admin/reviews/${initial[0].id}`;
  const responseA=adminA.waitForResponse(r=>new URL(r.url()).pathname===patchPath&&r.request().method()==='PATCH');
  await article(adminA).getByRole('button',{name:'Ẩn đánh giá',exact:true}).click();const a=await responseA;assert.equal(a.status(),200);assert.equal(a.request().postDataJSON().version,0);
  await visible(article(adminA).getByRole('button',{name:'Hiển thị',exact:true}));
  const beforeStale=rows('c6-stale');assert.equal(beforeStale[0].version,1);assert.equal(beforeStale[0].hidden,1);assert.equal(beforeStale[0].moderated_by,'demo-admin');assert.ok(beforeStale[0].moderated_at);
  const responseB=adminB.waitForResponse(r=>new URL(r.url()).pathname===patchPath&&r.request().method()==='PATCH');
  const refetch=adminB.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/admin/reviews'&&r.request().method()==='GET');
  await article(adminB).getByRole('button',{name:'Ẩn đánh giá',exact:true}).click();const b=await responseB;assert.equal(b.status(),409);assert.equal(b.request().postDataJSON().version,0);
  await visible(adminB.getByText('Đánh giá đã thay đổi.',{exact:true}));const fresh=await refetch;assert.equal(fresh.status(),200);
  const refreshed=(await fresh.json()).find(r=>r.id===initial[0].id);assert.equal(refreshed.version,1);assert.equal(refreshed.hidden,true);
  await visible(article(adminB).getByRole('button',{name:'Hiển thị',exact:true}));const afterStale=rows('c6-stale');assertUnchanged(beforeStale,afterStale);
  await screenshot(adminB,'stale-409');save('stale-409-sql.json',{initial,beforeStale,afterStale,requestVersions:[0,0],statuses:[200,409],refetched:refreshed});
  sections.StaleAdminForm409={TwoContexts:true,VersionedSuccess:true,Actual409:true,VisibleError:true,RealRefetch:true,FullRowUnchanged:true,SuccessfulAuditOnly:true};

  console.log('XSS: persisted API text, own/public/admin DOM and reload');
  const payload='<script>window.__xssScriptExecuted=true;</script><img src="invalid-src-xss" onerror="window.__xssImageExecuted=true;">';
  await submit(user,'c6-xss',payload);const stored=rows('c6-xss');assert.equal(stored.length,1);assert.equal(stored[0].content,payload);
  async function checkLiteral(page,locator,name) {
   await visible(locator);
   const evidence=await locator.evaluate(el=>({text:el.textContent,scriptCount:el.querySelectorAll('script').length,imageCount:el.querySelectorAll('img').length,scriptExecuted:window.__xssScriptExecuted,imageExecuted:window.__xssImageExecuted}));
   assertSafeDom(evidence,payload);save(`${name}-dom.json`,evidence);await screenshot(page,name);
  }
  await checkLiteral(user,own(user).getByText(payload,{exact:true}),'xss-own');
  await user.reload();await checkLiteral(user,own(user).getByText(payload,{exact:true}),'xss-own-reload');
  const guest=await session('guest');await guest.goto(`${base}/vehicles/v1`);await checkLiteral(guest,guest.getByText(payload,{exact:true}),'xss-public');
  await guest.reload();await checkLiteral(guest,guest.getByText(payload,{exact:true}),'xss-public-reload');
  await adminA.reload();await checkLiteral(adminA,adminA.getByText(payload,{exact:true}),'xss-admin');
  await adminA.reload();await checkLiteral(adminA,adminA.getByText(payload,{exact:true}),'xss-admin-reload');assertUnchanged(stored,rows('c6-xss'));
  save('xss-sql.json',stored);
  sections.MaliciousPayloadXSS={ApiStored:true,OwnLiteral:true,PublicLiteral:true,AdminLiteral:true,NoExecutableElements:true,SentinelsSafe:true,ReloadsPersisted:true};
  // Accept only exact console resource errors tied to verified negative HTTP cases.
  assertConsoleHealth(faults,events);save('console-readback.json',{faults,ExpectedNegativeHttpOnly:true});
  result.AllAssertionsPassed=assertSections(sections);
 } catch(e) {result.failure=e.message;throw e;}
 finally {save('browser-negatives-results.json',result);save('redacted-review-responses.json',events);for(const c of contexts)await c.close();await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
