// Desktop real-browser proof; synthetic data only in the guarded C14 browser schema.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require(process.env.C11_PLAYWRIGHT);
const out = process.env.C11_EVIDENCE, base = 'http://127.0.0.1:5300';
const fixture = JSON.parse(fs.readFileSync(path.join(process.env.C11_BACKEND_EVIDENCE, 'fixture.json')));
const config = fs.readFileSync(path.join(out, 'application.private.properties'), 'utf8');
const password = config.match(/^spring.datasource.password=(.*)$/m)[1];
const accountPassword = config.match(/^app.seed-password=(.*)$/m)[1];
const schema = config.match(/jdbc:mysql:\/\/127.0.0.1:33676\/([^?]+)/)[1];
assert.match(schema, /^kdrive_c14_browser_[a-f0-9]+$/); assert.equal(fixture.port, 33676);
const checks = [], errors = [], consoleErrors = [];
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); checks.push({name,actual,expected}); fs.writeFileSync(path.join(out,'browser-assertions.json'),JSON.stringify(checks,null,2)); }
function sql(q) { try { return cp.execFileSync('docker',['exec','-e','MYSQL_PWD='+password,fixture.name,'mysql','--default-character-set=utf8mb4','-uroot','-N','--raw',schema,'-e',q],{encoding:'utf8',windowsHide:true,timeout:15000}).trim(); } catch { throw Error('Isolated SQL failed; private details withheld'); } }
const lit = x => x === null ? 'NULL' : typeof x === 'number' ? String(x) : `CONVERT(0x${Buffer.from(String(x)).toString('hex')} USING utf8mb4)`;
function insert(table, values) { sql(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.values(values).map(lit).join(',')})`); }
const today = new Date(Date.now()+7*3600000).toISOString().slice(0,10);
function day(offset) { return new Date(Date.parse(today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10); }
function stamp(offset, end=false) { return new Date(Date.parse(day(offset)+'T00:00:00+07:00')+(end?86400000-1:0)).toISOString().replace('T',' ').replace('Z',''); }
function seed(id, vehicle, start, end, status, name) {
  insert('bookings',{id,user_id:'demo-user',vehicle_id:vehicle,pickup_branch_id:'dn',return_branch_id:'dn',start_at:stamp(start),end_at:stamp(end,true),created_at:stamp(-6),expires_at:stamp(start),status,daily_price:650000,rental_days:end-start,rental_total:650000*(end-start),one_way_fee:0,total:650000*(end-start),customer_name:'SYNTHETIC G4',vehicle_name:name,pickup_name:'Đà Nẵng',return_name:'Đà Nẵng',policy_version:'calendar-2026-10-17',version:2});
  if(status==='IN_PROGRESS') insert('vehicle_handover_records',{id:randomUUID(),booking_id:id,kind:'HANDOVER',actor_id:'demo-staff-dn',branch_id:'dn',occurred_at:stamp(start),condition_note:'SYNTHETIC fixture, not real rental',maintenance:0});
}
async function main() {
  check('database date equals fixture date',sql('SELECT DATE(UTC_TIMESTAMP()+INTERVAL 7 HOUR)'),today);
  check('fresh fixture has no bookings',sql('SELECT COUNT(*) FROM bookings'),'0');
  sql("UPDATE vehicles SET current_branch_id='dn',status='ACTIVE' WHERE id IN ('v1','v3')");
  const a=randomUUID(),b=randomUUID(),c=randomUUID(),d=randomUUID();
  seed(a,'v1',-4,-1,'IN_PROGRESS','G4 xe quá hạn'); seed(b,'v1',0,2,'CONFIRMED','G4 đơn kế tiếp');
  seed(c,'v3',-2,0,'IN_PROGRESS','G4 xe đến ngày trả'); seed(d,'v3',1,3,'CONFIRMED','G4 đơn ngày mai');
  const original=sql('SELECT id,total,start_at,end_at FROM bookings ORDER BY id');
  fs.writeFileSync(path.join(out,'synthetic-fixtures.json'),JSON.stringify({today,a,b,c,d},null,2));
  const browser=await chromium.launch({headless:true});
  async function login(email) {
    const context=await browser.newContext({viewport:{width:1440,height:900}}), p=await context.newPage(); p.setDefaultTimeout(15000);
    p.on('pageerror',e=>errors.push(e.message)); p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    await p.goto(base+'/login'); await p.getByLabel('Email',{exact:true}).fill(email); await p.getByLabel('Mật khẩu',{exact:true}).fill(accountPassword);
    const response=p.waitForResponse(r=>r.url().endsWith('/auth/login')); await p.getByRole('button',{name:'Đăng nhập',exact:true}).click(); check('UI login '+email,(await response).status(),200); await p.waitForURL(u=>!u.pathname.endsWith('/login')); return p;
  }
  async function shot(p,name) { await p.screenshot({path:path.join(out,name+'.png'),fullPage:false}); check(name+' no page overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); check(name+' no Vite overlay',await p.locator('vite-error-overlay').count(),0); }
  async function list(p,role) { await p.goto(base+`/${role}/bookings`); await p.getByRole('combobox',{name:'Cảnh báo lịch xe',exact:true}).waitFor(); await p.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).first().waitFor(); }
  try {
    const staff=await login('staff.dn@example.test'); await list(staff,'staff');
    check('staff title meaningful',(await staff.title()).length>0,true);
    await staff.getByRole('combobox',{name:'Cảnh báo lịch xe',exact:true}).selectOption('early'); await staff.getByText('G4 xe đến ngày trả',{exact:true}).waitFor(); check('early list one card',await staff.locator('article').count(),1); await shot(staff,'staff-early');
    await staff.getByRole('combobox',{name:'Cảnh báo lịch xe',exact:true}).selectOption('overdue'); check('overdue A and B',await staff.locator('article').count(),2);
    await staff.getByLabel('Trạng thái',{exact:true}).selectOption('CONFIRMED'); await staff.getByLabel('Hàng đợi',{exact:true}).selectOption('date'); await staff.getByLabel('Ngày trong hàng đợi',{exact:true}).fill(day(-6));
    await staff.getByLabel('Tìm mã đơn, xe hoặc khách hàng',{exact:true}).fill('G4 đơn kế tiếp'); check('combined filters one card',await staff.locator('article').count(),1); await shot(staff,'staff-filtered');
    await staff.getByRole('link',{name:'Xem đơn chưa trả xe',exact:true}).click(); await staff.waitForURL('**/staff/bookings/'+a); await staff.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).waitFor(); check('related link opens A',new URL(staff.url()).pathname,'/staff/bookings/'+a);
    const admin=await login('admin@example.test'); await list(admin,'admin'); await admin.getByRole('combobox',{name:'Cảnh báo lịch xe',exact:true}).selectOption('overdue'); check('admin two rows',await admin.locator('tbody tr').count(),2); await shot(admin,'admin-overdue');
    await admin.getByRole('link',{name:'Xem đơn chưa trả xe',exact:true}).click(); await admin.waitForURL('**/admin/bookings/'+a); check('admin no operational form',await admin.getByLabel('Chuyển trạng thái',{exact:true}).count(),0);
    const user=await login('user@example.test'); await user.goto(base+'/user/bookings/'+b); await user.getByText('G4 đơn kế tiếp',{exact:true}).first().waitFor(); check('USER no warning',await user.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).count(),0); await shot(user,'user-detail');
    const wrong=await login('staff.hn@example.test'); const denied=wrong.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/bookings/'+a); await wrong.goto(base+'/staff/bookings/'+a); check('wrong branch denied',(await denied).status(),404); check('wrong branch no warning',await wrong.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).count(),0);
    await staff.getByLabel('Chuyển trạng thái',{exact:true}).selectOption('RETURNED'); await staff.getByLabel('Tình trạng xe / ghi chú',{exact:true}).fill('SYNTHETIC actual return for G4 browser proof');
    const saved=staff.waitForResponse(r=>r.url().endsWith('/bookings/'+a+'/actions')&&r.request().method()==='POST'); await staff.locator('form').filter({has:staff.getByLabel('Chuyển trạng thái',{exact:true})}).getByRole('button').click(); check('return through UI',(await saved).status(),200);
    await staff.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).waitFor({state:'detached'}); await staff.goto(base+'/staff/bookings/'+b); await staff.getByText('G4 đơn kế tiếp',{exact:true}).first().waitFor(); check('B warning cleared after return',await staff.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).count(),0); await shot(staff,'staff-after-return');
    await admin.getByRole('button',{name:'Tải lại đơn',exact:true}).click(); await admin.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).waitFor({state:'detached'}); check('Admin reload clears warning',await admin.getByRole('region',{name:'Cảnh báo lịch xe',exact:true}).count(),0);
    check('A returned SQL',sql(`SELECT status FROM bookings WHERE id='${a}'`),'RETURNED'); check('one RETURN record',sql(`SELECT COUNT(*) FROM vehicle_handover_records WHERE booking_id='${a}' AND kind='RETURN'`),'1'); check('B unchanged',sql(`SELECT status FROM bookings WHERE id='${b}'`),'CONFIRMED'); check('prices/dates unchanged',sql('SELECT id,total,start_at,end_at FROM bookings ORDER BY id'),original);
    check('no runtime JS errors',errors,[]);
    // Transport failure is deliberately injected; never substitute demo data.
    await staff.route('**/api/v1/bookings',route=>route.abort('failed')); await staff.goto(base+'/staff/bookings'); await staff.getByRole('button',{name:'Thử tải lại',exact:true}).waitFor(); check('failed API has no cards',await staff.locator('article').count(),0); await shot(staff,'staff-api-error');
    fs.writeFileSync(path.join(out,'console-health.json'),JSON.stringify({errors,consoleErrors,expected:'404 wrong-branch and deliberate network failure only'},null,2));
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
