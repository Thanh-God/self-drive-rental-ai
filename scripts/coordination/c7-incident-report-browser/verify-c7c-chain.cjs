const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.C7B_PLAYWRIGHT_MODULE);
const { sql, booking, snapshot, login, q } = require('./verify-c7b-browser.cjs');
const { dispatcher, deferred, bounded, assertNoUnexpected } = require('./browser-controls.cjs');
const base=process.env.C7B_BASE_URL, api=process.env.C7B_API_BASE_URL, browserApi=`${base}/api/v1`, evidence=process.env.C7B_EVIDENCE_DIR;
const checks=[], http=[], consoleIssues=[], expected=[];
let browser, activePage;
function record(name,actual,wanted){assert.deepEqual(actual,wanted,name);checks.push({name,actual,expected:wanted,passed:true});console.log(`PASS ${name}`);}
function write(file,data){fs.writeFileSync(path.join(evidence,file),JSON.stringify(data,null,2));}
async function request(actor,url,body){const r=await fetch(`${api}${url}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(actor?{authorization:`Bearer ${actor.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
function rows(id){return sql(`SELECT * FROM incident_events WHERE case_id=${q(id)} ORDER BY occurred_at,id;`).split('\n').filter(Boolean);}
function incident(id){return sql(`SELECT * FROM incident_cases WHERE id=${q(id)};`);}
async function open(actor,f){const r=await request(actor,'/incidents',{bookingId:f.id,kind:'DAMAGE',occurredAt:f.occurred,description:'C7C verified damage',evidenceReference:'fixture-evidence',blockVehicle:false});record('create real incident',r.status,200);return r.data;}
const value=(next,version,extra={})=>({next,version,assessedDamage:1000000,thirdPartyCoverage:250000,requestedAmount:750000,responsibilityBasis:'Verified fixture photographs',note:`C7C ${next}`,...extra});
async function backend(){
 const user=await login('user@example.test'), staff=await login('staff.hn@example.test'), admin=await login('admin@example.test');
 const f=booking('COMPLETED','chain'), before=snapshot([f]);let c=await open(user,f);
 const pathAction=`/incidents/${c.id}/actions`;
 const reject=async(name,actor,body,status)=>{const old=incident(c.id),history=rows(c.id);const r=await request(actor,pathAction,body);record(name,r.status,status);record(`${name} case unchanged`,incident(c.id),old);record(`${name} no extra/changed event`,rows(c.id),history);};
 await reject('anonymous action denied',null,value('ASSESSED',0),401);
 await reject('USER cannot assess',user,value('ASSESSED',0),403);
 await reject('STAFF cannot claim',staff,value('CLAIMED',0),403);
 await reject('STAFF cannot close',staff,value('CLOSED',0),403);
 await reject('USER cannot claim',user,value('CLAIMED',0),403);
 await reject('ADMIN cannot claim OPEN',admin,value('CLAIMED',0),409);
 await reject('USER cannot dispute OPEN',user,value('DISPUTED',0),403);
 for(const [name,extra] of [['negative damage',{assessedDamage:-1}],['negative coverage',{thirdPartyCoverage:-1}],['coverage exceeds damage',{thirdPartyCoverage:1000001}],['negative request',{requestedAmount:-1}],['request exceeds uncovered damage',{requestedAmount:750001}],['missing basis',{responsibilityBasis:' '}],['missing note',{note:' '}]]) await reject(name,staff,value('ASSESSED',0,extra),400);
 const sequence=[['ASSESSED',staff,'demo-staff-hn'],['CLAIMED',admin,'demo-admin'],['DISPUTED',user,'demo-user'],['ASSESSED',staff,'demo-staff-hn'],['CLAIMED',admin,'demo-admin'],['CLOSED',admin,'demo-admin']];
 for(const [next,actor,actorId] of sequence){
  const oldRows=rows(c.id), prior=c.status, version=c.version;
  const body=value(next,version,next==='ASSESSED'&&prior==='DISPUTED'?{assessedDamage:800000,thirdPartyCoverage:200000,requestedAmount:600000,responsibilityBasis:'Reassessed fixture evidence'}:{});
  const r=await request(actor,pathAction,body);record(`${prior} to ${next}`,r.status,200);c=r.data;
  record(`${next} status/version`,[c.status,c.version],[next,version+1]);
  const history=rows(c.id);record(`${next} exactly one appended event`,history.length,oldRows.length+1);record(`${next} historical event bytes unchanged`,history.slice(0,oldRows.length),oldRows);
  const last=sql(`SELECT CONCAT(actor_id,'|',previous_status,'|',next_status,'|',assessed_damage,'|',third_party_coverage,'|',requested_amount,'|',responsibility_basis) FROM incident_events WHERE case_id=${q(c.id)} ORDER BY occurred_at DESC,id DESC LIMIT 1;`);
  record(`${next} immutable financial/basis snapshot`,last,`${actorId}|${prior}|${next}|${c.assessedDamage}|${c.thirdPartyCoverage}|${c.requestedAmount}|${c.responsibilityBasis}`);
  record(`${next} no automatic booking/vehicle/document/review change`,snapshot([f]),before);
  await reject(`${next} stale version409`,admin,value('CLOSED',version),409);
  if(next==='CLAIMED')await reject('CLAIMED cannot reassess before dispute',staff,value('ASSESSED',c.version),409);
  if(next==='DISPUTED')await reject('ADMIN cannot claim unresolved dispute',admin,value('CLAIMED',c.version),409);
 }
 await reject('CLOSED rejects further updates',admin,value('CLOSED',c.version),409);
 const foreignResponse=await fetch(`${api}/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`c7c-foreign-${Date.now()}@example.test`,fullName:'Foreign C7C',password:'FixtureForeignAa9!'})});record('foreign register',foreignResponse.status,201);const foreign=await foreignResponse.json();
 await reject('foreign action denied',foreign,value('CLOSED',c.version),404);
 record('foreign history denied',(await request(foreign,`/incidents/${c.id}/events`)).status,404);
 const raceFixture=booking('COMPLETED','race'), raceBefore=snapshot([raceFixture]), race=await open(user,raceFixture),raceOld=rows(race.id);
 const results=await Promise.all(['one','two'].map(note=>request(staff,`/incidents/${race.id}/actions`,value('ASSESSED',race.version,{note:`Concurrent ${note}`}))));
 record('two real concurrent writers one200 one409',results.map(r=>r.status).sort(),[200,409]);
 record('concurrency one new event',rows(race.id).length,raceOld.length+1);record('concurrency old history retained',rows(race.id).slice(0,raceOld.length),raceOld);
 record('concurrency case version1',sql(`SELECT version FROM incident_cases WHERE id=${q(race.id)};`),'1');record('concurrency no deduction',snapshot([raceFixture]),raceBefore);
 write('backend-assertions.json',{checks:[...checks],fixtures:[f,raceFixture],case:c,race:race.id});
 return {user,staff,admin};
}
function monitor(page){page.on('response',r=>{if(r.status()>=400)http.push({method:r.request().method(),url:r.url(),status:r.status()});});page.on('requestfailed',r=>http.push({method:r.method(),url:r.url(),failure:r.failure()?.errorText}));page.on('console',m=>{if(m.type()==='error')consoleIssues.push({type:'console',text:m.text(),url:m.location().url});});page.on('pageerror',e=>consoleIssues.push({type:'pageerror',text:e.message}));}
async function ui(actors){
 const f=booking('COMPLETED','ui'),before=snapshot([f]),initial=await open(actors.user,f);let c=initial;
 browser=await chromium.launch({headless:true});const contexts=[];
 async function actorPage(actor,area){const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);await context.addInitScript(({token})=>localStorage.setItem('kdrive.jwt',token),{token:actor.token});const scenarios=new Map();await context.route('**/api/v1/**',dispatcher(scenarios));const page=await context.newPage();page.setDefaultTimeout(15000);monitor(page);await page.goto(`${base}/${area}/bookings/${f.id}`);activePage=page;const card=page.locator('article').filter({has:page.getByText('C7C verified damage',{exact:true})});await card.waitFor();return {page,card,scenarios};}
 const staff=await actorPage(actors.staff,'staff');
 const form=staff.card.locator('form').filter({has:staff.page.locator('[name="assessedDamage"]')});
 async function fillAssessment(form,damage=1000000,coverage=250000,amount=750000){for(const [name,val] of Object.entries({assessedDamage:damage,thirdPartyCoverage:coverage,requestedAmount:amount,responsibilityBasis:'Browser verified evidence',note:'Browser assessment'}))await form.locator(`[name="${name}"]`).fill(String(val));}
 await fillAssessment(form,1000000,1000001,0);
 expected.push({method:'POST',url:`${browserApi}/incidents/${c.id}/actions`,status:400});
 const invalid=staff.page.waitForResponse(r=>r.url()===`${browserApi}/incidents/${c.id}/actions`&&r.request().method()==='POST');await form.getByRole('button',{name:'Lưu đánh giá',exact:true}).click();record('browser invalid coverage real400',(await invalid).status(),400);await staff.page.getByRole('alert').waitFor();record('invalid assessment no extra event',rows(c.id).length,1);
 await fillAssessment(form);
 const held={reached:deferred(),release:deferred(),finished:deferred()};staff.scenarios.set(`POST ${browserApi}/incidents/${c.id}/actions`,held);
 await form.getByRole('button',{name:'Lưu đánh giá',exact:true}).click();await bounded(held.reached.promise,'assessment reaches real backend');record('held assessment server200',held.response.status(),200);record('assessment button disabled',await form.getByRole('button',{name:'Lưu đánh giá',exact:true}).isDisabled(),true);
 await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await staff.page.waitForTimeout(100);record('exactly one action POST while held',held.count,1);held.release.resolve();await bounded(held.finished.promise,'assessment released');staff.scenarios.clear();await staff.card.getByRole('heading',{name:'DAMAGE · ASSESSED',exact:true}).waitFor();c=await held.response.json();
 const admin=await actorPage(actors.admin,'admin');const claim=admin.card.locator('form').filter({has:admin.page.getByRole('button',{name:'Gửi yêu cầu (Admin)',exact:true})});await claim.locator('[name="note"]').fill('Browser claim evidence');await claim.getByRole('button',{name:'Gửi yêu cầu (Admin)',exact:true}).click();await admin.card.getByRole('heading',{name:'DAMAGE · CLAIMED',exact:true}).waitFor();record('ADMIN claim browser persisted',sql(`SELECT status FROM incident_cases WHERE id=${q(c.id)};`),'CLAIMED');await admin.card.screenshot({path:path.join(evidence,'admin-claimed.png')});
 const user=await actorPage(actors.user,'user');record('USER has no assessment control',await user.card.locator('[name="assessedDamage"]').count(),0);const dispute=user.card.locator('form').filter({has:user.page.getByRole('button',{name:'Gửi phản hồi',exact:true})});await dispute.locator('[name="note"]').fill('Browser dispute evidence');await dispute.getByRole('button',{name:'Gửi phản hồi',exact:true}).click();await user.card.getByRole('heading',{name:'DAMAGE · DISPUTED',exact:true}).waitFor();record('USER dispute preserves amounts',sql(`SELECT CONCAT(assessed_damage,'|',third_party_coverage,'|',requested_amount) FROM incident_cases WHERE id=${q(c.id)};`),'1000000|250000|750000');await user.card.screenshot({path:path.join(evidence,'user-disputed.png')});
 await staff.page.reload();await staff.card.getByRole('heading',{name:'DAMAGE · DISPUTED',exact:true}).waitFor();await fillAssessment(form,800000,200000,600000);
 // Advance the backend independently after this browser loaded its version.
 const current=(await request(actors.staff,`/incidents?bookingId=${f.id}`)).data[0];const advanced=await request(actors.admin,`/incidents/${c.id}/actions`,value('ASSESSED',current.version,{assessedDamage:900000,thirdPartyCoverage:100000,requestedAmount:800000,note:'Other operator update'}));record('other real operator advanced case',advanced.status,200);
 const oldHistory=rows(c.id),oldCase=incident(c.id);expected.push({method:'POST',url:`${browserApi}/incidents/${c.id}/actions`,status:409});
 const stale=staff.page.waitForResponse(r=>r.url()===`${browserApi}/incidents/${c.id}/actions`&&r.request().method()==='POST');await form.getByRole('button',{name:'Lưu đánh giá',exact:true}).click();record('browser stale actual409',(await stale).status(),409);await staff.page.getByRole('alert').filter({hasText:'Hồ sơ đã thay đổi'}).waitFor();record('stale browser no overwrite',incident(c.id),oldCase);record('stale browser no history append',rows(c.id),oldHistory);await staff.page.screenshot({path:path.join(evidence,'staff-stale409.png'),fullPage:true});
 // Refresh all role views, then repeat a claim/dispute and reassess through
 // the real Staff form instead of bypassing this UI checkpoint.
 activePage=admin.page;await admin.page.reload();await admin.card.getByRole('heading',{name:'DAMAGE · ASSESSED',exact:true}).waitFor();await claim.locator('[name="note"]').fill('Claim after competing assessment');await claim.getByRole('button',{name:'Gửi yêu cầu (Admin)',exact:true}).click();await admin.card.getByRole('heading',{name:'DAMAGE · CLAIMED',exact:true}).waitFor();
 activePage=user.page;await user.page.reload();await user.card.getByRole('heading',{name:'DAMAGE · CLAIMED',exact:true}).waitFor();await dispute.locator('[name="note"]').fill('Second browser dispute');await dispute.getByRole('button',{name:'Gửi phản hồi',exact:true}).click();await user.card.getByRole('heading',{name:'DAMAGE · DISPUTED',exact:true}).waitFor();
 activePage=staff.page;await staff.page.reload();await staff.card.getByRole('heading',{name:'DAMAGE · DISPUTED',exact:true}).waitFor();await fillAssessment(form,800000,200000,600000);await form.getByRole('button',{name:'Lưu đánh giá',exact:true}).click();await staff.card.getByRole('heading',{name:'DAMAGE · ASSESSED',exact:true}).waitFor();record('Staff browser reassessment values',sql(`SELECT CONCAT(assessed_damage,'|',third_party_coverage,'|',requested_amount) FROM incident_cases WHERE id=${q(c.id)};`),'800000|200000|600000');
 await admin.page.reload();await admin.card.getByRole('heading',{name:'DAMAGE · ASSESSED',exact:true}).waitFor();await claim.locator('[name="note"]').fill('Browser renewed claim');await claim.getByRole('button',{name:'Gửi yêu cầu (Admin)',exact:true}).click();await admin.card.getByRole('heading',{name:'DAMAGE · CLAIMED',exact:true}).waitFor();
 const close=admin.card.locator('form').filter({has:admin.page.getByRole('button',{name:'Đóng hồ sơ',exact:true})});await close.locator('[name="note"]').fill('Browser close audit evidence');await close.getByRole('button',{name:'Đóng hồ sơ',exact:true}).click();await admin.card.getByRole('heading',{name:'DAMAGE · CLOSED',exact:true}).waitFor();await admin.card.getByRole('button',{name:'Lịch sử',exact:true}).click();await admin.card.locator('ol li').filter({hasText:'Browser close audit evidence'}).waitFor();record('closed browser no mutation forms',await admin.card.locator('form').count(),0);record('browser full chain no automatic deduction',snapshot([f]),before);record('browser updates retain historical event bytes',rows(c.id).slice(0,oldHistory.length),oldHistory);record('browser CLOSED retains requested amount without payment claim',sql(`SELECT CONCAT(status,'|',requested_amount) FROM incident_cases WHERE id=${q(c.id)};`),'CLOSED|600000');await admin.card.screenshot({path:path.join(evidence,'closed-history.png')});
 assertNoUnexpected(http,consoleIssues,expected);write('assertions.json',{checks,http,consoleIssues,expected,fixture:f,caseId:c.id});for(const context of contexts)await context.close();
}
(async()=>{const actors=await backend();await ui(actors);})().catch(async error=>{if(activePage){try{await activePage.screenshot({path:path.join(evidence,'failure.png'),fullPage:true});fs.writeFileSync(path.join(evidence,'failure.html'),await activePage.content());}catch{}}write('browser-failure.json',{message:error.message,stack:error.stack,checks,http,consoleIssues});console.error(error.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
