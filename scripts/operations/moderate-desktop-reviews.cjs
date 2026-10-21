const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Exact records approved on 21/10/2026, not a general review-cleanup policy.
const allowlist = Object.freeze([
  { id: '7ef0e6f2-7585-4ae2-8cf2-e35d973fc179', bookingId: '479804a3-32da-4eb0-acf9-0870bac4671f', content: 'Phase 5 browser verification review 1791128697216.' },
  { id: 'd57edd95-ca99-464d-95be-866efd045a70', bookingId: '6510429c-aaf8-4623-a1d5-9a2c52cfab20', content: 'Phase 5 browser verification review 1791116304068.' },
  { id: 'b8388572-9673-4419-bf48-1954897141a7', bookingId: '6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e', content: 'Phase 5 browser verification review 6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e.' },
  { id: 'e353d927-5091-4f63-9357-ba4733361e59', bookingId: 'fb37e8dd-ab03-48a1-ada1-038ea7f1c4c2', content: 'Phase 5 browser verification review 1791123669318.' },
].map(Object.freeze));

async function moderateDesktopReviews(targetUrl, outDir, adminPassword, { apply = false } = {}) {
  assert.ok(outDir, 'A new evidence directory is required');
  // Refuse reused evidence before login, writes, or moderation.
  fs.mkdirSync(outDir, { recursive: false });
  let password = adminPassword || process.env.KDRIVE_ADMIN_PASSWORD;
  if (!password && fs.existsSync('backend/.env.local')) {
    password = fs.readFileSync('backend/.env.local', 'utf8').match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  }
  assert.ok(password, 'Admin password required');
  async function request(endpoint, options = {}) {
    const response = await fetch(targetUrl + endpoint, options);
    assert.equal(response.status, 200, `${options.method || 'GET'} ${endpoint}: HTTP ${response.status}`);
    // ReviewController.moderate returns HTTP 200 with an empty body.
    return options.method === 'PATCH' ? undefined : response.json();
  }
  const { token } = await request('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password }),
  });
  assert.ok(token, 'JWT token required');
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const before = await request('/admin/reviews', { headers });
  const bookings = await request('/bookings', { headers });
  const publicBefore = await request('/vehicles/v3/reviews');
  assert.ok(Array.isArray(before) && Array.isArray(bookings) && Array.isArray(publicBefore), 'Expected API arrays');
  const ids = new Set(allowlist.map(item => item.id));
  assert.equal(new Set(before.map(row => row.id)).size, before.length, 'Duplicate review IDs');
  // Validate every target before the first PATCH, including already-hidden records.
  for (const expected of allowlist) {
    const row = before.find(item => item.id === expected.id);
    assert.ok(row, `Missing approved review: ${expected.id}`);
    assert.equal(row.content, expected.content, `Content drift: ${expected.id}`);
    assert.equal(row.booking_id, expected.bookingId, `Booking drift: ${expected.id}`);
    assert.equal(row.rating, 5, `Rating drift: ${expected.id}`);
    assert.equal(typeof row.hidden, 'boolean', `Invalid hidden state: ${expected.id}`);
    assert.equal(row.version, row.hidden ? 3 : 2, `Version drift: ${expected.id}`);
    const linked = bookings.filter(item => item.id === expected.bookingId);
    assert.equal(linked.length, 1, `Missing/duplicate booking: ${expected.id}`);
    assert.equal(linked[0].vehicleId, 'v3', `Vehicle drift: ${expected.id}`);
    assert.equal(linked[0].status, 'COMPLETED', `Booking status drift: ${expected.id}`);
  }
  fs.writeFileSync(path.join(outDir, 'before.json'), JSON.stringify({ before, publicBefore }, null, 2));
  if (!apply) assert.ok(before.filter(row => ids.has(row.id)).every(row => row.hidden), 'Read-only: visible targets require explicit --apply');
  const changed = new Set();
  for (const expected of allowlist) {
    const row = before.find(item => item.id === expected.id);
    if (row.hidden) continue;
    await request(`/admin/reviews/${row.id}`, { method: 'PATCH', headers, body: JSON.stringify({ hidden: true, version: row.version }) });
    changed.add(row.id);
  }
  const after = await request('/admin/reviews', { headers });
  const publicAfter = await request('/vehicles/v3/reviews');
  assert.ok(Array.isArray(after) && Array.isArray(publicAfter), 'Expected readback arrays');
  assert.equal(after.length, before.length, 'Review count changed');
  assert.equal(new Set(after.map(row => row.id)).size, after.length, 'Duplicate readback IDs');
  for (const original of before) {
    const actual = after.find(row => row.id === original.id);
    assert.ok(actual, `Review missing after readback: ${original.id}`);
    assert.deepEqual(actual, changed.has(original.id) ? { ...original, hidden: true, version: original.version + 1 } : original, `Readback drift: ${original.id}`);
  }
  assert.ok(publicAfter.every(row => !ids.has(row.id)), 'Approved review still public');
  const sorted = rows => rows.filter(row => !ids.has(row.id)).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sorted(publicAfter), sorted(publicBefore), 'Unrelated public reviews changed');
  const result = { apply, changedIds: [...changed], after, publicAfter };
  fs.writeFileSync(path.join(outDir, 'after.json'), JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  // Usage: node scripts/operations/moderate-desktop-reviews.cjs <NEW_OUTPUT> [--apply]
  moderateDesktopReviews(process.env.KDRIVE_API_BASE_URL || 'http://127.0.0.1:8080/api/v1', process.argv[2], null, { apply: process.argv.includes('--apply') })
    .then(result => console.log(`PASS: readback verified; PATCH count=${result.changedIds.length}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { moderateDesktopReviews, allowlist };
