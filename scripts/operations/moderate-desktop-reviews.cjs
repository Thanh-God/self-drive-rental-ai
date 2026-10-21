const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const base = process.env.KDRIVE_API_BASE_URL || 'http://127.0.0.1:8080/api/v1';
const out = path.resolve(process.argv[2] || '.runtime/ux-desktop-improvement-fix-20261021-112200');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

// Strict allowlist: only the 4 approved test reviews for vehicle v3 (Hyundai Accent)
const allowlist = [
  { id: '7ef0e6f2-7585-4ae2-8cf2-e35d973fc179', match: /1791128697216/ },
  { id: 'd57edd95-ca99-464d-95be-866efd045a70', match: /1791116304068/ },
  { id: 'b8388572-9673-4419-bf48-1954897141a7', match: /6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e/ },
  { id: 'e353d927-5091-4f63-9357-ba4733361e59', match: /1791123669318/ },
];

async function moderateDesktopReviews(targetUrl = base, outDir = out, adminPassword = null) {
  let password = adminPassword || process.env.KDRIVE_ADMIN_PASSWORD;
  if (!password && fs.existsSync('backend/.env.local')) {
    const env = fs.readFileSync('backend/.env.local', 'utf8');
    password = env.match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  }
  assert.ok(password, 'Admin password required');

  const loginRes = await fetch(targetUrl + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password })
  });
  assert.equal(loginRes.status, 200, `Admin login failed with status ${loginRes.status}`);
  const { token } = await loginRes.json();
  assert.ok(token, 'JWT token required from login response');
  const authHeaders = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  // 1. Read current state from Admin API
  const adminBeforeRes = await fetch(targetUrl + '/admin/reviews', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(adminBeforeRes.status, 200, 'GET /admin/reviews failed');
  const adminBefore = await adminBeforeRes.json();
  assert.ok(Array.isArray(adminBefore), 'Admin reviews must be an array');

  // 2. Read current state from Public API
  const publicBeforeRes = await fetch(targetUrl + '/vehicles/v3/reviews');
  assert.equal(publicBeforeRes.status, 200, 'GET /vehicles/v3/reviews failed');
  const publicBefore = await publicBeforeRes.json();
  assert.ok(Array.isArray(publicBefore), 'Public reviews must be an array');

  const preSnapshot = {
    timestamp: new Date().toISOString(),
    totalAdminReviews: adminBefore.length,
    publicV3ReviewsCount: publicBefore.length,
    targetReviews: []
  };

  // 3. Strict guard: verify identity and content of all allowlist items
  for (const item of allowlist) {
    const found = adminBefore.find(r => r.id === item.id);
    assert.ok(found, `Guard failed: review not found in admin list: ${item.id}`);
    assert.ok(item.match.test(found.content), `Guard failed: content regex mismatch for ${item.id}`);
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

  fs.writeFileSync(path.join(outDir, 'review-pre-moderation-snapshot.json'), JSON.stringify(preSnapshot, null, 2));

  // 4. Moderation action with idempotency: do not re-patch if already hidden
  const patchResults = [];
  for (const target of preSnapshot.targetReviews) {
    if (target.hidden) {
      assert.ok(target.version >= 3, `Expected version >= 3 for already moderated review ${target.id}, got ${target.version}`);
      patchResults.push({ id: target.id, skipped: true, reason: 'already_hidden', version: target.version });
      continue;
    }
    const patchRes = await fetch(`${targetUrl}/admin/reviews/${encodeURIComponent(target.id)}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ hidden: true, version: target.version })
    });
    assert.equal(patchRes.status, 200, `PATCH /admin/reviews/${target.id} failed with status ${patchRes.status}`);
    patchResults.push({ id: target.id, status: 200, previousVersion: target.version });
  }

  // 5. Readback verification
  const adminAfterRes = await fetch(targetUrl + '/admin/reviews', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(adminAfterRes.status, 200, 'GET /admin/reviews readback failed');
  const adminAfter = await adminAfterRes.json();

  const publicAfterRes = await fetch(targetUrl + '/vehicles/v3/reviews');
  assert.equal(publicAfterRes.status, 200, 'GET /vehicles/v3/reviews readback failed');
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
    assert.ok(found, `Review missing after moderation: ${item.id}`);
    assert.equal(found.hidden, true, `Review expected hidden=true: ${item.id}`);
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

  // Strict assertion: public endpoint for vehicle v3 must be empty (0 public reviews)
  assert.equal(publicAfter.length, 0, `Public reviews for v3 must be empty after hiding the 4 reviews, got ${publicAfter.length}`);

  // Preservation check: review count in Admin API must be identical before and after
  assert.equal(adminAfter.length, adminBefore.length, 'Total admin reviews count must be preserved');

  fs.writeFileSync(path.join(outDir, 'review-post-moderation-snapshot.json'), JSON.stringify(postSnapshot, null, 2));
  console.log(`PASS: 4 reviews verified/moderated successfully, public endpoint empty (0), readback verified.`);
  return { preSnapshot, postSnapshot };
}

if (require.main === module) {
  moderateDesktopReviews().catch(err => {
    console.error('MODERATION RUNNER FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = { moderateDesktopReviews, allowlist };
