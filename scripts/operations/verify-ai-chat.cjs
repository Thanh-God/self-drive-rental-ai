// C4.3 desktop proof of the KDrive chat (updated in R8 for R1-R6 behaviour): real JAR + Vite + MySQL (c14 runner) + local Qwen. No response mocking.
// Run only through run-browser.py --ai-chat. Every question is asked once; assertions and timings are written
// to the evidence folder even when a check fails.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.C11_PLAYWRIGHT),out=process.env.C11_EVIDENCE;
const origin='http://127.0.0.1:5300',api='http://127.0.0.1:8300/api/v1',PASSWORD='BranchBookingTestOnly123!',DN='Đà Nẵng · mẫu';
const ANSWER_TIMEOUT=90000;

async function main(){
 const checks=[],timings=[],errors=[],consoleErrors=[],chatBodies=[],otherWrites=[];
 const check=(name,actual,expected=true)=>{checks.push({name,actual,expected});assert.deepEqual(actual,expected,name);};
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('request',r=>{
   if(r.method()==='POST'&&r.url().endsWith('/api/v1/ai/chat'))chatBodies.push(r.postDataJSON());
   // A price quote on the vehicle page is read-only by contract.
   else if(['POST','PUT','PATCH','DELETE'].includes(r.method())&&!r.url().includes('/auth/')&&!r.url().endsWith('/bookings/quote'))otherWrites.push(r.method()+' '+new URL(r.url()).pathname);
  });
  const launcher=()=>page.getByRole('button',{name:'Mở Trợ lý KDrive',exact:true}),dialog=()=>page.getByRole('dialog',{name:'Trợ lý KDrive'});
  const input=()=>dialog().getByLabel('Câu hỏi cho trợ lý',{exact:true});
  const botBubbles=()=>dialog().locator('.assistant-bubble-bot');
  async function login(){await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill('user@example.test');await page.getByLabel('Mật khẩu',{exact:true}).fill(PASSWORD);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(u=>u.pathname!=='/login');}
  async function logout(){await page.getByRole('button',{name:/Khách mẫu/}).click();await page.getByRole('button',{name:'Đăng xuất',exact:true}).filter({visible:true}).click();await page.waitForURL(u=>u.pathname==='/login');}
  /** Sends one question and waits for the backend answer; returns the JSON response. */
  async function ask(label,text){
   const before=await botBubbles().count();
   const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/v1/ai/chat'),{timeout:ANSWER_TIMEOUT});
   await input().fill(text);const t=Date.now();await input().press('Enter');
   const r=await response;const body=await r.json();timings.push({label,status:r.status(),ms:Date.now()-t,intent:body.intent});
   check(label+' HTTP 200',r.status(),200);
   await page.waitForFunction(n=>document.querySelectorAll('.assistant-bubble-bot').length>n,before,{timeout:ANSWER_TIMEOUT});
   await dialog().getByText('Đang trả lời',{exact:false}).waitFor({state:'detached',timeout:ANSWER_TIMEOUT});
   return body;
  }
  const dates=await page.evaluate(()=>{const d=n=>{const x=new Date(Date.now()+7*3600000+n*86400000);return{iso:x.toISOString().slice(0,10),vn:x.toISOString().slice(8,10)+'/'+x.toISOString().slice(5,7)+'/'+x.toISOString().slice(0,4)};};return[d(10),d(13)];});

  await login();await launcher().waitFor();check('Chatbox closed by default',await dialog().count(),0);
  const quotaLoad=page.waitForResponse(r=>r.url().endsWith('/api/v1/ai/quota'));await launcher().click();check('Quota read on open',(await quotaLoad).status(),200);
  await dialog().getByText('Chào bạn, mình là Trợ lý KDrive',{exact:false}).waitFor();
  check('Three suggestions',await dialog().locator('.assistant-suggestions button').count(),3);
  check('No date fields',await dialog().locator('input[type="date"]').count(),0);
  check('No old form button',await dialog().getByRole('button',{name:'Gợi ý xe phù hợp'}).count(),0);
  check('Starts with 6 questions',await dialog().locator('.assistant-quota').innerText(),'Còn 6/6 lượt hỏi AI hôm nay.');
  await page.screenshot({path:path.join(out,'chat-empty-1440.png')});

  const remaining=b=>b&&b.quota?b.quota.remaining:null;
  // R1 / D1: a policy answer is the approved entry, word for word.
  const policy=await ask('Q1 policy','Đơn chờ xác nhận được giữ bao lâu?');
  check('Q1 grounded answer',policy.intent,'ANSWER');check('Q1 cites K-B04',policy.citations.map(c=>c.id).includes('K-B04'),true);
  check('Q1 approved text verbatim',policy.reply.startsWith('Yêu cầu thuê được giữ lịch tối đa 2 giờ'),true);
  await dialog().locator('.assistant-sources').first().waitFor();
  check('Q1 source shown',(await dialog().locator('.assistant-sources').first().innerText()).startsWith('Nguồn:'),true);
  check('Suggestions gone after first question',await dialog().locator('.assistant-suggestions').count(),0);
  check('Q1 uses one question',remaining(policy),5);

  const off=await ask('Q2 off-topic','Thời tiết ở Hà Nội ngày mai thế nào?');
  check('Q2 refused',off.intent,'OUT_OF_SCOPE');check('Q2 approved refusal',off.reply,'Mình chỉ hỗ trợ các câu hỏi về dịch vụ thuê xe KDrive.');
  check('Q2 refusal has no source',off.citations.length,0);
  let left=remaining(off);

  // R5: a phone number written with spaces is refused by the server before the model, and costs nothing.
  {
   const phone='Gọi mình số 0901 234 567 nhé';
   const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/v1/ai/chat'),{timeout:ANSWER_TIMEOUT});
   await input().fill(phone);const t=Date.now();await input().press('Enter');const r=await response;
   timings.push({label:'N1 phone with spaces',status:r.status(),ms:Date.now()-t});
   check('N1 phone refused 400',r.status(),400);
   await dialog().locator('.assistant-error[role="alert"]').waitFor();
   check('N1 question given back to the input',await input().inputValue(),phone);
   check('N1 no user bubble kept',(await dialog().locator('.assistant-bubble-user').allInnerTexts()).some(t=>t.includes('0901')),false);
   const jwt=await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
   const q=await (await page.request.get(api+'/ai/quota',{headers:{'Authorization':'Bearer '+jwt}})).json();
   check('N1 allowance unchanged',q.remaining,left);
   await input().fill('');
  }

  // R3 (REVIEW #5): a question about vehicles is not a vehicle search.
  const seat=await ask('Q3 not a search','Xe có ghế trẻ em không?');
  check('Q3 no search intent',['SEARCH_VEHICLES','ASK_MISSING'].includes(seat.intent),false);
  check('Q3 no cards',seat.cards.length,0);check('Q3 no criteria',seat.criteria,null);
  if(seat.intent==='ANSWER'&&seat.citations.length===0)
   check('Q3 no-information offers Tìm xe link',await dialog().locator('.assistant-sources a[href="/vehicles"]').last().isVisible(),true);
  left=remaining(seat);

  const t1=await ask('Q4 search pickup','Mình muốn thuê xe tự lái, nhận tại '+DN+' ngày '+dates[0].vn+'.');
  check('Q4 asks for more',t1.intent,'ASK_MISSING');check('Q4 pickup date',t1.criteria&&t1.criteria.pickupDate,dates[0].iso);check('Q4 pickup branch',t1.criteria&&t1.criteria.pickupBranchId,'dn');
  check('Q4 uses one question',remaining(t1),left-1);left=remaining(t1);
  check('Tìm chuyến mới offered during a search',await dialog().getByRole('button',{name:'Tìm chuyến mới',exact:true}).isVisible(),true);
  // D2: each answer to the field the backend asked for is handled without the model and without the allowance.
  const reply={returnDate:'Ngày '+dates[1].vn+'.',returnBranchId:'Trả tại '+DN+'.',pickupBranchId:'Nhận tại '+DN+'.',
   pickupDate:'Ngày '+dates[0].vn+'.',passengers:'4 người.',budgetVndTotal:'Tổng ngân sách 3 triệu.'};
  let turn=t1,fieldTurns=0;
  while(turn.intent==='ASK_MISSING'&&fieldTurns<6){
   const asked=turn.criteria&&turn.criteria.askedField;
   check('Field turn '+fieldTurns+' names the asked field',typeof asked==='string'&&asked in reply,true);
   turn=await ask('Q5.'+fieldTurns+' answer '+asked,reply[asked]);fieldTurns++;
   const sent=chatBodies[chatBodies.length-1];
   check('Field turn '+fieldTurns+' carries criteria',sent.criteria&&sent.criteria.pickupDate,dates[0].iso);
   check('Field turn '+fieldTurns+' free (D2)',remaining(turn),left);
  }
  const t3=turn;
  check('Q5 searched',t3.intent,'SEARCH_VEHICLES');check('Q5 has cards',t3.cards.length>=1,true);
  check('Q5 trip as asked',[t3.criteria.pickupDate,t3.criteria.returnDate,t3.criteria.passengers,t3.criteria.budgetVndTotal],[dates[0].iso,dates[1].iso,4,3000000]);
  check('Q5 totals within budget',t3.cards.every(c=>c.total<=3000000&&c.total===c.rentalTotal+c.oneWayFee),true);
  await dialog().locator('.assistant-chat-cards article').first().waitFor();
  check('Cards rendered',await dialog().locator('.assistant-chat-cards article').count(),t3.cards.length);
  for(const width of [1280,1440]){
   await page.setViewportSize({width,height:1000});
   check('No horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   check('Panel inside viewport '+width,await dialog().evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0;}),true);
   check('Cards inside panel '+width,await dialog().evaluate(el=>{const p=el.getBoundingClientRect();return[...el.querySelectorAll('.assistant-chat-cards article')].every(a=>{const r=a.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;});}),true);
   await dialog().locator('.assistant-chat-cards').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,'chat-cards-'+width+'.png')});
  }
  await dialog().locator('.assistant-chat-cards article a').first().click();
  await page.waitForURL(u=>u.pathname.startsWith('/vehicles/'));const detail=new URL(page.url());
  check('Xem xe vehicle',detail.pathname,'/vehicles/'+t3.cards[0].vehicleId);
  check('Xem xe start',detail.searchParams.get('start'),dates[0].iso);check('Xem xe end',detail.searchParams.get('end'),dates[1].iso);
  check('Xem xe branches',[detail.searchParams.get('pickupBranchId'),detail.searchParams.get('returnBranchId')],['dn','dn']);
  if(await dialog().count()===0)await launcher().click();
  check('Conversation kept across SPA navigation',await dialog().locator('.assistant-chat-cards article').count(),t3.cards.length);

  // D3: "Tìm chuyến mới" clears the criteria only; the conversation and its cards stay.
  await dialog().getByRole('button',{name:'Tìm chuyến mới',exact:true}).click();
  check('Tìm chuyến mới hidden once cleared',await dialog().getByRole('button',{name:'Tìm chuyến mới',exact:true}).count(),0);
  const faq=await ask('Q6 question after new trip','Hủy đơn có được hoàn tiền không?');
  const sent6=chatBodies[chatBodies.length-1];
  check('Q6 sends no criteria',sent6.criteria==null,true);
  check('Q6 keeps the conversation',await dialog().locator('.assistant-chat-cards article').count(),t3.cards.length);
  check('Q6 not a search',['SEARCH_VEHICLES','ASK_MISSING'].includes(faq.intent),false);
  check('Q6 uses one question',remaining(faq),left-1);left=remaining(faq);
  check('One question left for the logout check',left,1);
  check('Last-question notice',await dialog().locator('.assistant-quota').innerText(),'Còn 1/6 lượt hỏi AI hôm nay. Đây là lượt cuối; sau đó bạn vẫn tìm xe được ở trang Tìm xe.');

  // The last question, then log out while it is being answered.
  await input().fill('Xe có bảo hiểm không?');await input().press('Enter');
  await dialog().getByText('Đang trả lời',{exact:false}).waitFor();
  await logout();check('Logout removes assistant',await launcher().count(),0);
  await page.waitForTimeout(70000); // let the backend finish the abandoned question
  await login();const reload=page.waitForResponse(r=>r.url().endsWith('/api/v1/ai/quota'));await launcher().click();
  const q=await (await reload).json();
  check('New session has no old messages',await dialog().locator('.assistant-bubble-user').count(),0);
  let path6='answered-after-logout';
  if(q.remaining===1){path6='not-counted';await ask('Q7 last question (retry)','Xe có bảo hiểm không?');}
  else check('Quota used up by the abandoned answer',q.remaining,0);
  await dialog().locator('.assistant-quota-empty').waitFor();
  const notice=await dialog().locator('.assistant-quota-empty').innerText();
  check('Limit notice has sample hotline',notice.includes('10008888 (số mẫu dùng cho bản demo)'),true);
  check('Input locked',await input().isDisabled(),true);
  await page.screenshot({path:path.join(out,'chat-limit-1440.png')});
  const token=await page.evaluate(()=>localStorage.getItem('kdrive.jwt'));
  // Straight to the backend (no browser CORS): the server itself must refuse, whatever the UI shows.
  const raw=await page.request.post(api+'/ai/chat',{headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},data:{message:'Còn lượt không?'}});
  const direct={status:raw.status(),code:(await raw.json()).code};
  check('Server refuses the 7th question',direct,{status:429,code:'AI_DAILY_LIMIT'});
  check('No other data writes',otherWrites,[]);
  check('No runtime errors',errors,[]);
  timings.push({label:'question 6 path',path:path6});
 }finally{
  await browser.close();
  fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));
  fs.writeFileSync(path.join(out,'chat-timings.json'),JSON.stringify(timings,null,2));
  fs.writeFileSync(path.join(out,'console.json'),JSON.stringify({errors,consoleErrors},null,2));
 }
 console.log('PASS chat '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
