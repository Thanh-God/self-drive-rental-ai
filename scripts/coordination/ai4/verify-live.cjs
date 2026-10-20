// Actual Chromium + Qwen + OSRM + isolated MySQL; never main DB.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium}=require(process.env.C11_PLAYWRIGHT),out=process.env.C11_EVIDENCE;
const base='http://127.0.0.1:5300',api='http://127.0.0.1:8300/api/v1',checks=[],errors=[],network=[];
const fixture=JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE,'fixture.json')));
const config=fs.readFileSync(path.join(out,'application.private.properties'),'utf8');
const password=config.match(/^spring.datasource.password=(.*)$/m)[1],schema=config.match(/jdbc:mysql:\/\/[^/]+\/([^?]+)/)[1];
assert.equal(fixture.port,33676);assert.match(schema,/^kdrive_c14_browser_[a-f0-9]+$/);
function check(name,actual,expected=true){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));}
function sql(q){try{return cp.execFileSync('docker',['exec','-e','MYSQL_PWD='+password,fixture.name,'mysql','-uroot','--batch','--raw','-N',schema,'-e',q],{encoding:'utf8',windowsHide:true,timeout:20000}).trim();}catch{throw Error('Fixture SQL failure; private args omitted');}}
async function req(t,url,method='GET',body){const r=await fetch(api+url,{method,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const txt=await r.text();return {status:r.status,body:txt?JSON.parse(txt):null};}
async function token(email){const r=await req(null,'/auth/login','POST',{email,password:'BranchBookingTestOnly123!'});assert.equal(r.status,200);return r.body.token;}
const day=new Date(Date.now()+7*3600000+3*86400000).toISOString().slice(0,10);
async function main(){
 const admin=await token('admin@example.test'),user=await token('user@example.test'),staff=await token('staff.dn@example.test');
 function importer(apply){const code="import sys,json;sys.path.insert(0,'scripts/ai');from import_locations_pilot import import_pilot_locations;import os;print(json.dumps(import_pilot_locations('scripts/ai/locations-pilot.json','http://127.0.0.1:8300',os.environ['AI4_IMPORT_TOKEN'],dry_run="+(apply?'False':'True')+")))";return JSON.parse(cp.execFileSync('E:/MT_Python/python312/python.exe',['-X','utf8','-c',code],{env:{...process.env,AI4_IMPORT_TOKEN:admin},encoding:'utf8',windowsHide:true,timeout:60000}));}
 const dry=importer(false);check('Dry run no errors',dry.errors,[]);check('Dry run no location rows',sql('SELECT COUNT(*) FROM locations'),'0');
 const first=importer(true),again=importer(true);check('Import creates eight',first.locationsCreated.length,8);check('Idempotent actual API',again.locationsSkipped.length,8);check('No second import creates',again.locationsCreated.length,0);check('Import errors',again.errors,[]);
 fs.writeFileSync(path.join(out,'import-readback.json'),JSON.stringify({dry,first,again},null,2));
 const catalog=(await req(user,'/ai/locations')).body,start=catalog.find(x=>x.name.includes('Chăm'));
 const warm=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'qwen3:8b',prompt:'',stream:false,keep_alive:'2m'})});
 check('Existing model warmup',warm.status,200);check('Warmup done',(await warm.json()).done,true);
 assert.ok(start);const criteria={tripDate:day,startTime:'08:00',endTime:'17:00',startLocationId:start.id,preferredCategoryId:null};
 const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'vi-VN'});
 await ctx.addInitScript(jwt=>localStorage.setItem('kdrive.jwt',jwt),user);const p=await ctx.newPage();p.setDefaultTimeout(15000);
 p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().includes('/api/v1/'))network.push({method:r.request().method(),path:new URL(r.url()).pathname,status:r.status()});});
 let lastPlan,preview;
 try {
  for(const width of [1440,1280]){
   await p.setViewportSize({width,height:1000});await p.goto(base+'/ai/itinerary');
   await p.getByRole('heading',{name:'Lập kế hoạch hành trình 1 ngày',exact:true}).waitFor();
   await p.getByLabel('Điểm xuất phát',{exact:true}).selectOption(start.id);await p.getByLabel('Ngày hành trình',{exact:true}).fill(day);await p.getByLabel('Giờ bắt đầu',{exact:true}).fill('08:00');
   const response=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/ai/itineraries/preview')&&r.request().method()==='POST',{timeout:70000});
   await p.getByRole('button',{name:'Xem trước kế hoạch',exact:true}).click();preview=await (await response).json();fs.writeFileSync(path.join(out,'preview-'+width+'.json'),JSON.stringify(preview,null,2));check('Live preview '+width,preview.status,'VALIDATED');
   check('2–4 stops '+width,preview.items.length>=2&&preview.items.length<=4);check('Start pinned '+width,preview.orderedLocationIds[0],start.id);check('Real leg distances '+width,preview.items.slice(0,-1).every(x=>x.travelToNextMinutes>=0&&x.distanceToNextMeters>=0));
   await p.getByText('HÀNH TRÌNH KHẢ THI',{exact:true}).waitFor();await p.screenshot({path:path.join(out,'planner-'+width+'.png'),fullPage:true});
   await p.getByPlaceholder('Đặt tên cho hành trình...').fill('AI4 live '+width);
   const saved=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/itineraries')&&r.request().method()==='POST');await p.getByRole('button',{name:'Lưu vào tài khoản',exact:true}).click();const sr=await saved;check('UI save '+width,sr.status(),201);lastPlan=await sr.json();
   await p.getByRole('link',{name:'Xem hành trình đã lưu →',exact:true}).click();await p.getByRole('heading',{name:'AI4 live '+width,exact:true}).waitFor();check('VN detail date '+width,(await p.locator('body').innerText()).includes(day.split('-').reverse().join('/')));
   await p.screenshot({path:path.join(out,'detail-'+width+'.png'),fullPage:true});
   await p.goto(base+'/user/itineraries');await p.getByRole('heading',{name:'AI4 live '+width,exact:true}).waitFor();check('SQL saved item count '+width,Number(sql(`SELECT COUNT(*) FROM itinerary_items WHERE day_id=(SELECT id FROM itinerary_days WHERE itinerary_id='${lastPlan.id}')`)),preview.items.length);
  }
  const rowsBefore=sql('SELECT COUNT(*) FROM itineraries');
  check('Guest401',(await req(null,'/itineraries')).status,401);check('Staff403',(await req(staff,'/itineraries')).status,403);check('Admin403',(await req(admin,'/itineraries')).status,403);
  for(const [role,jwt,destination] of [['guest',null,'/login'],['staff',staff,'/unauthorized'],['admin',admin,'/unauthorized']]){
   const blocked=await browser.newContext({viewport:{width:1280,height:1000},locale:'vi-VN'});if(jwt)await blocked.addInitScript(t=>localStorage.setItem('kdrive.jwt',t),jwt);
   const page=await blocked.newPage();await page.goto(base+'/ai/itinerary');await page.waitForURL('**'+destination);check('Planner UI guard '+role,new URL(page.url()).pathname,destination);await blocked.close();
  }
  const other=await req(null,'/auth/register','POST',{email:'ai4-other@example.test',fullName:'Other fixture',password:'IsolatedOnly123!'});check('Other user registration',other.status,201);check('Other owner404',(await req(other.body.token,'/itineraries/'+lastPlan.id)).status,404);check('Other list empty',(await req(other.body.token,'/itineraries')).body,[]);
  const saveBody={title:'Stale proof',...criteria,orderedLocationIds:preview.orderedLocationIds,fingerprint:preview.fingerprint};
  const snapshot=(await req(user,'/itineraries/'+lastPlan.id)).body;
  const edit=(await req(admin,'/admin/locations/'+start.id)).body;edit.expectedRevision=edit.revision;edit.metadata.hoursEvidence.url='https://example.org/changed-source';delete edit.id;delete edit.revision;delete edit.categoryName;
  check('Actual catalog evidence edit',(await req(admin,'/admin/locations/'+start.id,'PUT',edit)).status,200);
  check('Real stale409',(await req(user,'/itineraries','POST',saveBody)).status,409);check('No stale rows',sql('SELECT COUNT(*) FROM itineraries'),rowsBefore);check('Snapshot immutable',(await req(user,'/itineraries/'+lastPlan.id)).body,snapshot);
  const unknown=catalog.find(l=>!l.metadata?.durationMinutes);check('Unknown facts no plan',(await req(user,'/ai/itineraries/preview','POST',{...criteria,startLocationId:unknown.id})).body.status,'NEEDS_DATA');
  check('No fit no plan',(await req(user,'/ai/itineraries/preview','POST',{...criteria,startTime:'23:00',endTime:'23:30'})).body.status,'NO_FEASIBLE_PLAN');
  const owned=process.env.AI4_OWNED_OSRM_NAME;assert.equal(cp.execFileSync('docker',['inspect','--format','{{.Id}}',owned],{encoding:'utf8',windowsHide:true}).trim(),process.env.AI4_OWNED_OSRM_ID);cp.execFileSync('docker',['stop',owned],{windowsHide:true,timeout:20000});
  check('OSRM off no plan',(await req(user,'/ai/itineraries/preview','POST',criteria)).body.status,'UNAVAILABLE');check('OSRM off save rejected',(await req(user,'/itineraries','POST',saveBody)).status,409);
  const pid=Number(process.env.AI4_OWNED_OLLAMA_PID);if(pid){const unloaded=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'qwen3:8b',prompt:'',stream:false,keep_alive:0})});check('Unload owned model',unloaded.status,200);process.kill(pid);await new Promise(r=>setTimeout(r,1000));check('Qwen off no plan',(await req(user,'/ai/itineraries/preview','POST',criteria)).body.status,'UNAVAILABLE');}
  check('Providers off stored read',(await req(user,'/itineraries/'+lastPlan.id)).body,snapshot);await p.goto(base+'/user/itineraries/'+lastPlan.id);await p.getByRole('heading',{name:lastPlan.title,exact:true}).waitFor();check('No negative-case rows',sql('SELECT COUNT(*) FROM itineraries'),rowsBefore);
  check('Flyway remains V1–V4',sql('SELECT GROUP_CONCAT(version ORDER BY installed_rank) FROM flyway_schema_history WHERE success=1'),'1,2,3,4');check('No browser runtime errors',errors,[]);
  fs.writeFileSync(path.join(out,'real-preview.json'),JSON.stringify(preview,null,2));fs.writeFileSync(path.join(out,'network.json'),JSON.stringify(network,null,2));
 } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
