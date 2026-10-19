// Independent component regressions; no database writes or implementation copies.
// Usage: node scripts/operations/verify-admin-p01-p04-review.cjs .runtime/<new-directory>
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] || '');
assert(out.startsWith(path.join(repo, '.runtime') + path.sep) && !fs.existsSync(out), 'New runtime directory required');
fs.mkdirSync(out, { recursive: true });
const resolve = createRequire(path.join(repo, 'frontend/package.json'));
const probes = [
  ['routes', 'frontend/src/utils/branchStatus.test.js', `
test('REVIEW: explicit route refresh must replace stale draft/version before next save', async()=>{
 const initial={id:'r',pickupBranchId:'dn',returnBranchId:'dn',fee:100,enabled:true,version:2};
 const c=await loaded(await mount(),[branch],[initial]);
 let form=[...c.querySelectorAll('form')].find(f=>f.textContent.includes('Cấu hình tuyến'));
 await submit(form);await act(async()=>fail(take('/admin/branch-routes'),409,'changed'));
 await act(async()=>[...c.querySelectorAll('button')].find(b=>b.textContent.includes('Tải lại dữ liệu tuyến')).click());
 await act(async()=>reply(take('/branch-routes'),[{...initial,version:3,fee:120}]));
 form=[...c.querySelectorAll('form')].find(f=>f.textContent.includes('Cấu hình tuyến'));
 const fee=form.querySelector('input[type="number"]').value;
 await submit(form);const version=JSON.parse(take('/admin/branch-routes').config.data).expectedVersion;
 assert.deepEqual({fee,version},{fee:'120',version:3},'Explicit refresh must load current fee/version before next save');
});`],
  ['vehicles', 'frontend/src/pages/api/vehiclesManagement.test.js', `
test('REVIEW: second vehicle save must use version returned by first save',async()=>{
 const c=await loaded();await act(async()=>button(c,'Chỉnh sửa').click());
 await act(async()=>{resolve(take('/admin/vehicles/new/images'),{images:[],revision:'img'});resolve(take('/admin/vehicles/new/amenities'),{amenities:[],revision:'am'});});
 await act(async()=>button(c,'Lưu thay đổi').click());
 const first=take('/admin/vehicles/new','put');assert.equal(JSON.parse(first.config.data).version,4);
 await act(async()=>resolve(first,{...vehicle,version:5}));
 await act(async()=>resolve(take('/vehicles'),[{...vehicle,version:5}]));
 await act(async()=>button(c,'Lưu thay đổi').click());
 const second=take('/admin/vehicles/new','put');
 const actual=JSON.parse(second.config.data).version;
 await unmountAll();assert.equal(actual,5,'Successful save must advance form version');
});`],
];
const results=[];
for(const [name, source, extra] of probes){
 let text=fs.readFileSync(path.join(repo,source),'utf8');
 for(const pkg of ['react','jsdom','vite'])text=text.replaceAll(`from "${pkg}"`,`from ${JSON.stringify(pathToFileURL(resolve.resolve(pkg)).href)}`);
 text=text.replace('from "axios"',`from ${JSON.stringify(pathToFileURL(path.join(path.dirname(resolve.resolve('axios/package.json')),'index.js')).href)}`);
 text=text.replaceAll('import("react-dom/client")',`import(${JSON.stringify(pathToFileURL(resolve.resolve('react-dom/client')).href)})`);
 text=text.replace('fileURLToPath(new URL("../..",import.meta.url))',JSON.stringify(path.join(repo,'frontend')));
 text=text.replace('fileURLToPath(new URL("../../..", import.meta.url))',JSON.stringify(path.join(repo,'frontend')));
 const target=path.join(out,name+'.test.mjs');fs.writeFileSync(target,text+extra);
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',target],{cwd:path.join(repo,'frontend'),encoding:'utf8',timeout:120000,windowsHide:true});
 fs.writeFileSync(path.join(out,name+'.log'),(result.stdout||'')+(result.stderr||''));
 results.push({name,source,exit:result.status,error:result.error?.message});
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
process.exitCode=results.every(r=>r.exit===0)?0:1;
