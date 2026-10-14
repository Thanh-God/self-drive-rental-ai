const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.C11_PLAYWRIGHT),out=process.env.C11_EVIDENCE,base='http://127.0.0.1:5300',checks=[];
function check(name,actual,expected){assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});fs.writeFileSync(path.join(out,'catalog-assertions.json'),JSON.stringify(checks,null,2));}
async function main(){
 const browser=await chromium.launch({headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/vehicles');await p.getByRole('heading',{name:'Mitsubishi Xpander',exact:true}).waitFor();
  const bar=p.getByRole('navigation',{name:'Lọc theo hãng xe',exact:true});check('Dynamic seeded brands',await bar.getByRole('link').count(),4);
  const brand=bar.getByRole('link',{name:'Mitsubishi',exact:true}),href=await brand.getAttribute('href');await brand.click();await p.waitForURL(base+href);
  await p.waitForFunction(href=>Array.from(document.querySelectorAll('nav.brand-bar a')).some(a=>a.getAttribute('href')===href&&a.getAttribute('aria-current')==='true'),href);await p.getByRole('heading',{name:'Mitsubishi Xpander',exact:true}).waitFor();
  check('Brand selection current',await bar.getByRole('link',{name:'Mitsubishi',exact:true}).getAttribute('aria-current'),'true');check('Filter excludes Toyota',await p.locator('a[href="/vehicles/v1"]').count(),0);check('Filter excludes Hyundai',await p.locator('a[href="/vehicles/v3"]').count(),0);check('Filter keeps Mitsubishi',await p.locator('a[href="/vehicles/v2"]').count()>0,true);
  await p.getByLabel('Tìm xe',{exact:true}).fill('does-not-exist-c14');await p.getByRole('heading',{name:'Mitsubishi Xpander',exact:true}).waitFor({state:'hidden'});check('Search empty no car links',await p.locator('a[href="/vehicles/v2"]').count(),0);await p.getByLabel('Tìm xe',{exact:true}).fill('Xpander');await p.getByRole('heading',{name:'Mitsubishi Xpander',exact:true}).waitFor();
  await p.locator('a[href="/vehicles/v2"]').first().click();await p.waitForURL(base+'/vehicles/v2');await p.locator('section.vehicle-gallery').waitFor();check('Detail correct vehicle',await p.getByRole('heading',{name:'Mitsubishi Xpander',exact:true,level:1}).count(),1);check('Fixture no-image fallback',await p.getByText('Ảnh chưa cập nhật',{exact:true}).isVisible(),true);check('No demo photo without API images',await p.locator('section.vehicle-gallery img').count(),0);
  const target=await p.getByRole('link',{name:'Kiểm tra giá & lịch',exact:true}).getAttribute('href');check('Detail quote target correct car',new URL(base+target).searchParams.get('vehicleId'),'v2');await p.getByRole('link',{name:'Kiểm tra giá & lịch',exact:true}).click();await p.waitForURL('**/login*');check('Guest booking requires login',true,true);
  await p.getByLabel('Email',{exact:true}).fill('user@example.test');await p.getByLabel('Mật khẩu',{exact:true}).fill('BranchBookingTestOnly123!');await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.waitForURL(url=>url.pathname!=='/login');
  await p.goto(base+target);await p.getByLabel('Chi nhánh nhận xe',{exact:true}).waitFor();check('Booking form receives correct car',await p.getByRole('heading',{name:'Mitsubishi Xpander',exact:true}).count(),1);check('No unsolicited quote or booking',await p.getByRole('heading',{name:'Báo giá xác nhận',exact:true}).count(),0);
  for(const width of [1280,1440]){await p.setViewportSize({width,height:1000});check('Desktop no overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(out,'catalog-quote-'+width+'.png'),fullPage:true});}
  check('Runtime errors',errors,[]);console.log('PASS catalog browser '+checks.length);
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
