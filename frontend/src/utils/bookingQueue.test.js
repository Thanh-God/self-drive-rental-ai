import assert from 'node:assert/strict';
import {before,after,afterEach,test} from 'node:test';
import {act,createElement as h} from 'react';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
import {fileURLToPath,URL} from 'node:url';
import process from 'node:process';
import {vietnamDay,visibleBookings} from './bookingQueue.js';
import {bookingStatusLabels,roleLabels} from './uiLabels.js';
const now=Date.parse('2026-10-15T17:30:00Z');
const rows=[
 {id:'old',vehicleName:'Xe cũ',customerName:'Khách A',status:'CONFIRMED',createdAt:'2026-10-15T16:59:59Z',startAt:'2026-10-15T17:15:00Z',endAt:'2026-10-17T03:00:00Z',total:100,pickupName:'Đà Nẵng',returnName:'Hà Nội'},
 {id:'new',vehicleName:'Xe mới',customerName:'Khách B',status:'CONFIRMED',createdAt:'2026-10-15T17:00:00Z',startAt:'2026-10-16T17:00:00Z',endAt:'2026-10-18T03:00:00Z',total:200},
 {id:'return',vehicleName:'Xe trả',customerName:'Khách C',status:'IN_PROGRESS',createdAt:'2026-10-14T03:00:00Z',startAt:'2026-10-14T03:00:00Z',endAt:'2026-10-15T17:00:00Z',total:300},
 {id:'latest',vehicleName:'Xe vừa tạo',customerName:'Khách D',status:'PENDING',createdAt:'2026-10-15T17:30:00Z',startAt:'2026-10-20T03:00:00Z',endAt:'2026-10-21T03:00:00Z',total:400},
];
const ids=x=>x.map(r=>r.id);
test('Vietnam midnight, invalid dates and actual creation order independent of rental date',()=>{
 assert.equal(vietnamDay('2026-10-15T16:59:59Z'),'2026-10-15');assert.equal(vietnamDay('2026-10-15T17:00:00Z'),'2026-10-16');assert.equal(vietnamDay('invalid'),'');assert.equal(vietnamDay(null),'');
 assert.deepEqual(ids(visibleBookings(rows)),['latest','new','old','return']);assert.deepEqual(ids(rows),['old','new','return','latest']);
 assert.deepEqual(ids(visibleBookings([...rows,{id:'unknown',createdAt:'bad'}])),['latest','new','old','return','unknown']);
 const ties=[{id:'z',createdAt:rows[0].createdAt},{id:'a',createdAt:rows[0].createdAt}];assert.deepEqual(ids(visibleBookings(ties)),['a','z']);
});
test('Today uses creation, pickup or return by work mode and composes status/search; All removes only day limit',()=>{
 assert.deepEqual(ids(visibleBookings(rows,{queue:'today',now})),['latest','new']);
 assert.deepEqual(ids(visibleBookings(rows,{queue:'today',mode:'handover',status:'CONFIRMED',now})),['old']);
 assert.deepEqual(ids(visibleBookings(rows,{queue:'today',mode:'return',status:'IN_PROGRESS',now})),['return']);
 assert.deepEqual(ids(visibleBookings(rows,{queue:'all',mode:'handover',status:'CONFIRMED',query:'Khách',now})),['new','old']);
 assert.deepEqual(ids(visibleBookings(rows,{queue:'today',mode:'handover',query:'Khách B',now})),[]);
 assert.deepEqual(visibleBookings(null,{queue:'today',now}),[]);
});
let dom,vite,createRoot,List,Topbar,Auth,Router,client,originalNow;const originals=new Map(),roots=[],oldMode=process.env.VITE_DATA_MODE;
before(async()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
 for(const[k,v]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){originals.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
 process.env.VITE_DATA_MODE='api';createRoot=(await import('react-dom/client')).createRoot;vite=await createServer({root:fileURLToPath(new URL('../..',import.meta.url)),server:{middlewareMode:true},appType:'custom',logLevel:'error'});
 ({ApiBookingListPage:List}=await vite.ssrLoadModule('/src/pages/api/ApiScreens.jsx'));({default:Topbar}=await vite.ssrLoadModule('/src/layouts/WorkspaceTopbar.jsx'));({default:Auth}=await vite.ssrLoadModule('/src/context/AuthContext.jsx'));({MemoryRouter:Router}=await vite.ssrLoadModule('react-router-dom'));({default:client}=await vite.ssrLoadModule('/src/api/client.js'));client.defaults.adapter=async config=>({config,data:rows,status:200,statusText:'OK',headers:{}});originalNow=Date.now;Date.now=()=>now;
});
afterEach(async()=>{for(const root of roots.splice(0))await act(async()=>root.unmount());document.body.replaceChildren();});
after(async()=>{Date.now=originalNow;await vite.close();dom.window.close();for(const[k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}if(oldMode===undefined)delete process.env.VITE_DATA_MODE;else process.env.VITE_DATA_MODE=oldMode;});
async function mount(mode='all'){const c=document.createElement('div');document.body.append(c);const root=createRoot(c);roots.push(root);await act(async()=>root.render(h(Router,null,h(Auth.Provider,{value:{user:{id:'staff',role:'STAFF',fullName:'Nhân viên kiểm thử'}}},h(Topbar,{areaLabel:'Nhân viên'}),h(List,{area:'staff',mode})))));return c;}
async function select(el,value){await act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});}
const names=c=>[...c.querySelectorAll('article h2')].map(el=>el.textContent);
test('Actual staff page renders Vietnamese enum labels, newest first, Today and refresh without losing filters',async()=>{
 const c=await mount();assert.deepEqual(names(c),['Xe vừa tạo','Xe mới','Xe cũ','Xe trả']);assert.match(c.querySelector('header').textContent,/Nhân viên/);assert.doesNotMatch(c.querySelector('header').textContent,/STAFF/);
 const [status,queue]=c.querySelectorAll('select');assert.deepEqual([...status.options].slice(1).map(o=>o.textContent),Object.values(bookingStatusLabels));assert.equal(status.options[1].value,'PENDING');assert.equal(queue.value,'all');
 await select(queue,'today');assert.deepEqual(names(c),['Xe vừa tạo','Xe mới']);await select(status,'CONFIRMED');assert.deepEqual(names(c),['Xe mới']);await act(async()=>[...c.querySelectorAll('button')].find(b=>b.textContent==='Tải lại danh sách').click());assert.equal(queue.value,'today');assert.equal(status.value,'CONFIRMED');assert.deepEqual(names(c),['Xe mới']);await select(queue,'all');assert.deepEqual(names(c),['Xe mới','Xe cũ']);assert.match(c.textContent,/ngày tạo đơn/);
 assert.equal(roleLabels.ADMIN,'Quản trị viên');
});
test('Actual handover/return pages apply work dates and retain operation route IDs',async()=>{
 const c=await mount('handover'),[status,queue]=c.querySelectorAll('select');assert.equal(status.value,'CONFIRMED');await select(queue,'today');assert.deepEqual(names(c),['Xe cũ']);assert.match(c.querySelector('article a').getAttribute('href'),/\/staff\/handover\/old$/);assert.match(c.textContent,/ngày nhận xe/);
 const d=await mount('return'),fields=d.querySelectorAll('select');assert.equal(fields[0].value,'IN_PROGRESS');await select(fields[1],'today');assert.deepEqual(names(d),['Xe trả']);assert.match(d.querySelector('article a').getAttribute('href'),/\/staff\/return\/return$/);assert.match(d.textContent,/ngày trả xe/);
});
