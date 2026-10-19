// Real Admin form -> USER catalog -> OSRM route. Synthetic isolated fixture only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.C11_PLAYWRIGHT),out=process.env.C11_EVIDENCE;
async function main(){
 const checks=[],errors=[],consoleErrors=[],origin='http://127.0.0.1:5300',api='http://127.0.0.1:8300/api/v1';
 const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
 const browser=await chromium.launch({headless:true});
 try{
  const setup=await browser.newContext();
  const signed=await setup.request.post(api+'/auth/login',{data:{email:'admin@example.test',password:'BranchBookingTestOnly123!'}});check('Fixture admin login',signed.status(),200);
  const headers={Authorization:'Bearer '+(await signed.json()).token};
  const cat=await setup.request.post(api+'/admin/location-categories',{headers,data:{name:'AI3 browser fixture'}});check('Category setup',cat.status(),201);
  const categoryId=(await cat.json()).id,ids=[];
  for(const [name,latitude,longitude]of [['AI3 Cầu Rồng',16.0611,108.2232],['AI3 Hội An',15.8801,108.338],['AI3 ngoài mạng',0,0]]){
   const res=await setup.request.post(api+'/admin/locations',{headers,data:{categoryId,name,latitude,longitude,status:'ACTIVE'}});check('Create '+name,res.status(),201);ids.push((await res.json()).id);
  }
  await setup.close();
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  async function login(email){await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Mật khẩu',{exact:true}).fill('BranchBookingTestOnly123!');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(u=>u.pathname!=='/login');}
  async function clear(){await page.goto(origin+'/login');await page.evaluate(()=>{localStorage.removeItem('kdrive.jwt');localStorage.removeItem('kdrive.user');});}
  await login('admin@example.test');await page.goto(origin+'/admin/locations');
  await page.getByRole('button',{name:'Sửa AI3 Cầu Rồng',exact:true}).click();
  await page.getByText('Lịch mở cửa theo tuần',{exact:true}).click();
  await page.getByLabel('Giờ hoạt động Thứ hai',{exact:true}).selectOption('INTERVALS');
  await page.getByLabel('Mở cửa Thứ hai 1',{exact:true}).fill('22:00');
  await page.getByLabel('Đóng cửa Thứ hai 1',{exact:true}).fill('02:00');
  await page.getByLabel('Đóng vào ngày kế tiếp',{exact:true}).check();
  await page.getByText('Ngày ngoại lệ (0)',{exact:true}).click();
  await page.getByLabel('Thêm ngày ngoại lệ',{exact:true}).fill('2026-12-25');
  await page.getByLabel('Giờ hoạt động 2026-12-25',{exact:true}).selectOption('CLOSED');
  await page.getByLabel('Đường dẫn nguồn lịch mở cửa',{exact:true}).fill('https://example.org/fixture-hours');
  await page.getByLabel('Ngày kiểm chứng lịch mở cửa',{exact:true}).fill('2020-01-01');
  await page.getByLabel('Thời lượng ghé ước tính (phút)',{exact:true}).fill('60');
  await page.getByLabel('Đường dẫn nguồn thời lượng',{exact:true}).fill('https://example.org/fixture-duration');
  await page.getByLabel('Ngày kiểm chứng thời lượng',{exact:true}).fill('2020-01-01');
  const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/admin/locations/'+ids[0]));
  await page.getByRole('button',{name:'Lưu địa điểm',exact:true}).click();const res=await saved;check('Admin metadata save',res.status(),200);
  const data=await res.json();check('Overnight saved',data.metadata.weekly.MONDAY.intervals[0].nextDay);check('Date exception',data.metadata.exceptions['2026-12-25'].state,'CLOSED');
  await page.getByRole('button',{name:'Sửa AI3 Cầu Rồng',exact:true}).click();check('Duration survives reload',await page.getByLabel('Thời lượng ghé ước tính (phút)',{exact:true}).inputValue(),'60');
  await page.screenshot({path:path.join(out,'admin-metadata-1440.png'),fullPage:true});
  check('Admin no customer assistant',await page.getByRole('button',{name:'Mở Trợ lý KDrive',exact:true}).count(),0);
  await clear();await login('user@example.test');let userWrites=0;page.on('request',request=>{if(['POST','PUT','PATCH','DELETE'].includes(request.method())&&!request.url().includes('/auth/')&&!request.url().endsWith('/ai/routes/preview'))userWrites++;});await page.getByRole('button',{name:'Mở Trợ lý KDrive',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Trợ lý KDrive'});await dialog.getByText('Khám phá địa điểm và tuyến đường',{exact:true}).click();
  await dialog.getByLabel('Điểm 1',{exact:true}).locator('option[value="'+ids[0]+'"]').waitFor({state:'attached'});
  await dialog.getByLabel('Điểm 1',{exact:true}).selectOption(ids[0]);await dialog.getByLabel('Điểm 2',{exact:true}).selectOption(ids[1]);
  check('Unknown legacy facts displayed',(await dialog.textContent()).includes('Chưa xác minh'));
  check('Admin duration visible',(await dialog.textContent()).includes('60 phút (quản trị ước tính)'));
  const route=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/ai/routes/preview'));
  await dialog.getByRole('button',{name:'Xem tuyến ô tô',exact:true}).click();const routed=await route;check('Real route API',routed.status(),200);check('Real route VERIFIED',(await routed.json()).status,'VERIFIED');
  await dialog.getByText(/phút lái xe/).waitFor();await dialog.getByText(/phút lái xe/).scrollIntoViewIfNeeded();check('Region disclosed',(await dialog.textContent()).includes('Đà Nẵng–Hội An'));
  await page.screenshot({path:path.join(out,'user-route-1440.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});check('Desktop no overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await dialog.getByLabel('Điểm 2',{exact:true}).selectOption(ids[2]);
  const missing=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/ai/routes/preview'));await dialog.getByRole('button',{name:'Xem tuyến ô tô',exact:true}).click();check('No route remains explicit',(await (await missing).json()).status,'NO_ROUTE');
  await dialog.getByText('Chưa có tuyến ô tô kiểm chứng cho các điểm đã chọn.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Bắt đầu lại',exact:true}).click();check('Reset collapses routes',await dialog.locator('.assistant-routes').getAttribute('open'),null);
  check('No USER business writes',userWrites,0);check('No page errors',errors,[]);check('No console errors',consoleErrors,[]);
  fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2));fs.writeFileSync(path.join(out,'console.json'),JSON.stringify({errors,consoleErrors}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
