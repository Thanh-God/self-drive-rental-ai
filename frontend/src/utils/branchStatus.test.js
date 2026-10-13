import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
let dom, vite, createRoot, Page, Auth, Router, client;
const roots=[], requests=[], originals=new Map(), oldMode=process.env.VITE_DATA_MODE;
const branch={id:"dn",name:"Đà Nẵng",address:"Địa chỉ fixture",status:"ACTIVE",version:7};
const route={id:"dn-hn",pickupBranchId:"dn",returnBranchId:"hn",fee:200000,enabled:true,version:3};
before(async()=>{
 dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true})){
  originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 process.env.VITE_DATA_MODE="api";createRoot=(await import("react-dom/client")).createRoot;
 vite=await createServer({root:fileURLToPath(new URL("../..",import.meta.url)),server:{middlewareMode:true},appType:"custom",logLevel:"error"});
 ({ApiBranchesPage:Page}=await vite.ssrLoadModule("/src/pages/api/ApiManagementScreens.jsx"));
 ({default:Auth}=await vite.ssrLoadModule("/src/context/AuthContext.jsx"));
 ({MemoryRouter:Router}=await vite.ssrLoadModule("react-router-dom"));
 ({default:client}=await vite.ssrLoadModule("/src/api/client.js"));
});
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());document.body.replaceChildren();requests.length=0;});
after(async()=>{await vite.close();dom.window.close();for(const [k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}if(oldMode===undefined)delete process.env.VITE_DATA_MODE;else process.env.VITE_DATA_MODE=oldMode;});
async function mount(role="ADMIN"){
 client.defaults.adapter=config=>new Promise((resolve,reject)=>requests.push({config,resolve,reject,claimed:false}));
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);roots.push(root);
 await act(async()=>root.render(h(Router,null,h(Auth.Provider,{value:{user:role?{role}:null}},h(Page)))));return c;
}
function take(url){const r=requests.find(r=>!r.claimed&&r.config.url===url);assert.ok(r,url);r.claimed=true;return r;}
function reply(r,data){r.resolve({config:r.config,data,status:200,statusText:"OK",headers:{}});}
function fail(r,status,message){r.reject(Object.assign(new Error(message),{config:r.config,response:{status,data:{message}}}));}
async function loaded(c,branches=[branch],routes=[route]){await act(async()=>{reply(take("/branches"),branches);reply(take("/branch-routes"),routes);});return c;}
function button(c,label){const b=[...c.querySelectorAll("button")].find(b=>(b.getAttribute("aria-label")||b.textContent.trim())===label);assert.ok(b,label);return b;}
async function click(c,label,twice=false){await act(async()=>{const b=button(c,label);b.click();if(twice)b.click();});}
async function fill(c,name,value){const i=c.querySelector(`[name="${name}"]`);assert.ok(i);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set.call(i,value);i.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});}
async function submit(form){await act(async()=>{form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));});}
test("branch page loading, request failure, retry and actual empty state",async()=>{
 const c=await mount();assert.ok(c.querySelector('[aria-busy="true"]'));
 await act(async()=>{fail(take("/branches"),500,"Không tải được chi nhánh");reply(take("/branch-routes"),[]);});
 assert.match(c.textContent,/Không tải được/);await click(c,"Thử tải lại");await loaded(c,[],[]);assert.match(c.textContent,/Chưa có chi nhánh/);
});
test("close and reopen use exact version; pending duplicate guard and no premature success",async()=>{
 const c=await loaded(await mount());await click(c,"Ngừng nhận đơn mới: Đà Nẵng",true);
 const write=take("/admin/branches/dn/status");assert.deepEqual(JSON.parse(write.config.data),{status:"INACTIVE",expectedVersion:7});
 assert.equal(requests.filter(r=>r.config.method==="put").length,1);assert.doesNotMatch(c.textContent,/Đã ngừng/);assert.equal(button(c,"Chỉnh sửa").disabled,true);
 await act(async()=>reply(write,{...branch,status:"INACTIVE",version:8}));await act(async()=>reply(take("/branches"),[{...branch,status:"INACTIVE",version:8}]));
 assert.match(c.textContent,/Đã ngừng nhận đơn mới/);await click(c,"Mở nhận đơn mới: Đà Nẵng");const open=take("/admin/branches/dn/status");assert.deepEqual(JSON.parse(open.config.data),{status:"ACTIVE",expectedVersion:8});
 await act(async()=>reply(open,{...branch,version:9}));await act(async()=>reply(take("/branches"),[{...branch,version:9}]));assert.match(c.textContent,/Đã mở nhận đơn mới/);assert.match(c.textContent,/Phiên bản 9/);
});
test("status 400 leaves server state visible and never claims success",async()=>{
 const c=await loaded(await mount());await click(c,"Ngừng nhận đơn mới: Đà Nẵng");await act(async()=>fail(take("/admin/branches/dn/status"),400,"Trạng thái không hợp lệ"));
 assert.match(c.textContent,/Trạng thái không hợp lệ/);assert.doesNotMatch(c.textContent,/Đã ngừng/);assert.equal(button(c,"Ngừng nhận đơn mới: Đà Nẵng").disabled,false);assert.match(c.textContent,/Phiên bản 7/);
});
test("stale 409 blocks retries until fresh reload, then uses fresh version and succeeds",async()=>{
 const c=await loaded(await mount());await click(c,"Ngừng nhận đơn mới: Đà Nẵng");await act(async()=>fail(take("/admin/branches/dn/status"),409,"Version cũ"));
 assert.equal(button(c,"Ngừng nhận đơn mới: Đà Nẵng").disabled,true);assert.doesNotMatch(c.textContent,/Đã ngừng/);
 await click(c,"Tải dữ liệu mới");await loaded(c,[{...branch,status:"INACTIVE",version:10}]);await click(c,"Mở nhận đơn mới: Đà Nẵng");
 const fresh=take("/admin/branches/dn/status");assert.deepEqual(JSON.parse(fresh.config.data),{status:"ACTIVE",expectedVersion:10});
 await act(async()=>reply(fresh,{...branch,version:11}));await act(async()=>reply(take("/branches"),[{...branch,version:11}]));assert.match(c.textContent,/Đã mở/);
});
test("rename validation keeps input, stale edit reload resets selection and uses new version",async()=>{
 const c=await loaded(await mount(),[{...branch,status:"INACTIVE"}]);await click(c,"Chỉnh sửa");await fill(c,"name","Tên mới");
 const form=c.querySelector('[name="name"]').closest("form");await submit(form);const first=take("/admin/branches/dn");assert.deepEqual(JSON.parse(first.config.data),{name:"Tên mới",address:branch.address,version:7});
 await act(async()=>fail(first,400,"Tên không hợp lệ"));assert.equal(c.querySelector('[name="name"]').value,"Tên mới");assert.match(c.textContent,/Ngừng nhận đơn mới/);
 await submit(form);await act(async()=>fail(take("/admin/branches/dn"),409,"Version cũ"));await click(c,"Tải dữ liệu mới");await loaded(c,[{...branch,name:"Bản mới",status:"INACTIVE",version:12}]);
 await click(c,"Chỉnh sửa");await fill(c,"name","Tên cuối");await submit(c.querySelector('[name="name"]').closest("form"));assert.equal(JSON.parse(take("/admin/branches/dn").config.data).version,12);
});
for(const role of [null,"USER","STAFF"])test(`only ADMIN can load/mutate branches: ${role}`,async()=>{
 const c=await mount(role);assert.match(c.textContent,/Chỉ quản trị viên/);assert.equal(requests.length,0);assert.equal(c.querySelectorAll("button").length,0);
});
test("route configuration retains both inactive branches and version contract",async()=>{
 const c=await loaded(await mount(),[{...branch,status:"INACTIVE"},{id:"hn",name:"Hà Nội",address:"HN",status:"ACTIVE",version:1}]);
 const form=[...c.querySelectorAll("form")].find(f=>f.textContent.includes("Cấu hình tuyến"));assert.equal(form.querySelectorAll("select option").length,4);
 await submit(form);const r=take("/admin/branch-routes");assert.deepEqual(JSON.parse(r.config.data),{pickupBranchId:"dn",returnBranchId:"dn",fee:0,enabled:false,expectedVersion:0});assert.equal(requests.filter(r=>r.config.method==="put").length,1);
});
