import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import process from "node:process";
import { searchParams, searchSuffix, tripSearch } from "./vehicleSearch.js";
const query="start=2026-11-20T10%3A00&end=2026-11-21T10%3A00&pickupBranchId=dn&returnBranchId=hn&budget=2200000";
test("trip URL converts Vietnam time, preserves only supported keys, clears brand independently",()=>{
 const p=new URLSearchParams(query+"&brand=a&token=private");
 const result=tripSearch(p); assert.equal(result.error,"");
 const api=new URL(result.path,"http://localhost");assert.equal(api.searchParams.get("startAt"),"2026-11-20T03:00:00.000Z");assert.equal(api.searchParams.get("budget"),"2200000");
 const next=searchParams(p,{brand:""});assert.equal(next.has("token"),false);assert.equal(next.has("brand"),false);assert.equal(next.get("pickupBranchId"),"dn");assert.ok(searchSuffix(next).startsWith("?"));
});
test("partial trip, malformed dates, reversed time, fractional and unsafe budgets cannot fall back to catalog",()=>{
 assert.equal(tripSearch(new URLSearchParams()).active,false);
 for(const suffix of ["start=bad",query.replace("2026-11-21","2026-11-19"),query.replace("2200000","1.5"),query.replace("2200000","9007199254740992")]) {
  const result=tripSearch(new URLSearchParams(suffix));assert.equal(result.active,true);assert.ok(result.error);assert.equal(result.path,"");
 }
});
let dom,vite,createRoot,List,Detail,Booking,Router,Routes,Route,client,Auth;
const roots=[],originals=new Map(),oldMode=process.env.VITE_DATA_MODE;
const car={id:"v1",name:"Search Sedan",brandId:"a",categoryId:"sedan",status:"ACTIVE",transmission:"AUTO",seats:5,dailyPrice:650000};
const catalog={brands:[{id:"a",name:"Alpha"}],categories:[{id:"sedan",name:"Sedan"}]};
const branches=[{id:"dn",name:"Đà Nẵng",status:"ACTIVE"},{id:"hn",name:"Hà Nội",status:"ACTIVE"}];
let searchHandler;
before(async()=>{
 dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 process.env.VITE_DATA_MODE="api";createRoot=(await import("react-dom/client")).createRoot;
 vite=await createServer({root:fileURLToPath(new URL("../..",import.meta.url)),server:{middlewareMode:true},appType:"custom",logLevel:"error"});
 ({ApiVehicleListPage:List,ApiVehicleDetailPage:Detail,ApiNewBookingPage:Booking}=await vite.ssrLoadModule("/src/pages/api/ApiScreens.jsx"));({default:Auth}=await vite.ssrLoadModule("/src/context/AuthContext.jsx"));
 ({MemoryRouter:Router,Routes,Route}=await vite.ssrLoadModule("react-router-dom"));({default:client}=await vite.ssrLoadModule("/src/api/client.js"));
 client.defaults.adapter=async config=>({config,data:config.url.startsWith("/vehicles/search?")?await searchHandler(config):config.url==="/vehicles"?[car]:config.url==="/vehicles/catalog"?catalog:config.url==="/branches"?branches:config.url==="/branch-routes"?[{id:"dn-hn",enabled:true,pickupBranchId:"dn",returnBranchId:"hn"}]:config.url.endsWith("/reviews")?[]:car,status:200,statusText:"OK",headers:{}});
});
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());document.body.replaceChildren();});
after(async()=>{await vite.close();dom.window.close();for(const[k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}if(oldMode===undefined)delete process.env.VITE_DATA_MODE;else process.env.VITE_DATA_MODE=oldMode;});
async function mount(entry){
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);roots.push(root);
 const routes=h(Routes,null,h(Route,{path:"/vehicles",element:h(List)}),h(Route,{path:"/vehicles/:vehicleId",element:h(Detail)}),h(Route,{path:"/user/bookings/new",element:h(Booking)}));
 await act(async()=>root.render(h(Router,{initialEntries:[entry]},h(Auth.Provider,{value:{user:{id:"u",role:"USER"}}},routes))));return c;
}
test("server total is displayed and trip survives brand, detail, back link and booking defaults",async()=>{
 searchHandler=async()=>({items:[{vehicle:car,total:2150000,rentalDays:1}]});const c=await mount("/vehicles?"+query);
 assert.match(c.querySelector(".vehicle-card").textContent,/Tổng chuyến:.*2\.150\.000/);
 const brand=[...c.querySelectorAll("nav a")].find(a=>a.textContent==="Alpha");assert.equal(new URL(brand.href).searchParams.get("budget"),"2200000");
 await act(async()=>c.querySelector(".vehicle-card h2 a").click());
 const back=[...c.querySelectorAll("a")].find(a=>a.textContent==="Về danh sách xe");assert.equal(new URL(back.href).searchParams.get("pickupBranchId"),"dn");
 const booking=[...c.querySelectorAll("a")].find(a=>a.getAttribute("href").startsWith("/user/bookings/new"));await act(async()=>booking.click());
 assert.deepEqual([...c.querySelectorAll('input[type="datetime-local"]')].map(i=>i.value),["2026-11-20T10:00","2026-11-21T10:00"]);
 assert.deepEqual([...c.querySelectorAll("select")].slice(0,2).map(i=>i.value),["dn","hn"]);
 const listBack=[...c.querySelectorAll("a")].find(a=>a.textContent==="Quay lại danh sách xe");assert.equal(new URL(listBack.href).searchParams.get("budget"),"2200000");
});
test("API error hides catalog and retry fetches real search; empty result remains empty",async()=>{
 searchHandler=async()=>{throw new Error("search unavailable");};const c=await mount("/vehicles?"+query);assert.equal(c.querySelectorAll(".vehicle-card").length,0);assert.match(c.textContent,/search unavailable/);
 searchHandler=async()=>({items:[]});await act(async()=>[...c.querySelectorAll("button")].find(b=>b.textContent==="Thử tải lại").click());assert.equal(c.querySelectorAll(".vehicle-card").length,0);assert.match(c.textContent,/Không tìm thấy xe/);
});
