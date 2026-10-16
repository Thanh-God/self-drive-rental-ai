// Read-only actual API visual smoke; no database writes and no API interception.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.KDRIVE_PLAYWRIGHT);
function light(color){const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
function contrast(a,b){const x=[light(a),light(b)].sort((a,b)=>b-a);return(x[0]+.05)/(x[1]+.05);}
async function main(){
 const out=process.env.OTO2_EVIDENCE;assert.ok(fs.existsSync(path.join(out,'fixture-readback.json')));const checks=[],errors=[];
 const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1280,height:1000}});p.setDefaultTimeout(15000);p.on('pageerror',error=>errors.push(error.message));
  await p.goto('http://127.0.0.1:5382/vehicles');await p.locator('.vehicle-card').first().waitFor();
  const note=p.locator('.vehicle-card .text-slate-400').first();const textColor=await note.evaluate(e=>getComputedStyle(e).color);
  check('Actual card secondary text contrast',contrast(textColor,'rgb(255,255,255)')>=4.5,true);
  const input=p.getByPlaceholder('Tên xe, mẫu xe...');const border=await input.evaluate(e=>getComputedStyle(e).borderColor);
  check('Actual input border contrast',contrast(border,'rgb(255,255,255)')>=3,true);
  const secondary=p.locator('.vehicle-card a.btn-secondary').first();check('Secondary action white surface',await secondary.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
  await input.focus();check('Keyboard focus visible',await input.evaluate(e=>parseFloat(getComputedStyle(e).outlineWidth)>0),true);
  const primary=p.getByRole('button',{name:'Tìm xe',exact:true});const colors=await primary.evaluate(e=>({text:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));
  check('Actual primary label contrast',contrast(colors.text,colors.bg)>=4.5,true);
  for(const width of [1280,768,390]){await p.setViewportSize({width,height:1000});check('No overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'readability-'+width+'.png'),fullPage:true});}
  check('Runtime errors',errors,[]);
 }finally{await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,apiMocks:false,stage6:false},null,2));}
 console.log('PASS readability '+checks.length+' assertions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
