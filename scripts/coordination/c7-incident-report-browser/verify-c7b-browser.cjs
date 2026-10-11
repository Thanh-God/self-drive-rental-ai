const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.C7B_PLAYWRIGHT_MODULE);

const evidence = process.env.C7B_EVIDENCE_DIR;
const api = process.env.C7B_API_BASE_URL;
const base = process.env.C7B_BASE_URL;
const browserApi = `${base}/api/v1`;
const container = process.env.C7B_CONTAINER;
const schema = process.env.C7B_SCHEMA;
const markerSchema = process.env.C7B_MARKER_SCHEMA;
const markerToken = process.env.C7B_MARKER_TOKEN;
const dbPassword = process.env.C7B_DB_PASSWORD;
const seedPassword = process.env.C7B_SEED_PASSWORD;
const checks = [];
const consoleIssues = [];
const httpIssues = [];
let browser;

function sql(query) {
  const result = spawnSync('docker', ['exec', '-e', `MYSQL_PWD=${dbPassword}`, container,
    'mysql', '-uroot', '--batch', '--raw', '--skip-column-names', schema, '-e', query], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`SQL command failed (${result.status}): ${result.stderr}`);
  return result.stdout.trim();
}
function record(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks.push({ name, actual, expected, passed: true });
}
function safeWrite(name, value) {
  fs.writeFileSync(path.join(evidence, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function login(email, password) {
  const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, `login ${email}`);
  return response.json();
}
async function insertBooking(status, tag) {
  const booking = `c7b-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const vehicle = `c7bv-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date();
  const handover = new Date(now.getTime() - 3 * 3600000);
  const returned = new Date(now.getTime() - 2 * 3600000);
  const start = new Date(now.getTime() - 5 * 3600000);
  const end = new Date(now.getTime() - 3600000);
  const iso = (d) => d.toISOString().replace('T', ' ').replace('Z', '');
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const sqlDate = (d) => q(iso(d));
  const dropReturn = status === 'IN_PROGRESS' ? '' : `INSERT INTO vehicle_handover_records(id,booking_id,kind,actor_id,branch_id,occurred_at,condition_note,maintenance) VALUES(${q(`${booking}-ret`)},${q(booking)},'RETURN','demo-staff-dn','dn',${sqlDate(returned)},'Fixture return',0);`;
  const sqlText = `INSERT INTO vehicles(id,name,plate,brand_id,category_id,home_branch_id,current_branch_id,seats,transmission,daily_price,status,description,version) VALUES(${q(vehicle)},${q(`C7B ${tag}`)},${q(`C7${tag}${Date.now().toString().slice(-5)}`)},'toyota','sedan','hn','hn',5,'AUTO',1000000,'ACTIVE','Isolated browser fixture',0);` +
    `INSERT INTO bookings(id,user_id,vehicle_id,customer_name,vehicle_name,pickup_branch_id,return_branch_id,pickup_name,return_name,actual_return_branch_id,start_at,end_at,expires_at,status,daily_price,rental_days,rental_total,one_way_fee,total,policy_version,version,created_at) VALUES(${q(booking)},'demo-user',${q(vehicle)},'Khách mẫu',${q(`C7B ${tag}`)},'hn','dn','Hà Nội','Đà Nẵng',${status === 'COMPLETED' ? "'dn'" : 'NULL'},${sqlDate(start)},${sqlDate(end)},${sqlDate(start)},${q(status)},1000000,1,1000000,0,1000000,'c7b-fixture',0,${sqlDate(start)});` +
    `INSERT INTO vehicle_handover_records(id,booking_id,kind,actor_id,branch_id,occurred_at,condition_note,maintenance) VALUES(${q(`${booking}-hand`)},${q(booking)},'HANDOVER','demo-staff-hn','hn',${sqlDate(handover)},'Fixture handover',0);${dropReturn}`;
  sql(sqlText);
  return { booking, vehicle, handover: handover.toISOString(), returned: status === 'COMPLETED' ? returned.toISOString() : null, before: sql(`SELECT b.status,b.total,b.version,v.status,v.current_branch_id,(SELECT COUNT(*) FROM vehicle_handover_records h WHERE h.booking_id=b.id) FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id WHERE b.id=${q(booking)};`) };
}

async function main() {
  assert.ok(evidence && api && base && container && schema && markerSchema && markerToken && dbPassword && seedPassword, 'runner environment is incomplete');
  const marker = spawnSync('docker', ['exec', '-e', `MYSQL_PWD=${dbPassword}`, container, 'mysql', '-uroot', '--batch', '--skip-column-names', '-e', `SELECT marker_token FROM ${markerSchema}.__kdrive_test_fixture_marker WHERE id=1 AND target_schema='${schema}'`], { encoding: 'utf8' });
  assert.equal(marker.status, 0, 'fixture marker query');
  record('fixture marker identity', marker.stdout.trim(), markerToken);

  const first = await insertBooking('IN_PROGRESS', 'live');
  const second = await insertBooking('COMPLETED', 'late');
  const beforeFinancial = sql(`SELECT CONCAT_WS('|',id,status,total,version) FROM bookings WHERE id IN ('${first.booking}','${second.booking}') ORDER BY id;`);
  const beforeVehicle = sql(`SELECT CONCAT_WS('|',id,status,current_branch_id,version) FROM vehicles WHERE id IN ('${first.vehicle}','${second.vehicle}') ORDER BY id;`);
  const user = await login('user@example.test', seedPassword);
  const foreign = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `c7b-foreign-${Date.now()}@example.test`, fullName: 'Foreign C7B', password: `Foreign-${Date.now()}Aa9!` }) });
  assert.equal(foreign.status, 200, 'register isolated foreign USER');
  const foreignSession = await foreign.json();
  const denied = await fetch(`${api}/bookings/${first.booking}`, { headers: { authorization: `Bearer ${foreignSession.token}` } });
  record('foreign USER direct booking access', denied.status, 404);
  const deniedReport = await fetch(`${api}/incidents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${foreignSession.token}` }, body: JSON.stringify({ bookingId: first.booking, kind: 'DAMAGE', occurredAt: first.handover, description: 'forbidden foreign report', blockVehicle: false }) });
  record('foreign USER report denied', deniedReport.status, 404);
  record('foreign denial caused no case/event write', sql(`SELECT CONCAT((SELECT COUNT(*) FROM incident_cases WHERE booking_id='${first.booking}'),':',(SELECT COUNT(*) FROM incident_events e JOIN incident_cases c ON c.id=e.case_id WHERE c.booking_id='${first.booking}'));`), '0:0');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ token, actor }) => { localStorage.setItem('kdrive.jwt', token); localStorage.setItem('kdrive.user', JSON.stringify(actor)); }, { token: user.token, actor: user.user });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') consoleIssues.push({ type: 'console', text: message.text() }); });
  page.on('pageerror', (error) => consoleIssues.push({ type: 'pageerror', text: error.message }));
  page.on('response', (response) => { if (response.status() >= 400) httpIssues.push({ method: response.request().method(), url: response.url(), status: response.status() }); });
  page.on('requestfailed', (request) => httpIssues.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText }));
  const reportAndHold = async (fixture, description, hold) => {
    const listResponse = page.waitForResponse((r) => r.url() === `${browserApi}/incidents?bookingId=${fixture.booking}` && r.status() === 200);
    await page.goto(`${base}/user/bookings/${fixture.booking}`);
    await page.getByRole('heading', { name: 'Hồ sơ sự cố' }).waitFor();
    await listResponse;
    const form = page.locator('form').filter({ has: page.locator('[name="occurredAt"]') });
    await form.locator('[name="kind"]').selectOption('DAMAGE');
    await form.locator('[name="occurredAt"]').fill(new Date(Date.parse(fixture.handover) + 7 * 3600000).toISOString().slice(0, 16));
    await form.locator('[name="description"]').fill(description);
    const postUrl = `${browserApi}/incidents`;
    let release;
    let reached;
    const reachedPromise = new Promise((resolve) => { reached = resolve; });
    const releasePromise = new Promise((resolve) => { release = resolve; });
    let postCount = 0;
    const handler = async (route) => {
      postCount += 1;
      const response = await route.fetch();
      reached();
      if (hold) await releasePromise;
      await route.fulfill({ response });
    };
    await page.route(postUrl, handler);
    await form.getByRole('button', { name: 'Lập hồ sơ sự cố' }).click();
    if (hold) {
      await reachedPromise;
      const button = form.getByRole('button', { name: 'Lập hồ sơ sự cố' });
      record('submit disabled while actual POST response held', await button.isDisabled(), true);
      await form.evaluate((el) => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await page.waitForTimeout(300);
      record('exactly one browser POST while pending', postCount, 1);
      release();
    }
    await page.unroute(postUrl, handler);
    await page.getByText('Đã lập hồ sơ sự cố.', { exact: false }).waitFor();
    record('exactly one POST for the report', postCount, 1);
    const persisted = sql(`SELECT CONCAT(kind,'|',status,'|',description,'|',UNIX_TIMESTAMP(occurred_at)*1000000,'|',UNIX_TIMESTAMP(reported_at)*1000000) FROM incident_cases WHERE booking_id='${fixture.booking}';`);
    record(`${description}: one OPEN case and event`, sql(`SELECT CONCAT((SELECT COUNT(*) FROM incident_cases WHERE booking_id='${fixture.booking}' AND status='OPEN'),':',(SELECT COUNT(*) FROM incident_events e JOIN incident_cases c ON c.id=e.case_id WHERE c.booking_id='${fixture.booking}' AND e.action='OPEN'));`), '1:1');
    const parts = persisted.split('|');
    record(`${description}: persisted kind/status`, parts.slice(0, 2), ['DAMAGE', 'OPEN']);
    const body = await page.locator('body').innerText();
    record(`${description}: browser displays no claim/assessment`, /Chưa có kết luận trách nhiệm hoặc khấu trừ/.test(body), true);
    record(`${description}: browser shows time distinction`, /Xảy ra[\s\S]*Báo cáo/.test(body), true);
    await page.screenshot({ path: path.join(evidence, `${description}-report.png`), fullPage: true });
    await page.reload();
    await page.getByText(description, { exact: true }).waitFor();
    record(`${description}: reload persistence`, await page.getByText('DAMAGE · OPEN').count(), 1);
    return { id: sql(`SELECT id FROM incident_cases WHERE booking_id='${fixture.booking}';`), persisted, parts };
  };

  const activeCase = await reportAndHold(first, 'C7B active custody incident', true);
  const completedCase = await reportAndHold(second, 'C7B late completed incident', false);
  const foreignContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await foreignContext.addInitScript(({ token, actor }) => { localStorage.setItem('kdrive.jwt', token); localStorage.setItem('kdrive.user', JSON.stringify(actor)); }, { token: foreignSession.token, actor: foreignSession.user });
  const foreignPage = await foreignContext.newPage();
  await foreignPage.goto(`${base}/user/bookings/${first.booking}`);
  await foreignPage.getByText(/404|không tìm thấy|not found/i).first().waitFor();
  record('foreign USER direct browser URL denied', await foreignPage.getByText(/404|không tìm thấy|not found/i).count() > 0, true);
  await foreignContext.close();
  const afterFinancial = sql(`SELECT CONCAT_WS('|',id,status,total,version) FROM bookings WHERE id IN ('${first.booking}','${second.booking}') ORDER BY id;`);
  const afterVehicle = sql(`SELECT CONCAT_WS('|',id,status,current_branch_id,version) FROM vehicles WHERE id IN ('${first.vehicle}','${second.vehicle}') ORDER BY id;`);
  record('booking status/financial snapshots unchanged', afterFinancial, beforeFinancial);
  record('vehicle status/current branch unchanged', afterVehicle, beforeVehicle);
  record('late report occurredAt precedes reportedAt', Number(completedCase.parts[3]) < Number(completedCase.parts[4]), true);
  record('active report occurredAt precedes reportedAt', Number(activeCase.parts[3]) < Number(activeCase.parts[4]), true);
  record('USER report payload omitted vehicle blocking control', await page.locator('[name="blockVehicle"]').count(), 0);

  // A failed list request is recovered by the UI retry button; the retry is an actual API GET.
  await page.route(`${browserApi}/incidents?bookingId=${first.booking}`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"synthetic list transport failure"}' }), { times: 1 });
  await page.reload();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Tải lại' }).click();
  await page.getByText('C7B active custody incident', { exact: true }).waitFor();
  record('incident list failed GET then actual retry succeeds', await page.getByText('C7B active custody incident', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Lịch sử' }).first().click();
  await page.getByText('OPEN ·', { exact: false }).first().waitFor();
  await page.route(`${browserApi}/incidents/${activeCase.id}/events`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"synthetic history transport failure"}' }), { times: 1 });
  await page.getByRole('button', { name: 'Lịch sử' }).first().click();
  await page.getByRole('alert').getByText('Thử tải lại lịch sử').waitFor();
  await page.getByRole('button', { name: 'Thử tải lại lịch sử' }).click();
  await page.getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.').waitFor();
  record('history GET failure then actual retry succeeds', await page.getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.').count(), 1);
  await page.screenshot({ path: path.join(evidence, 'history-retried.png'), fullPage: true });

  // A real slow event read is superseded by another incident selection; stale events must stay hidden.
  let finishSlow;
  const slowDone = new Promise((resolve) => { finishSlow = resolve; });
  let slowStarted;
  const slowSeen = new Promise((resolve) => { slowStarted = resolve; });
  await page.route(`${browserApi}/incidents/${activeCase.id}/events`, async (route) => { const response = await route.fetch(); slowStarted(); await slowDone; await route.fulfill({ response }); }, { times: 1 });
  const historyButtons = page.getByRole('button', { name: 'Lịch sử' });
  await historyButtons.first().click();
  await slowSeen;
  let finishCurrent;
  const currentDone = new Promise((resolve) => { finishCurrent = resolve; });
  let currentStarted;
  const currentSeen = new Promise((resolve) => { currentStarted = resolve; });
  await page.route(`${browserApi}/incidents/${completedCase.id}/events`, async (route) => { const response = await route.fetch(); currentStarted(); await currentDone; await route.fulfill({ response }); }, { times: 1 });
  await historyButtons.nth(1).click();
  await currentSeen;
  record('stale event list hidden while new incident history is pending', await page.getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.').count(), 0);
  finishCurrent();
  await page.getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.').waitFor();
  record('stale history for prior incident hidden after selecting second', await page.getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.').count(), 1);
  finishSlow();
  await page.waitForTimeout(300);
  record('no duplicate/stale event content after held history resolves', await page.getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.').count(), 1);

  record('no browser console/page errors', consoleIssues, []);
  const unexpectedHttp = httpIssues.filter((issue) => !(issue.method === 'GET' && issue.status === 500 && (issue.url.includes(`/incidents?bookingId=${first.booking}`) || issue.url.includes(`/incidents/${activeCase.id}/events`))));
  record('endpoint-specific HTTP error classification', unexpectedHttp, []);
  safeWrite('assertions.json', { checks, consoleIssues, httpIssues, fixtures: [first, second].map(({ booking, vehicle, handover, returned }) => ({ booking, vehicle, handover, returned })), incidents: [activeCase.id, completedCase.id] });
  await page.context().close();
}

main().catch((error) => {
  safeWrite('browser-failure.json', { message: error.message, stack: error.stack, checks, consoleIssues });
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
