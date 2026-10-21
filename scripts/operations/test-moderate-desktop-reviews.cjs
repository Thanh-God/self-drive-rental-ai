const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { moderateDesktopReviews } = require('./moderate-desktop-reviews.cjs');

// Independent fixtures: do not derive expected identities from the runner allowlist.
const fixtures = [
  ['7ef0e6f2-7585-4ae2-8cf2-e35d973fc179', '479804a3-32da-4eb0-acf9-0870bac4671f', '1791128697216'],
  ['d57edd95-ca99-464d-95be-866efd045a70', '6510429c-aaf8-4623-a1d5-9a2c52cfab20', '1791116304068'],
  ['b8388572-9673-4419-bf48-1954897141a7', '6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e', '6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e'],
  ['e353d927-5091-4f63-9357-ba4733361e59', 'fb37e8dd-ab03-48a1-ada1-038ea7f1c4c2', '1791123669318'],
];
async function fixture(run, setup = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kdrive-review-test-'));
  const state = {
    rows: fixtures.map(([id, booking_id, token]) => ({ id, booking_id, content: `Phase 5 browser verification review ${token}.`, rating: 5, hidden: false, version: 2 })),
    bookings: fixtures.map(([, id]) => ({ id, vehicleId: 'v3', status: 'COMPLETED' })),
    patches: [], requests: [], publicExtra: [{ id: 'legitimate', rating: 4, content: 'Real review' }],
  };
  const output = path.join(root, 'evidence');
  const previousFetch = global.fetch;
  setup(state);
  global.fetch = async (url, options = {}) => {
    const endpoint = new URL(url).pathname;
    state.requests.push(endpoint);
    let body;
    if (state.fail === endpoint) return { status: state.status, json: async () => ({}) };
    if (endpoint === '/auth/login') body = { token: 'isolated-token' };
    else if (endpoint === '/bookings') body = state.bookings;
    else if (endpoint === '/admin/reviews') body = state.rows;
    else if (endpoint === '/vehicles/v3/reviews') body = [...state.rows.filter(row => !row.hidden && fixtures.some(([id]) => row.id === id)), ...state.publicExtra];
    else if (options.method === 'PATCH') {
      state.patches.push({ endpoint, body: JSON.parse(options.body) });
      const row = state.rows.find(item => endpoint.endsWith(item.id));
      row.hidden = true; row.version++;
      state.afterPatch?.(state);
      body = {};
    } else throw Error(`Unexpected endpoint ${endpoint}`);
    return { status: 200, json: async () => {
      if (options.method === 'PATCH') throw new SyntaxError('Empty response body');
      return structuredClone(body);
    } };
  };
  try { await run(state, output); }
  finally {
    global.fetch = previousFetch;
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep), 'Cleanup stays inside temp');
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('approved visible records are hidden with exact versions; legitimate reviews remain public', async () => fixture(async (state, output) => {
  const result = await moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true });
  assert.equal(state.patches.length, 4);
  assert.deepEqual(state.patches.map(item => item.body), Array(4).fill({ hidden: true, version: 2 }));
  assert.deepEqual(result.publicAfter, state.publicExtra);
  assert.ok(fs.existsSync(path.join(output, 'after.json')));
}));

test('already-hidden records verify read-only without PATCH', async () => fixture(async (state, output) => {
  const result = await moderateDesktopReviews('http://isolated.invalid', output, 'fake');
  assert.equal(state.patches.length, 0);
  assert.deepEqual(result.changedIds, []);
}, state => state.rows.forEach(row => { row.hidden = true; row.version = 3; })));

const drifts = [
  ['content substring', state => { state.rows[3].content += ' changed'; }, /Content drift/],
  ['booking identity', state => { state.rows[3].booking_id = 'wrong'; }, /Booking drift/],
  ['rating', state => { state.rows[3].rating = 1; }, /Rating drift/],
  ['visible version', state => { state.rows[3].version = 4; }, /Version drift/],
  ['hidden version', state => { state.rows[3].hidden = true; state.rows[3].version = 4; }, /Version drift/],
  ['invalid hidden', state => { state.rows[3].hidden = 'false'; }, /Invalid hidden/],
  ['missing target', state => { state.rows.pop(); }, /Missing approved review/],
  ['duplicate target', state => { state.rows.push({ ...state.rows[0] }); }, /Duplicate review/],
  ['vehicle mapping', state => { state.bookings[3].vehicleId = 'other'; }, /Vehicle drift/],
  ['booking status', state => { state.bookings[3].status = 'IN_PROGRESS'; }, /Booking status drift/],
  ['missing booking', state => { state.bookings.pop(); }, /Missing\/duplicate booking/],
];
for (const [name, setup, expected] of drifts) test(`refuses ${name} before any PATCH, including drift on fourth target`, async () => fixture(async (state, output) => {
  await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true }), expected);
  assert.equal(state.patches.length, 0);
}, setup));

test('default mode cannot mutate visible reviews', async () => fixture(async (state, output) => {
  await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake'), /Read-only/);
  assert.equal(state.patches.length, 0);
}));

for (const [endpoint, status] of [['/auth/login', 401], ['/admin/reviews', 403], [`/admin/reviews/${fixtures[0][0]}`, 409]]) {
  test(`fails on exact HTTP ${status}`, async () => fixture(async (state, output) => {
    await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true }), new RegExp(`HTTP ${status}`));
    assert.equal(state.patches.length, 0);
  }, state => { state.fail = endpoint; state.status = status; }));
}

for (const field of ['content', 'booking_id', 'rating']) test(`readback rejects changed target ${field}`, async () => fixture(async (state, output) => {
  await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true }), /Readback drift/);
  assert.equal(state.patches.length, 4);
}, state => { state.afterPatch = s => { s.rows[0][field] = field === 'rating' ? 1 : 'changed'; }; }));

test('unrelated Admin review must remain equivalent as API data', async () => fixture(async (state, output) => {
  await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true }), /Readback drift/);
}, state => {
  state.rows.push({ id: 'other', content: 'preserve', hidden: true, version: 1 });
  state.afterPatch = s => { s.rows.at(-1).content = 'changed'; };
}));

test('unrelated public review changes fail readback', async () => fixture(async (state, output) => {
  await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true }), /Unrelated public reviews changed/);
}, state => { state.afterPatch = s => { s.publicExtra[0].content = 'changed'; }; }));

test('reused evidence refuses before requests and preserves existing files', async () => fixture(async (state, output) => {
  fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'sentinel'), 'original');
  await assert.rejects(moderateDesktopReviews('http://isolated.invalid', output, 'fake', { apply: true }), /EEXIST/);
  assert.equal(state.requests.length, 0);
  assert.equal(fs.readFileSync(path.join(output, 'sentinel'), 'utf8'), 'original');
}));
