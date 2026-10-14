// Real app/backend/MySQL. Isolated fixture only. No route interception.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.KDRIVE_PLAYWRIGHT);
async function main() {
  const out=process.env.OTO2_EVIDENCE;
  assert.ok(out && fs.existsSync(path.join(out,'fixture-readback.json')));
  const api='http://127.0.0.1:8382/api/v1', origin='http://127.0.0.1:5382';
  const checks=[],errors=[];
  const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual,expected});};
  async function post(url,body,token){const r=await fetch(api+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});assert.ok(r.ok);return r.json();}
  const admin=await post('/auth/login',{email:'admin@example.test',password:process.env.OTO2_SEED_PASSWORD});
  const compact=await post('/admin/vehicle-categories',{name:'Hatchback'},admin.token);
  const browser=await chromium.launch({headless:true});
  try {
    const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);
    p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await p.goto(origin+'/vehicles?brand=toyota');await p.locator('.vehicle-card').waitFor();
    const form=p.getByRole('form',{name:'Tìm xe theo chuyến'});
    const search=form.getByRole('button',{name:'Tìm xe',exact:true});
    const presetState=async(label,pressed)=>p.waitForFunction(({label,pressed})=>[...document.querySelectorAll('button')].some(b=>b.textContent===label && b.getAttribute('aria-pressed')===pressed),{label,pressed});
    check('Identity', (await p.title()).includes('KDrive'), true);
    check('Single form', await p.locator('form').count(),1);
    check('Default seats',await form.getByLabel('Số chỗ',{exact:true}).inputValue(),'');
    check('Default budget',await form.getByLabel('Ngân sách cả chuyến (VND)').inputValue(),'');
    check('No status input',await p.getByLabel('Trạng thái xe',{exact:true}).count(),0);
    check('Sort outside form',await form.getByLabel('Sắp xếp',{exact:true}).count(),0);
    await form.getByLabel('Tìm xe',{exact:true}).fill('nonexistent');await p.getByText('Không tìm thấy xe',{exact:true}).waitFor();
    await form.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();await p.locator('.vehicle-card').waitFor();
    check('Reset keeps brand only',new URL(p.url()).search,'?brand=toyota');
    const family=form.getByRole('button',{name:'Gia đình · từ 5 chỗ',exact:true});await family.click();await presetState('Gia đình · từ 5 chỗ','true');check('Family selected',await family.getAttribute('aria-pressed'),'true');await family.click();await presetState('Gia đình · từ 5 chỗ','false');check('Family toggled off',await form.getByLabel('Số chỗ',{exact:true}).inputValue(),'');
    await form.getByRole('button',{name:'Đi nhóm · từ 7 chỗ',exact:true}).click();await presetState('Đi nhóm · từ 7 chỗ','true');check('Group seats',await form.getByLabel('Số chỗ',{exact:true}).inputValue(),'7');
    await form.getByLabel('Số chỗ',{exact:true}).selectOption('5');await presetState('Đi nhóm · từ 7 chỗ','false');check('Manual clears preset',await form.locator('[aria-pressed="true"]').count(),0);
    await form.getByRole('button',{name:'Đi phố · xe gọn',exact:true}).click();await presetState('Đi phố · xe gọn','true');check('Compact actual category',await form.getByLabel('Loại xe',{exact:true}).inputValue(),compact.id);
    await form.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();
    const date=new Date(Date.now()+5*86400000),start=date.toISOString().slice(0,10)+'T10:00',end=new Date(date.getTime()+86400000).toISOString().slice(0,10)+'T10:00';
    let searches=0;p.on('request',r=>{if(r.url().includes('/api/v1/vehicles/search?'))searches++;});
    await form.getByLabel('Điểm nhận',{exact:true}).selectOption('dn');await form.getByLabel('Thời gian nhận',{exact:true}).fill(start);await form.getByLabel('Thời gian trả',{exact:true}).fill(end);
    check('No availability request before submit',searches,0);
    await search.click();await p.getByText('Tổng chuyến:',{exact:false}).waitFor();
    check('Same return default',new URL(p.url()).searchParams.get('returnBranchId'),'dn');
    await form.getByLabel('Trả xe ở điểm khác',{exact:true}).check();await form.getByLabel('Điểm trả',{exact:true}).selectOption('hn');
    await form.getByRole('button',{name:/Bộ lọc nâng cao/}).click();await form.getByLabel('Ngân sách cả chuyến (VND)').fill('3000000');check('Budget grouping',await form.getByLabel('Ngân sách cả chuyến (VND)').inputValue(),'3.000.000');
    await search.click();await p.waitForURL(url=>url.searchParams.get('budget')==='3000000');await p.getByText('Tổng chuyến:',{exact:false}).waitFor();
    const applied=p.url();check('Different return applied',new URL(applied).searchParams.get('returnBranchId'),'hn');
    for(const width of [1440,1280,768,390]){
      await p.setViewportSize({width,height:1000});check('No overflow '+width,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      check('Controls stay within form '+width,await form.evaluate(f=>[...f.querySelectorAll('input:not([type="checkbox"]),select,button.btn')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect(),b=f.getBoundingClientRect();return r.left>=b.left && r.right<=b.right+1;})),true);
      check('Return toggle below pickup '+width,await form.evaluate(f=>{const pickup=f.querySelector('.search-pickup select').getBoundingClientRect(),toggle=f.querySelector('.search-return-toggle').getBoundingClientRect();return toggle.top>=pickup.bottom && Math.abs(toggle.left-pickup.left)<2;}),true);
      if(width===390) check('Mobile presets scroll horizontally',await form.getByRole('group',{name:'Chọn nhanh'}).evaluate(group=>{group.scrollLeft=50;return group.scrollWidth>group.clientWidth && group.scrollLeft>0;}),true);
      await p.screenshot({path:path.join(out,'search-'+width+'.png'),fullPage:true});
    }
    await p.reload();await p.getByText('Tổng chuyến:',{exact:false}).waitFor();check('Reload budget expanded',await form.getByRole('button',{name:/Bộ lọc nâng cao/}).getAttribute('aria-expanded'),'true');check('Reload values',await form.getByLabel('Thời gian nhận',{exact:true}).inputValue(),start);
    await form.getByLabel('Thời gian trả',{exact:true}).fill(start);check('Invalid interval disables search',await search.isDisabled(),true);check('Inline error linked',Boolean(await form.getByLabel('Thời gian trả',{exact:true}).getAttribute('aria-describedby')),true);
    await form.getByLabel('Thời gian nhận',{exact:true}).fill('2020-01-01T10:00');await p.getByText('Thời gian nhận phải ở tương lai.',{exact:true}).waitFor();
    await form.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();await p.locator('.vehicle-card').waitFor();check('Reset URL final',new URL(p.url()).search,'?brand=toyota');check('Reset draft',await form.getByLabel('Thời gian nhận',{exact:true}).inputValue(),'');check('Reset advanced closed',await form.getByRole('button',{name:/Bộ lọc nâng cao/}).getAttribute('aria-expanded'),'false');
    check('No overlay',await p.locator('vite-error-overlay').count(),0);check('Runtime console errors',errors,[]);
  } finally {await browser.close();fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors,mocks:false},null,2));}
  console.log('PASS unified search '+checks.length+' assertions');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
