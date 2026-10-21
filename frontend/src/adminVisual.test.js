import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import process from "node:process";
import {fileURLToPath, URL} from "node:url";
import {displayCalendarDate, parseCalendarDate} from "./utils/calendarDate.js";
import {act,createElement as h} from "react";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
let dom,vite,createRoot,MemoryRouter,Routes,Route,Link,NavigationEffects,Modal,Status,Page,DateField,AdminBookingTable;
const descriptors=new Map();
before(async()=>{
 process.env.VITE_DATA_MODE="api";dom=new JSDOM("<!doctype html><body></body>",{url:"http://localhost/"});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})) {descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 ({createRoot}=await import("react-dom/client"));({MemoryRouter,Routes,Route,Link}=await import("react-router-dom"));
 vite=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),logLevel:"error",optimizeDeps:{noDiscovery:true},server:{middlewareMode:true}});
 ({default:NavigationEffects}=await vite.ssrLoadModule("/src/routes/NavigationEffects.jsx"));({default:Modal}=await vite.ssrLoadModule("/src/components/common/Modal.jsx"));
 ({Status,Page}=await vite.ssrLoadModule("/src/components/common/PageKit.jsx"));
 ({default:DateField}=await vite.ssrLoadModule("/src/components/common/DateField.jsx"));
 ({default:AdminBookingTable}=await vite.ssrLoadModule("/src/components/booking/AdminBookingTable.jsx"));
});
after(async()=>{await vite?.close();dom.window.close();for(const [k,d] of descriptors){if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}});
async function mount(node){const host=document.createElement("div");document.body.append(host);const root=createRoot(host);await act(async()=>root.render(node));return {host,async close(){await act(async()=>root.unmount());host.remove();}};}
test("Admin navigation resets its own scroll and focuses new heading",async()=>{
 const shell=document.createElement("main");shell.dataset.workspaceScroll="";document.body.append(shell);shell.scrollTop=230;let windowScrolls=0;window.scrollTo=()=>{windowScrolls++;};
 const page=await mount(h(MemoryRouter,null,h(NavigationEffects),h(Link,{to:"/second"},"Next"),h(Routes,null,h(Route,{path:"*",element:h("main",null,h("h1",null,"Title"))}))));
 assert.equal(shell.scrollTop,0);assert.equal(windowScrolls,0);shell.scrollTop=400;await act(async()=>page.host.querySelector("a").click());assert.equal(shell.scrollTop,0);assert.equal(document.activeElement.textContent,"Title");await page.close();shell.remove();
});
test("Modal locks and restores Admin scroller, Escape and focus",async()=>{
 const scroller=document.createElement("main");scroller.dataset.workspaceScroll="";scroller.style.overflow="auto";document.body.append(scroller);const trigger=document.createElement("button");scroller.append(trigger);trigger.focus();let closed=0;
 const page=await mount(h(Modal,{open:true,title:"Xác nhận",onClose:()=>closed++},h("button",null,"Hủy")));assert.equal(scroller.style.overflow,"hidden");assert.ok(page.host.querySelector('[role="dialog"]'));await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true})));assert.equal(closed,1);await page.close();assert.equal(scroller.style.overflow,"auto");assert.equal(document.activeElement,trigger);scroller.remove();
});

test("Date parser rejects impossible days and preserves leap days without timezone conversion",()=>{
 assert.equal(parseCalendarDate("29/02/2028"),"2028-02-29");
 for(const value of ["29/02/2026","31/04/2026","10/31/2026","1/10/2026", ""] ) assert.equal(parseCalendarDate(value),"");
 assert.equal(displayCalendarDate("2026-10-31"),"31/10/2026");
});
test("Admin breadcrumb is scoped and all booking states have distinct tones",async()=>{
 const states=["PENDING","CONFIRMED","IN_PROGRESS","RETURNED","COMPLETED","CANCELLED"];
 const page=await mount(h(MemoryRouter,{initialEntries:["/admin/vehicles"]},h(Page,{title:"Quản lý xe"},states.map(s=>h(Status,{key:s,status:s})))));
 assert.equal(page.host.querySelector(".eyebrow").textContent,"Quản trị / Quản lý xe");
 const badges=[...page.host.querySelectorAll("span.rounded-full")];assert.equal(badges.length,6);assert.equal(new Set(badges.map(x=>x.className)).size,6);
 await page.close();
 const user=await mount(h(MemoryRouter,{initialEntries:["/user/bookings"]},h(Page,{title:"Đơn"})));assert.match(user.host.textContent,/HÀNH TRÌNH CỦA BẠN/);await user.close();
});
test("Report date display is dd/mm/yyyy even when browser locale is English",async()=>{
 const page=await mount(h(DateField,{value:"2026-10-31",onChange:()=>{},required:true,"aria-label":"Đến ngày"}));
 assert.equal(page.host.querySelector('input[type="text"]').value,"31/10/2026");assert.equal(page.host.querySelector('input[type="date"]').value,"2026-10-31");assert.ok(page.host.querySelector('button[aria-label="Mở lịch Đến ngày"]'));await page.close();
});
test("Admin table preserves identity, Vietnamese dates, copy and detail links",async()=>{
 let copied="";const booking={id:"12345678-full-id",customerName:"Khách kiểm thử",vehicleName:"Xe kiểm thử",status:"IN_PROGRESS",total:2100000,policyVersion:"calendar-2026-10-17",startAt:"2026-10-22T00:00:00+07:00",endAt:"2026-10-23T00:00:00+07:00",pickupName:"Đà Nẵng",returnName:"Huế"};
 const page=await mount(h(MemoryRouter,null,h(AdminBookingTable,{bookings:[booking],onCopy:id=>{copied=id;},copyFeedback:{},manualCopyId:null})));
 assert.equal(page.host.querySelectorAll("tbody tr").length,1);assert.equal(page.host.querySelector("a").getAttribute("href"),"/admin/bookings/12345678-full-id");assert.match(page.host.textContent,/22\/10\/2026/);assert.match(page.host.textContent,/Đang thuê/);await act(async()=>page.host.querySelector("button").click());assert.equal(copied,booking.id);assert.equal(page.host.querySelector("input").value,booking.id);await page.close();
});
