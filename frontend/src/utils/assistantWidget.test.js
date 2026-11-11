import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { act, createElement as h } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
let dom,vite,createRoot,Widget,Auth,Router,Link,client,auth,c,root;
const oldMode=process.env.VITE_DATA_MODE,originals=new Map(),requests=[];
const entry='/vehicles?start=2100-10-20&end=2100-10-24&pickupBranchId=dn&returnBranchId=hn&budget=3000000';
before(async()=>{
 dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});
 for(const [k,v]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});}
 process.env.VITE_DATA_MODE='api';createRoot=(await import('react-dom/client')).createRoot;vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 ({default:Widget}=await vite.ssrLoadModule('/src/components/ai/AssistantWidget.jsx'));({default:Auth}=await vite.ssrLoadModule('/src/context/AuthContext.jsx'));({MemoryRouter:Router,Link}=await vite.ssrLoadModule('react-router-dom'));({default:client}=await vite.ssrLoadModule('/src/api/client.js'));
 client.defaults.adapter=config=>new Promise((resolve,reject)=>requests.push({config,resolve,reject}));
});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=null;document.body.replaceChildren();requests.length=0;localStorage.clear();sessionStorage.clear();});
after(async()=>{await vite.close();dom.window.close();for(const[k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}if(oldMode===undefined)delete process.env.VITE_DATA_MODE;else process.env.VITE_DATA_MODE=oldMode;});
async function render(){await act(async()=>root.render(h(Auth.Provider,{value:auth},h(Router,{initialEntries:[entry]},h(Link,{to:'/user/profile'},'Đi hồ sơ'),h(Widget)))));}
async function mount(role='USER'){auth={user:{id:'u1',role},token:'test-token',isAuthenticated:true,loading:false};localStorage.setItem('kdrive.jwt',auth.token);c=document.createElement('div');document.body.append(c);root=createRoot(c);await render();}
const button=name=>[...c.querySelectorAll('button')].find(el=>el.getAttribute('aria-label')===name||el.textContent===name);
const field=name=>[...c.querySelectorAll('label')].find(el=>el.textContent.startsWith(name))?.querySelector('input,select');
async function expandRoutes(){const el=c.querySelector('.assistant-routes');await act(async()=>{el.open=true;el.dispatchEvent(new dom.window.Event('toggle'));});}
async function selectRoute(index,value){const el=field('Điểm '+index);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
async function click(el){assert.ok(el);await act(async()=>el.click());}
function take(url){const req=requests.find(r=>r.config.url===url&&!r.claimed);assert.ok(req,url);req.claimed=true;return req;}
async function respond(req,data){await act(async()=>req.resolve({config:req.config,status:200,statusText:'OK',headers:{},data}));}
const quotaBody=(used,limit=6)=>({limit,used,remaining:limit-used,resetAt:'2026-11-11T17:00:00Z',hotline:{number:'10008888',sample:true}});
async function open(used=0){await click(button('Mở Trợ lý KDrive'));await respond(take('/ai/quota'),quotaBody(used));}
const area=()=>c.querySelector('textarea[aria-label="Câu hỏi cho trợ lý"]');
async function type(value){await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(area(),value);area().dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
async function send(value){await type(value);await act(async()=>c.querySelector('form[aria-label="Gửi câu hỏi"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
async function enter(shift=false){await act(async()=>area().dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:shift,bubbles:true,cancelable:true})));}
const bubbles=()=>[...c.querySelectorAll('.assistant-bubble')].map(el=>el.textContent);
function reply(text,extra={}){return {intent:'ANSWER',reply:text,citations:[],knowledgeVersion:'2026-11-11-v1',criteria:null,missing:[],cards:[],quota:quotaBody(1),...extra};}
const chatRequests=()=>requests.filter(r=>r.config.url==='/ai/chat');

test('C4.1 greeting and three suggestions, no 8-field form; a suggestion is sent as the question',async()=>{
 await mount();await open();
 assert.match(c.textContent,/Chào bạn, mình là Trợ lý KDrive/);
 assert.equal(c.querySelectorAll('.assistant-suggestions button').length,3);
 for(const gone of ['Ngày nhận','Điểm nhận','Tổng ngân sách','Điền nhu cầu bằng AI','Gợi ý xe phù hợp'])assert.equal(c.textContent.includes(gone),false,gone);
 assert.equal(c.querySelector('input[type="date"]'),null);
 assert.equal(requests.some(r=>['/branches','/vehicles/catalog'].includes(r.config.url)),false,'the chat does not load the old form catalogs');
 assert.ok(c.querySelector('a[href="/vehicles"]'),'link to the vehicle search page stays');
 assert.ok(c.querySelector('.assistant-routes'),'location explorer stays');
 await click(button('Thuê xe cần giấy tờ gì?'));
 const req=take('/ai/chat');assert.deepEqual(JSON.parse(req.config.data),{message:'Thuê xe cần giấy tờ gì?'});assert.equal(req.config.timeout,65000);
 assert.equal(c.querySelector('.assistant-suggestions'),null,'suggestions disappear once the conversation starts');
 await respond(req,reply('Bạn cần GPLX còn hiệu lực.',{citations:[{id:'K-C01',title:'Thuê xe cần giấy tờ gì?'}]}));
 assert.deepEqual(bubbles().slice(1),['Bạn: Thuê xe cần giấy tờ gì?','Trợ lý: Bạn cần GPLX còn hiệu lực.']);
 assert.match(c.textContent,/Còn 5\/6 lượt hỏi AI hôm nay/,'the quota in the answer updates the counter');
});

test('C4.1 history and search criteria are sent back; a busy turn shows the typing state and blocks a second send',async()=>{
 await mount();await open();
 await send('Tìm xe nhận tại Đà Nẵng ngày 22/10/2026');
 assert.match(c.textContent,/Đang trả lời/);assert.equal(button('Gửi').disabled,true);
 await type('gửi thêm');await enter();assert.equal(chatRequests().length,1,'no second request while answering');
 const first=take('/ai/chat');
 const carried={pickupDate:'2026-10-22',returnDate:null,pickupBranchId:'dn',returnBranchId:null,passengers:null,budgetVndTotal:null,transmission:null};
 await respond(first,reply('Mình cần thêm một thông tin để tìm xe: bạn định trả xe ngày nào?',{intent:'ASK_MISSING',criteria:carried,missing:['returnDate']}));
 assert.doesNotMatch(c.textContent,/Đang trả lời/);
 await type('Trả ngày 26/10/2026');await enter();
 const second=take('/ai/chat'),sent=JSON.parse(second.config.data);
 assert.equal(sent.message,'Trả ngày 26/10/2026');
 assert.deepEqual(sent.messages,[{role:'user',text:'Tìm xe nhận tại Đà Nẵng ngày 22/10/2026'},{role:'assistant',text:'Mình cần thêm một thông tin để tìm xe: bạn định trả xe ngày nào?'}]);
 assert.deepEqual(sent.criteria,carried);
 await respond(second,reply('Câu trả lời không tìm xe.'));
 await send('Câu tiếp theo');const third=JSON.parse(take('/ai/chat').config.data);
 assert.deepEqual(third.criteria,carried,'an answer without criteria keeps the earlier search criteria');
 await type('dòng 1');await enter(true);assert.equal(chatRequests().filter(r=>!r.claimed).length,0,'Shift+Enter does not send');
});

test('C4.1 reset and identity/session change abort and drop a late reply; closing mid-answer gives the question back',async()=>{
 await mount();await open();
 await send('Câu hỏi một');const old=take('/ai/chat');await click(button('Bắt đầu lại'));
 assert.equal(old.config.signal.aborted,true);await respond(old,reply('Trả lời muộn'));
 assert.equal(bubbles().length,1,'only the greeting remains');assert.ok(c.querySelector('.assistant-suggestions'));
 await send('Câu hỏi hai');const pending=take('/ai/chat');
 await click(button('Thu nhỏ trợ lý'));assert.equal(pending.config.signal.aborted,true);await respond(pending,reply('Không được hiện'));
 await click(button('Mở Trợ lý KDrive'));
 assert.equal(area().value,'Câu hỏi hai','the unanswered question is back in the input box');
 assert.equal(bubbles().some(b=>b.includes('Không được hiện')||b.includes('Bạn: Câu hỏi hai')),false);
 await send('Câu hỏi ba');const session=take('/ai/chat');
 auth={...auth,user:{id:'u2',role:'USER'},token:'second-token'};localStorage.setItem('kdrive.jwt',auth.token);await render();
 assert.equal(session.config.signal.aborted,true);assert.equal(c.querySelector('[role="dialog"]'),null);
 await respond(session,reply('Phiên cũ'));
 await click(button('Mở Trợ lý KDrive'));assert.equal(bubbles().length,1,'a new session starts empty');assert.equal(area().value,'');
 auth={...auth,isAuthenticated:false,user:null};await render();assert.equal(button('Mở Trợ lý KDrive'),undefined);
 assert.equal(localStorage.getItem('kdrive.assistant'),null);assert.equal(sessionStorage.length,0,'nothing is stored in the browser');
});

test('C4.1 provider errors keep the typed question; malformed replies are errors, not invented answers',async()=>{
 await mount();await open();
 await send('Xe có bảo hiểm không?');let req=take('/ai/chat');
 await act(async()=>req.reject({config:req.config,response:{status:503,data:{message:'Trợ lý chưa trả lời được lúc này; vui lòng thử lại sau.'}}}));
 assert.match(c.querySelector('[role="alert"]').textContent,/chưa trả lời được/);
 assert.equal(area().value,'Xe có bảo hiểm không?');assert.equal(bubbles().length,1);
 await send('Xe có bảo hiểm không?');req=take('/ai/chat');
 await act(async()=>req.reject({config:req.config,response:{status:429,data:{message:'Trợ lý đang trả lời câu hỏi khác; vui lòng thử lại.'}}}));
 assert.match(c.querySelector('[role="alert"]').textContent,/câu hỏi khác/);assert.equal(button('Gửi').disabled,false,'busy is retryable');
 await send('Xe có bảo hiểm không?');req=take('/ai/chat');
 await respond(req,{intent:'CHAT',reply:'bịa',citations:[],missing:[],cards:[],criteria:null,quota:quotaBody(1)});
 assert.ok(c.querySelector('[role="alert"]'));assert.equal(bubbles().some(b=>b.includes('bịa')),false);
 await send('Xe có bảo hiểm không?');req=take('/ai/chat');
 await respond(req,reply('x',{cards:[1,2,3,4]}));assert.equal(bubbles().some(b=>b.includes('Trợ lý: x')),false);
});

test('C4.1 the daily limit locks sending with the sample hotline, from the counter or from a 429 AI_DAILY_LIMIT',async()=>{
 await mount();await open(6);
 assert.match(c.querySelector('.assistant-quota-empty').textContent,/hotline 10008888 \(số mẫu dùng cho bản demo\)/);
 assert.equal(area().disabled,true);for(const b of c.querySelectorAll('.assistant-suggestions button'))assert.equal(b.disabled,true);
 assert.equal(chatRequests().length,0);
 await click(button('Bắt đầu lại'));await click(button('Thu nhỏ trợ lý'));
 root.unmount();root=createRoot(c);await mount();await open(5);
 await send('Có giao xe tận nhà không?');const req=take('/ai/chat');
 await act(async()=>req.reject({config:req.config,response:{status:429,data:{message:'Bạn đã dùng hết 6 lượt…',code:'AI_DAILY_LIMIT',...quotaBody(6)}}}));
 assert.equal(c.querySelector('[role="alert"]'),null);
 assert.ok(c.querySelector('.assistant-quota-empty'));assert.equal(area().value,'Có giao xe tận nhà không?');assert.equal(area().disabled,true);
});

test('Routes use active catalog IDs, validated facts and invalidate pending responses on edit/reset',async()=>{
 await mount();await open();assert.equal(requests.some(r=>r.config.url==='/ai/locations'),false);
 await expandRoutes();await respond(take('/ai/locations'),[{id:'a',name:'Điểm A',metadata:null},{id:'b',name:'Điểm B',metadata:null}]);
 await selectRoute(1,'a');await selectRoute(2,'b');assert.match(c.textContent,/Chưa xác minh/);
 await act(async()=>c.querySelector('form[aria-label="Xem tuyến tham quan"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 const request=take('/ai/routes/preview');assert.deepEqual(JSON.parse(request.config.data),{locationIds:['a','b']});
 await respond(request,{status:'VERIFIED',distanceMeters:30500,durationSeconds:1740,attribution:'OpenStreetMap'});assert.match(c.textContent,/29 phút lái xe/);
 await selectRoute(2,'a');assert.doesNotMatch(c.textContent,/29 phút lái xe/);
 await act(async()=>c.querySelector('form[aria-label="Xem tuyến tham quan"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.match(c.textContent,/địa điểm khác nhau/);assert.equal(requests.filter(r=>r.config.url==='/ai/routes/preview').length,1);
 await selectRoute(2,'b');await act(async()=>c.querySelector('form[aria-label="Xem tuyến tham quan"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 const late=take('/ai/routes/preview');await click(button('Bắt đầu lại'));await respond(late,{status:'VERIFIED',distanceMeters:10000,durationSeconds:600,attribution:'OpenStreetMap'});assert.doesNotMatch(c.textContent,/10 phút lái xe/);
});

test('Closed initially, supported USER only, no eager requests',async()=>{
 await mount('ADMIN');assert.equal(button('Mở Trợ lý KDrive'),undefined);assert.equal(requests.length,0);auth={...auth,user:{id:'staff',role:'STAFF'}};await render();assert.equal(c.querySelector('[role="dialog"]'),null);
 auth={...auth,user:{id:'u1',role:'USER'},loading:true};await render();assert.equal(button('Mở Trợ lý KDrive'),undefined);auth={...auth,loading:false};await render();assert.ok(button('Mở Trợ lý KDrive'));assert.equal(c.querySelector('[role="dialog"]'),null);assert.equal(requests.length,0);
});
test('Demo assistant has explicit unavailable copy and sends no API calls',async()=>{
 process.env.VITE_DATA_MODE='demo';let demoServer;
 try {
  demoServer=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true},appType:'custom',logLevel:'error'});
  const {default:DemoWidget}=await demoServer.ssrLoadModule('/src/components/ai/AssistantWidget.jsx'),{default:DemoAuth}=await demoServer.ssrLoadModule('/src/context/AuthContext.jsx'),{MemoryRouter:DemoRouter}=await demoServer.ssrLoadModule('react-router-dom'),{default:demoClient}=await demoServer.ssrLoadModule('/src/api/client.js');
  let calls=0;demoClient.defaults.adapter=async()=>{calls++;throw new Error('Demo must not call API');};c=document.createElement('div');document.body.append(c);root=createRoot(c);await act(async()=>root.render(h(DemoAuth.Provider,{value:{user:{id:'demo-user',role:'USER'},isAuthenticated:true,loading:false}},h(DemoRouter,null,h(DemoWidget)))));await click(button('Mở Trợ lý KDrive'));assert.match(c.textContent,/Bản demo chưa kết nối/);assert.equal(c.querySelector('form'),null);assert.equal(calls,0);await act(async()=>root.unmount());root=null;
 } finally {await demoServer?.close();process.env.VITE_DATA_MODE='api';}
});
