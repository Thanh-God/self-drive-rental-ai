// Real browser zoom via a temporary extension, never CSS zoom/device emulation.
// https://playwright.dev/docs/chrome-extensions ; https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require(path.resolve(".runtime/phase5-rerun-20261004-1823/playwright/node_modules/playwright"));
const out=path.resolve(process.argv[2]);assert.ok(out.includes(path.sep+".runtime"+path.sep));assert.ok(!fs.existsSync(out));fs.mkdirSync(out);const ext=path.join(out,"zoom-extension");fs.mkdirSync(ext);
fs.writeFileSync(path.join(ext,"manifest.json"),JSON.stringify({manifest_version:3,name:"KDrive isolated zoom QA",version:"1.0",host_permissions:["http://127.0.0.1/*"],background:{service_worker:"background.js"}}));fs.writeFileSync(path.join(ext,"background.js"),'chrome.runtime.onInstalled.addListener(() => {});');
const checks=[];function check(name,actual,expected=true){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,"assertions.json"),JSON.stringify(checks,null,2));}
(async()=>{
 const crypto=require("node:crypto");
 function inputs(){const files=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else files.push(file);}}walk("frontend/src");files.push("frontend/package.json","frontend/package-lock.json","frontend/vite.config.js",__filename);return Object.fromEntries(files.map(f=>[path.relative(process.cwd(),f),crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")]));}
 const sourceBefore=inputs();fs.writeFileSync(path.join(out,"inputs-before.json"),JSON.stringify(sourceBefore,null,2));

 const config=fs.readFileSync("backend/.env.local","utf8"),password=process.env.KDRIVE_ADMIN_PASSWORD||config.match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g,"");assert.ok(password);
 const r=await fetch("http://127.0.0.1:8080/api/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"admin@example.test",password})});assert.equal(r.status,200);const token=(await r.json()).token;
 const context=await chromium.launchPersistentContext(path.join(out,"profile.private"),{channel:"chromium",headless:true,viewport:{width:1366,height:768},locale:"en-US",args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 try {
 let sw=context.serviceWorkers()[0];if(!sw)sw=await context.waitForEvent("serviceworker",{timeout:15000});
 await context.addInitScript(jwt=>localStorage.setItem("kdrive.jwt",jwt),token);const p=await context.newPage(),errors=[];p.on("pageerror",e=>errors.push(e.message));
 await p.route("**/api/v1/**",route=>["GET","HEAD","OPTIONS"].includes(route.request().method())?route.continue():route.abort("blockedbyclient"));
 await p.goto("http://127.0.0.1:5173/admin");await p.locator("[data-metric]").first().waitFor();
 const zoom=await sw.evaluate(async()=>{
const [tab]=await chrome.tabs.query({url:"http://127.0.0.1:5173/*"});await chrome.tabs.setZoom(tab.id,1.25);return chrome.tabs.getZoom(tab.id);});check("Actual browser zoom",zoom,1.25);await p.waitForTimeout(250);
 const metrics=await p.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));check("Zoom reflows viewport",metrics.width<1366);
 const main=p.locator(".admin-main"),aside=p.locator("aside"),header=p.locator(".admin-shell > header");
 await p.getByRole("button",{name:"Mở lịch Đến ngày"}).click();await p.keyboard.press("Escape");check("Native calendar opens without error",errors.length,0);
 for(const route of ["/admin","/admin/bookings","/admin/catalog"]){await p.goto("http://127.0.0.1:5173"+route);await p.locator("h1").waitFor();await p.waitForTimeout(150);const before=await header.boundingBox(),side=await aside.boundingBox();await main.evaluate(e=>{e.scrollTop=e.scrollHeight;});await p.waitForTimeout(100);check("Header stable at125 "+route,Math.abs((await header.boundingBox()).y-before.y)<1);check("Sidebar stable at125 "+route,Math.abs((await aside.boundingBox()).y-side.y)<1);check("No outer overflow at125 "+route,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1));await aside.getByRole("link",{name:"Kiểm duyệt đánh giá",exact:true}).scrollIntoViewIfNeeded();check("All menus reachable at125 "+route,await aside.getByRole("link",{name:"Kiểm duyệt đánh giá",exact:true}).isVisible());await main.evaluate(e=>{e.scrollTop=0;});await p.screenshot({path:path.join(out,route.endsWith("bookings")?"bookings-125.png":route.endsWith("catalog")?"catalog-125.png":"overview-125.png")});}
 check("No runtime errors at125",errors.length,0);check("Source unchanged during proof",inputs(),sourceBefore);fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({status:"PASS real browser125%",zoom,metrics,assertions:checks.length,errors},null,2));console.log("PASS real125%",checks.length,"assertions",JSON.stringify(metrics));
 }finally{await context.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
