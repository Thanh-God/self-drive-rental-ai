const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { deferred, dispatcher, bounded, assertNoUnexpected, mysqlTimestamp } = require('./browser-controls.cjs');
const { chromium } = require(process.env.C7B_PLAYWRIGHT_MODULE);
const evidence = process.env.C7B_EVIDENCE_DIR;
const api = process.env.C7B_API_BASE_URL;
const base = process.env.C7B_BASE_URL;
const browserApi = `${base}/api/v1`;
const container = process.env.C7B_CONTAINER;
const schema = process.env.C7B_SCHEMA;
const dbPassword = process.env.C7B_DB_PASSWORD;
const seedPassword = process.env.C7B_SEED_PASSWORD;
const checks = [], http = [], consoleIssues = [], expected = [];
let browser, page;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
function sql(query) {
  const result = spawnSync('docker', ['exec', '-e', `MYSQL_PWD=${dbPassword}`, container,
    'mysql', '-uroot', '--batch', '--raw', '--skip-column-names', '-e', `USE ${schema}; ${query}`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`SQL failed (${result.status}): ${result.stderr.replaceAll(dbPassword, '[REDACTED]')}`);
  return result.stdout.trim();
}
function record(name, actual, wanted) {
  assert.deepEqual(actual, wanted, name);
  checks.push({ name, actual, expected: wanted, passed: true });
  console.log(`PASS ${name}`);
}
function write(name, value) { fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2)); }
async function login(email) {
  const response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: seedPassword }) });
  assert.equal(response.status, 200);
  return response.json();
}
function booking(status, tag) {
  const id = `c7b-${tag}-${Date.now()}`;
  const vehicle = `c7bv-${tag}-${Date.now()}`;
  const minute = Math.floor(Date.now() / 60000) * 60000;
  const start = new Date(minute - 5 * 3600000), handover = new Date(minute - 3 * 3600000);
  const returned = new Date(minute - 2 * 3600000), end = new Date(minute - 3600000);
  const date = (d) => q(d.toISOString().replace('T', ' ').replace('Z', ''));
  sql(`INSERT INTO vehicles(id,name,plate,brand_id,category_id,home_branch_id,current_branch_id,seats,transmission,daily_price,status,description,version) VALUES(${q(vehicle)},${q(tag)},${q(`C7${tag}${Date.now().toString().slice(-5)}`)},'toyota','sedan','hn','hn',5,'AUTO',1000000,'ACTIVE','Isolated fixture',0);
  INSERT INTO bookings(id,user_id,vehicle_id,customer_name,vehicle_name,pickup_branch_id,return_branch_id,pickup_name,return_name,actual_return_branch_id,start_at,end_at,expires_at,status,daily_price,rental_days,rental_total,one_way_fee,total,policy_version,version,created_at) VALUES(${q(id)},'demo-user',${q(vehicle)},'Fixture',${q(tag)},'hn','dn','HN','DN',${status === 'COMPLETED' ? "'dn'" : 'NULL'},${date(start)},${date(end)},${date(start)},${q(status)},1000000,1,1000000,0,1000000,'fixture',0,${date(start)});
  INSERT INTO vehicle_handover_records(id,booking_id,kind,actor_id,branch_id,occurred_at,condition_note,maintenance) VALUES(${q(`${id}-h`)},${q(id)},'HANDOVER','demo-staff-hn','hn',${date(handover)},'Fixture',0);
  INSERT INTO contracts(id,booking_id,issued_at,snapshot,terms_version) VALUES(${q(`${id}-c`)},${q(id)},${date(start)},'{"retained":"contract"}','fixture');`);
  if (status === 'COMPLETED') sql(`INSERT INTO vehicle_handover_records(id,booking_id,kind,actor_id,branch_id,occurred_at,condition_note,maintenance) VALUES(${q(`${id}-r`)},${q(id)},'RETURN','demo-staff-dn','dn',${date(returned)},'Fixture',0);
  INSERT INTO invoices(id,booking_id,issued_at,total,snapshot) VALUES(${q(`${id}-i`)},${q(id)},${date(returned)},1000000,'{"retained":"invoice"}');
  INSERT INTO invoice_items(id,invoice_id,name,quantity,unit_price,amount) VALUES(${q(`${id}-ii`)},${q(`${id}-i`)},'Rent',1,1000000,1000000);
  INSERT INTO reviews(id,booking_id,rating,content,hidden,created_at,version) VALUES(${q(`${id}-rv`)},${q(id)},5,'Retained review',0,${date(returned)},0);`);
  return { id, vehicle, handover: handover.toISOString(), occurred: new Date(handover.getTime() + 1800000).toISOString(), returned: returned.toISOString() };
}
function snapshot(fixtures) {
  const ids = fixtures.map((f) => q(f.id)).join(','), vehicles = fixtures.map((f) => q(f.vehicle)).join(',');
  const predicates = { bookings: `id IN (${ids})`, vehicles: `id IN (${vehicles})`, vehicle_handover_records: `booking_id IN (${ids})`, booking_status_history: `booking_id IN (${ids})`, contracts: `booking_id IN (${ids})`, invoices: `booking_id IN (${ids})`, invoice_items: `invoice_id IN (SELECT id FROM invoices WHERE booking_id IN (${ids}))`, reviews: `booking_id IN (${ids})` };
  return Object.fromEntries(Object.entries(predicates).map(([table, where]) => [table, sql(`SELECT * FROM ${table} WHERE ${where} ORDER BY id;`)]));
}
function incidentSnapshot(id) { return sql(`SELECT * FROM incident_cases WHERE booking_id=${q(id)} ORDER BY id; SELECT e.* FROM incident_events e JOIN incident_cases c ON c.id=e.case_id WHERE c.booking_id=${q(id)} ORDER BY e.id;`); }
function monitor(target) {
  target.on('response', (r) => { if (r.status() >= 400) http.push({ method: r.request().method(), url: r.url(), status: r.status() }); });
  target.on('requestfailed', (r) => http.push({ method: r.method(), url: r.url(), failure: r.failure()?.errorText }));
  target.on('console', (m) => { if (m.type() === 'error') consoleIssues.push({ type: 'console', text: m.text(), url: m.location().url }); });
  target.on('pageerror', (e) => consoleIssues.push({ type: 'pageerror', text: e.message }));
}
async function main() {
  assert.ok(evidence && api && base && dbPassword && seedPassword);
  record('isolated fixture marker verified', sql(`SELECT COUNT(*) FROM ${process.env.C7B_MARKER_SCHEMA}.__kdrive_test_fixture_marker WHERE id=1 AND target_schema=${q(schema)} AND marker_token=${q(process.env.C7B_MARKER_TOKEN)};`), '1');
  const first = booking('IN_PROGRESS', 'live'), second = booking('COMPLETED', 'late');
  const fixtures = [first, second], before = snapshot(fixtures);
  record('representative contract/invoice/item/review rows exist', Object.values(before).filter((s) => s.length > 0).length >= 7, true);
  const session = await login('user@example.test');
  const foreignResponse = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `foreign-${Date.now()}@example.test`, fullName: 'Foreign fixture', password: `Foreign${Date.now()}Aa9!` }) });
  record('foreign registration contract', foreignResponse.status, 201);
  const foreign = await foreignResponse.json();
  for (const [method, url, body] of [['GET', `/bookings/${first.id}`], ['GET', `/bookings/${first.id}/review`], ['GET', `/incidents?bookingId=${first.id}`], ['POST', '/incidents', { bookingId: first.id, kind: 'DAMAGE', occurredAt: first.occurred, description: 'Denied', blockVehicle: false }]]) {
    const response = await fetch(`${api}${url}`, { method, headers: { authorization: `Bearer ${foreign.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    record(`foreign ${method} ${url} denied`, response.status, 404);
  }
  record('foreign denial no case/event', incidentSnapshot(first.id), '');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ token }) => localStorage.setItem('kdrive.jwt', token), { token: session.token });
  const scenarios = new Map();
  await context.route('**/api/v1/**', dispatcher(scenarios));
  page = await context.newPage(); monitor(page);
  page.setDefaultTimeout(15000);
  const section = () => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Hồ sơ sự cố', exact: true }) });
  const form = () => section().locator('form').filter({ has: page.locator('[name="occurredAt"]') });
  const local = (iso) => new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 16);
  async function navigate(fixture) {
    await page.goto(`${base}/user/bookings/${fixture.id}`);
    await section().getByRole('heading', { name: 'Hồ sơ sự cố', exact: true }).waitFor();
    await form().waitFor();
    await page.waitForFunction(() => !document.querySelector('section.panel.space-y-4 .animate-pulse'));
  }
  async function report(fixture, kind, description, hold) {
    await navigate(fixture);
    await form().locator('[name="kind"]').selectOption(kind);
    await form().locator('[name="occurredAt"]').fill(local(fixture.occurred));
    await form().locator('[name="description"]').fill(description);
    record(`${description}: USER no block control`, await form().locator('[name="blockVehicle"]').count(), 0);
    const state = { reached: deferred(), release: deferred(), finished: deferred() };
    const key = `POST ${browserApi}/incidents`;
    scenarios.set(key, state);
    await form().getByRole('button', { name: 'Lập hồ sơ sự cố' }).click();
    await bounded(state.reached.promise, 'POST reached backend');
    record(`${description}: real POST status`, state.response.status(), 200);
    record(`${description}: exact UTC request`, state.payload.occurredAt, fixture.occurred);
    record(`${description}: USER block false`, state.payload.blockVehicle, false);
    const result = await state.response.json();
    const id = result.id;
    const saved = sql(`SELECT CONCAT(kind,'|',status,'|',description,'|',DATE_FORMAT(occurred_at,'%Y-%m-%dT%H:%i:%s.000Z'),'|',reported_by,'|',assessed_damage,'|',third_party_coverage,'|',requested_amount) FROM incident_cases WHERE id=${q(id)};`);
    record(`${description}: exact persisted fields`, saved, `${kind}|OPEN|${description}|${fixture.occurred}|demo-user|0|0|0`);
    record(`${description}: exactly one case/event before response release`, sql(`SELECT CONCAT((SELECT COUNT(*) FROM incident_cases WHERE booking_id=${q(fixture.id)} AND description=${q(description)}),':',(SELECT COUNT(*) FROM incident_events WHERE case_id=${q(id)} AND action='OPEN' AND next_status='OPEN' AND actor_id='demo-user'));`), '1:1');
    record(`${description}: reportedAt matches backend response at TIMESTAMP(6) precision`, sql(`SELECT DATE_FORMAT(reported_at,'%Y-%m-%dT%H:%i:%s.%f') FROM incident_cases WHERE id=${q(id)};`), mysqlTimestamp(result.reportedAt));
    if (hold) {
      record('submit disabled while real POST held', await form().getByRole('button', { name: 'Lập hồ sơ sự cố' }).isDisabled(), true);
      await form().evaluate((el) => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await page.waitForTimeout(150);
      record('exactly one POST while held', state.count, 1);
    }
    state.release.resolve(); await bounded(state.finished.promise, 'POST fulfilled'); scenarios.delete(key);
    await section().getByRole('status').filter({ hasText: 'Đã lập hồ sơ sự cố.' }).waitFor();
    await section().getByText(description, { exact: true }).waitFor();
    await page.reload();
    await section().getByText(description, { exact: true }).waitFor();
    record(`${description}: reload persistence`, await section().getByText(description, { exact: true }).count(), 1);
    const card = section().locator('article').filter({ has: page.getByText(description, { exact: true }) });
    await card.screenshot({ path: path.join(evidence, `${kind}-case.png`) });
    record(`${description}: distinct occurred/reported labels`, /Xảy ra[\s\S]*Báo cáo/.test(await card.innerText()), true);
    const vietnam = (iso) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(iso));
    record(`${description}: Vietnam display matches UTC persisted times`, (await card.innerText()).includes(vietnam(fixture.occurred)) && (await card.innerText()).includes(vietnam(result.reportedAt)), true);
    return { id, kind, description, fixture };
  }
  await navigate(first);
  record('missing description prevents form submission', await form().evaluate((el) => el.checkValidity()), false);
  const noPost = [];
  const countPost = (request) => { if (request.method() === 'POST' && request.url() === `${browserApi}/incidents`) noPost.push(request.url()); };
  page.on('request', countPost);
  await form().getByRole('button', { name: 'Lập hồ sơ sự cố' }).click();
  await page.waitForTimeout(100);
  record('missing description sends no actual POST', noPost.length, 0);
  page.off('request', countPost);
  record('missing description creates no case/event', incidentSnapshot(first.id), '');
  const a = await report(first, 'DAMAGE', 'C7B active damage', true);
  const b = await report(first, 'VIOLATION', 'C7B active violation', false);
  const c = await report(second, 'ACCIDENT', 'C7B late accident', false);
  await navigate(first);
  const beforeNegative = incidentSnapshot(first.id);
  await form().locator('[name="description"]').fill('Outside custody rejected');
  await form().locator('[name="occurredAt"]').evaluate((el, value) => { el.removeAttribute('min'); el.removeAttribute('max'); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, local(new Date(Date.parse(first.handover) - 60000).toISOString()));
  const deniedPost = page.waitForResponse((r) => r.url() === `${browserApi}/incidents` && r.request().method() === 'POST');
  expected.push({ method: 'POST', url: `${browserApi}/incidents`, status: 400 });
  await form().getByRole('button', { name: 'Lập hồ sơ sự cố' }).click();
  record('outside custody actual backend rejection', (await deniedPost).status(), 400);
  await section().getByRole('alert').filter({ hasText: 'Thời điểm sự việc' }).waitFor();
  record('outside custody no success', await section().getByRole('status').filter({ hasText: 'Đã lập hồ sơ' }).count(), 0);
  record('outside custody no DB write', incidentSnapshot(first.id), beforeNegative);
  // Keep the error active across StrictMode's duplicate effects until the UI
  // confirms it. All other requests continue to the actual backend.
  const listUrl = `${browserApi}/incidents?bookingId=${first.id}`;
  expected.push({ method: 'GET', url: listUrl, status: 500 });
  scenarios.set(`GET ${listUrl}`, { error: 500, message: 'C7B deliberate list failure' });
  await page.reload();
  await section().getByRole('alert').filter({ hasText: 'C7B deliberate list failure' }).waitFor();
  scenarios.delete(`GET ${listUrl}`);
  const heldList = { reached: deferred(), release: deferred(), finished: deferred() };
  scenarios.set(`GET ${listUrl}`, heldList);
  await section().getByRole('button', { name: 'Thử tải lại', exact: true }).click();
  await bounded(heldList.reached.promise, 'retry GET reached backend');
  record('list loading hides stale cases during real GET', await section().locator('article').count(), 0);
  heldList.release.resolve(); await bounded(heldList.finished.promise, 'list retry fulfilled'); scenarios.delete(`GET ${listUrl}`);
  await section().getByText(a.description, { exact: true }).waitFor();
  const cardA = section().locator('article').filter({ has: page.getByText(a.description, { exact: true }) });
  const cardB = section().locator('article').filter({ has: page.getByText(b.description, { exact: true }) });
  const urlA = `${browserApi}/incidents/${a.id}/events`, urlB = `${browserApi}/incidents/${b.id}/events`;
  expected.push({ method: 'GET', url: urlA, status: 500 });
  scenarios.set(`GET ${urlA}`, { error: 500, message: 'C7B deliberate history failure' });
  await cardA.getByRole('button', { name: 'Lịch sử', exact: true }).click();
  await cardA.getByRole('alert').filter({ hasText: 'C7B deliberate history failure' }).waitFor();
  scenarios.delete(`GET ${urlA}`);
  await cardA.getByRole('button', { name: 'Thử tải lại lịch sử' }).click();
  await cardA.locator('ol li').filter({ hasText: 'Tiếp nhận hồ sơ' }).waitFor();
  const slow = { reached: deferred(), release: deferred(), finished: deferred() }, current = { reached: deferred(), release: deferred(), finished: deferred() };
  scenarios.set(`GET ${urlA}`, slow); scenarios.set(`GET ${urlB}`, current);
  await cardA.getByRole('button', { name: 'Lịch sử', exact: true }).click(); await bounded(slow.reached.promise, 'old history');
  await cardB.getByRole('button', { name: 'Lịch sử', exact: true }).click(); await bounded(current.reached.promise, 'new history');
  const oldEvents = await slow.response.json(), newEvents = await current.response.json();
  record('real history response event IDs distinct', oldEvents[0].id !== newEvents[0].id, true);
  record('history loading hides old event text', await section().getByText('Tiếp nhận hồ sơ; chưa kết luận trách nhiệm.', { exact: true }).count(), 0);
  current.release.resolve(); await bounded(current.finished.promise, 'current history release');
  await cardB.locator('ol li').filter({ hasText: 'Tiếp nhận hồ sơ' }).waitFor();
  slow.release.resolve(); await bounded(slow.finished.promise, 'old history release');
  await page.waitForTimeout(100);
  record('old response cannot select prior incident', await cardA.locator('ol').count(), 0);
  record('current incident has exactly its own OPEN event', await cardB.locator('ol li').count(), 1);
  record('current history response matches SQL event id', newEvents[0].id, sql(`SELECT id FROM incident_events WHERE case_id=${q(b.id)};`));
  scenarios.clear();
  await section().screenshot({ path: path.join(evidence, 'history-out-of-order.png') });
  record('all 8 business/financial/audit tables unchanged', snapshot(fixtures), before);
  const foreignContext = await browser.newContext();
  await foreignContext.addInitScript(({ token }) => localStorage.setItem('kdrive.jwt', token), { token: foreign.token });
  const foreignPage = await foreignContext.newPage(); monitor(foreignPage);
  expected.push({ method: 'GET', url: `${browserApi}/bookings/${first.id}`, status: 404 });
  expected.push({ method: 'GET', url: `${browserApi}/bookings/${first.id}/review`, status: 404 });
  await foreignPage.goto(`${base}/user/bookings/${first.id}`);
  await foreignPage.getByRole('alert').waitFor();
  record('foreign direct URL has no report form', await foreignPage.locator('[name="occurredAt"]').count(), 0);
  await foreignPage.screenshot({ path: path.join(evidence, 'foreign-denied.png') });
  await foreignContext.close();
  assertNoUnexpected(http, consoleIssues, expected);
  write('assertions.json', { checks, http, consoleIssues, expected, fixtures, cases: [a, b, c] });
}
module.exports = { sql, booking, snapshot, login, q };

if (require.main === module) main().catch(async (error) => {
  if (page) { try { await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }); fs.writeFileSync(path.join(evidence, 'failure.html'), await page.content()); } catch {} }
  write('browser-failure.json', { message: error.message, stack: error.stack, checks, http, consoleIssues });
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
