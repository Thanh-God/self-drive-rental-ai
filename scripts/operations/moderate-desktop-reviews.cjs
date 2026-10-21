const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const base = process.env.KDRIVE_API_BASE_URL || 'http://127.0.0.1:8080/api/v1';
const out = path.resolve(process.argv[2] || '.runtime/ux-desktop-improvement-implementation-20261021-102500');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

const allowlist = [
  { id: '7ef0e6f2-7585-4ae2-8cf2-e35d973fc179', match: /1791128697216/ },
  { id: 'd57edd95-ca99-464d-95be-866efd045a70', match: /1791116304068/ },
  { id: 'b8388572-9673-4419-bf48-1954897141a7', match: /6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e/ },
  { id: 'e353d927-5091-4f63-9357-ba4733361e59', match: /1791123669318/ },
];

async function main() {
  const env = fs.readFileSync('backend/.env.local', 'utf8');
  const password = process.env.KDRIVE_ADMIN_PASSWORD || env.match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  assert.ok(password, 'Admin password required');

  const loginRes = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password })
  });
  assert.equal(loginRes.status, 200, 'Admin login failed');
  const { token } = await loginRes.json();
  const authHeaders = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  const adminBeforeRes = await fetch(base + '/admin/reviews', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(adminBeforeRes.status, 200);
  const adminBefore = await adminBeforeRes.json();

  const publicBeforeRes = await fetch(base + '/vehicles/v3/reviews');
  assert.equal(publicBeforeRes.status, 200);
  const publicBefore = await publicBeforeRes.json();

  const preSnapshot = {
    timestamp: new Date().toISOString(),
    totalAdminReviews: adminBefore.length,
    publicV3ReviewsCount: publicBefore.length,
    targetReviews: []
  };

  for (const item of allowlist) {
    const found = adminBefore.find(r => r.id === item.id);
    assert.ok(found, 'Review not found: ' + item.id);
    assert.ok(item.match.test(found.content), 'Content mismatch for ' + item.id);
    preSnapshot.targetReviews.push({
      id: found.id,
      bookingId: found.booking_id,
      rating: found.rating,
      content: found.content,
      hidden: found.hidden,
      version: found.version,
      createdAt: found.created_at
    });
  }

  fs.writeFileSync(path.join(out, 'review-pre-moderation-snapshot.json'), JSON.stringify(preSnapshot, null, 2));

  const patchResults = [];
  for (const target of preSnapshot.targetReviews) {
    if (target.hidden) {
      patchResults.push({ id: target.id, skipped: true, version: target.version });
      continue;
    }
    const patchRes = await fetch(`${base}/admin/reviews/${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ hidden: true, version: target.version })
    });
    assert.equal(patchRes.status, 200, `PATCH /admin/reviews/${target.id} failed with status ${patchRes.status}`);
    patchResults.push({ id: target.id, status: 200, previousVersion: target.version });
  }

  const adminAfterRes = await fetch(base + '/admin/reviews', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(adminAfterRes.status, 200);
  const adminAfter = await adminAfterRes.json();

  const publicAfterRes = await fetch(base + '/vehicles/v3/reviews');
  assert.equal(publicAfterRes.status, 200);
  const publicAfter = await publicAfterRes.json();

  const postSnapshot = {
    timestamp: new Date().toISOString(),
    patchResults,
    totalAdminReviews: adminAfter.length,
    publicV3ReviewsCount: publicAfter.length,
    targetReviewsAfter: []
  };

  for (const item of allowlist) {
    const found = adminAfter.find(r => r.id === item.id);
    assert.ok(found, 'Review missing after moderation: ' + item.id);
    assert.equal(found.hidden, true, 'Review expected hidden=true: ' + item.id);
    postSnapshot.targetReviewsAfter.push({
      id: found.id,
      bookingId: found.booking_id,
      rating: found.rating,
      content: found.content,
      hidden: found.hidden,
      version: found.version,
      createdAt: found.created_at
    });
  }

  assert.equal(publicAfter.length, 0, 'Public reviews for v3 must be empty after hiding the 4 reviews');

  fs.writeFileSync(path.join(out, 'review-post-moderation-snapshot.json'), JSON.stringify(postSnapshot, null, 2));
  console.log('PASS: 4 reviews moderated successfully, public endpoint empty, readback verified.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
