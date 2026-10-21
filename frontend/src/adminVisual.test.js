import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {act,createElement as h} from "react";
import {JSDOM} from "jsdom";
import {createServer} from "vite";
let dom,vite,createRoot,MemoryRouter,Routes,Route,Link,NavigationEffects,Modal;
const descriptors=new Map();
before(async()=>{
 process.env.VITE_DATA_MODE="api";dom=new JSDOM("<!doctype html><body></body>",{url:"http://localhost/"});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})) {descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 ({createRoot}=await import("react-dom/client"));({MemoryRouter,Routes,Route,Link}=await import("react-router-dom"));
 vite=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),logLevel:"error",optimizeDeps:{noDiscovery:true},server:{middlewareMode:true}});
 ({default:NavigationEffects}=await vite.ssrLoadModule("/src/routes/NavigationEffects.jsx"));({default:Modal}=await vite.ssrLoadModule("/src/components/common/Modal.jsx"));
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
