import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { compareSelection, toggleCompare } from "./vehicleCompare.js";
test("comparison accepts zero to three unique IDs; invalid, duplicate and fourth are explicit",()=>{
 assert.deepEqual(compareSelection().ids,[]);
 assert.deepEqual(compareSelection("v1,v2,v3").ids,["v1","v2","v3"]);
 assert.ok(compareSelection("v1,v1").issue);assert.deepEqual(compareSelection("v1,../bad").ids,["v1"]);
 assert.ok(compareSelection("v1,v2,v3,v4").issue);
 assert.ok(toggleCompare(["v1","v2","v3"],"v4").issue);
 assert.deepEqual(toggleCompare(["v1","v2"],"v1").ids,["v2"]);
});
let dom,vite,createRoot,List,Compare,Detail,Auth,Router,Routes,Route,client;
const roots=[],originals=new Map(),oldMode=process.env.VITE_DATA_MODE;
const cars=Array.from({length:4},(_,i)=>({id:"v"+(i+1),name:"Car "+(i+1),brandId:"b",categoryId:"sedan",currentBranchId:"dn",status:"ACTIVE",transmission:"AUTO",seats:5,dailyPrice:600000+i*100000,amenities:[{id:"a",name:"Bluetooth"}]}));
const catalog={brands:[{id:"b",name:"Brand"}],categories:[{id:"sedan",name:"Sedan"}]};
let handler;
before(async()=>{
 dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
 for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 process.env.VITE_DATA_MODE="api";createRoot=(await import("react-dom/client")).createRoot;
 vite=await createServer({root:fileURLToPath(new URL("../..",import.meta.url)),server:{middlewareMode:true},appType:"custom",logLevel:"error"});
 ({ApiVehicleListPage:List,ApiVehicleDetailPage:Detail}=await vite.ssrLoadModule("/src/pages/api/ApiScreens.jsx"));({default:Compare}=await vite.ssrLoadModule("/src/pages/api/ApiVehicleComparePage.jsx"));({default:Auth}=await vite.ssrLoadModule("/src/context/AuthContext.jsx"));
 ({MemoryRouter:Router,Routes,Route}=await vite.ssrLoadModule("react-router-dom"));({default:client}=await vite.ssrLoadModule("/src/api/client.js"));
 client.defaults.adapter=async config=>({config,data:await handler(config),status:200,statusText:"OK",headers:{}});
});
function defaults(config){return config.url==="/vehicles"?cars:config.url==="/vehicles/catalog"?catalog:config.url==="/branches"?[{id:"dn",name:"Đà Nẵng",status:"ACTIVE"}]:config.url.endsWith("/reviews")?[]:cars.find(car=>config.url==="/vehicles/"+car.id);}
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());document.body.replaceChildren();});
after(async()=>{await vite.close();dom.window.close();for(const[k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}if(oldMode===undefined)delete process.env.VITE_DATA_MODE;else process.env.VITE_DATA_MODE=oldMode;});
async function mount(entry){handler ||= defaults;const c=document.createElement("div");document.body.append(c);const root=createRoot(c);roots.push(root);
 const routes=h(Routes,null,h(Route,{path:"/vehicles",element:h(List)}),h(Route,{path:"/vehicles/compare",element:h(Compare)}),h(Route,{path:"/vehicles/:vehicleId",element:h(Detail)}));
 await act(async()=>root.render(h(Router,{initialEntries:[entry]},h(Auth.Provider,{value:{user:null}},routes))));return c;
}
function btn(c,label){return c.querySelector(`button[aria-label="${label}"]`);}
test("actual list selection blocks fourth, survives detail and comparison, removal keeps filters",async()=>{
 handler=defaults;const c=await mount("/vehicles?brand=b&q=Car");
 for(const i of [1,2,3]) await act(async()=>btn(c,"So sánh Car "+i).click());
 await act(async()=>btn(c,"So sánh Car 4").click());assert.match(c.textContent,/Hãy bỏ một xe/);
 const link=[...c.querySelectorAll("a")].find(a=>a.textContent==="So sánh xe (3)");assert.equal(new URL(link.href).searchParams.get("compare"),"v1,v2,v3");
 await act(async()=>link.click());assert.equal(c.querySelectorAll(".compare-column").length,3);assert.match(c.textContent,/Bluetooth/);assert.match(c.textContent,/Đà Nẵng/);
 await act(async()=>btn(c,"Bỏ Car 2").click());assert.equal(c.querySelectorAll(".compare-column").length,2);
 const back=[...c.querySelectorAll("a")].find(a=>a.textContent==="Về danh sách xe");assert.equal(new URL(back.href).searchParams.get("brand"),"b");assert.equal(new URL(back.href).searchParams.get("q"),"Car");
 await act(async()=>back.click());await act(async()=>c.querySelector('.vehicle-card h2 a').click());assert.equal(btn(c,"Bỏ so sánh Car 1").getAttribute("aria-pressed"),"true");
});
test("empty/single/invalid selection and one failed vehicle do not invent data",async()=>{
 handler=defaults;let c=await mount("/vehicles/compare");assert.match(c.textContent,/Chọn thêm xe/);assert.equal(c.querySelectorAll(".compare-column").length,0);
 c=await mount("/vehicles/compare?compare=v1");assert.equal(c.querySelectorAll(".compare-column").length,1);
 handler=config=>{if(config.url==="/vehicles/missing")throw new Error("Vehicle unavailable");return defaults(config);};
 c=await mount("/vehicles/compare?compare=v1,missing,bad%2Fid");assert.match(c.textContent,/mã xe không hợp lệ/);assert.match(c.textContent,/Vehicle unavailable/);assert.match(c.textContent,/Car 1/);
});
