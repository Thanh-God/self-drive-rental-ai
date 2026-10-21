const http = require('http');
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const { moderateDesktopReviews, allowlist } = require('./moderate-desktop-reviews.cjs');

const out = path.resolve('.runtime/ux-desktop-improvement-fix-20261021-112200/isolated-moderation-tests');
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });

async function createMockServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function runTests() {
  const testResults = [];

  // CASE 1: Guard refusal on unknown review ID
  {
    const server = await createMockServer((req, res) => {
      if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ token: 'mock-admin-token' }));
      }
      if (req.url === '/admin/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Return only 1 of the 4 allowlisted reviews
        return res.end(JSON.stringify([
          { id: allowlist[0].id, content: '1791128697216 test', booking_id: 'b1', rating: 5, hidden: false, version: 1, created_at: new Date().toISOString() }
        ]));
      }
      if (req.url === '/vehicles/v3/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([]));
      }
      res.writeHead(404);
      res.end();
    });

    let threw = false;
    try {
      await moderateDesktopReviews(server.url, out, 'any_password');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Guard failed: review not found in admin list'), `Unexpected error message: ${err.message}`);
    } finally {
      await server.close();
    }
    assert.ok(threw, 'Case 1: Must throw when review not in allowlist');
    testResults.push({ case: 'Unknown review refusal', status: 'PASS' });
  }

  // CASE 2: Guard refusal on content mismatch
  {
    const server = await createMockServer((req, res) => {
      if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ token: 'mock-admin-token' }));
      }
      if (req.url === '/admin/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(allowlist.map((item, i) => ({
          id: item.id,
          // Intentionally wrong content for the first item
          content: i === 0 ? 'Tampered content without matching regex' : '1791116304068 test',
          booking_id: `b${i}`,
          rating: 5,
          hidden: false,
          version: 1,
          created_at: new Date().toISOString()
        }))));
      }
      if (req.url === '/vehicles/v3/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([]));
      }
      res.writeHead(404);
      res.end();
    });

    let threw = false;
    try {
      await moderateDesktopReviews(server.url, out, 'any_password');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Guard failed: content regex mismatch'), `Unexpected error message: ${err.message}`);
    } finally {
      await server.close();
    }
    assert.ok(threw, 'Case 2: Must throw on content regex mismatch');
    testResults.push({ case: 'Content mismatch refusal', status: 'PASS' });
  }

  // CASE 3: 401 Unauthorized handling (invalid admin password)
  {
    const server = await createMockServer((req, res) => {
      if (req.url === '/auth/login') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
      }
      res.writeHead(404);
      res.end();
    });

    let threw = false;
    try {
      await moderateDesktopReviews(server.url, out, 'wrong_password');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Admin login failed with status 401'), `Unexpected error: ${err.message}`);
    } finally {
      await server.close();
    }
    assert.ok(threw, 'Case 3: Must throw on 401 Unauthorized');
    testResults.push({ case: '401 Unauthorized refusal', status: 'PASS' });
  }

  // CASE 4: 403 Forbidden handling (non-admin token accessing /admin/reviews)
  {
    const server = await createMockServer((req, res) => {
      if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ token: 'mock-user-token' }));
      }
      if (req.url === '/admin/reviews') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden' }));
      }
      res.writeHead(404);
      res.end();
    });

    let threw = false;
    try {
      await moderateDesktopReviews(server.url, out, 'any_password');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('GET /admin/reviews failed'), `Unexpected error: ${err.message}`);
    } finally {
      await server.close();
    }
    assert.ok(threw, 'Case 4: Must throw on 403 Forbidden');
    testResults.push({ case: '403 Forbidden refusal', status: 'PASS' });
  }

  // CASE 5: 409 Conflict handling (version mismatch on PATCH)
  {
    const server = await createMockServer((req, res) => {
      if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ token: 'mock-admin-token' }));
      }
      if (req.url === '/admin/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(allowlist.map((item, i) => ({
          id: item.id,
          content: '1791128697216 1791116304068 6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e 1791123669318',
          booking_id: `b${i}`,
          rating: 5,
          hidden: false,
          version: 1,
          created_at: new Date().toISOString()
        }))));
      }
      if (req.url === '/vehicles/v3/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ id: allowlist[0].id }]));
      }
      if (req.method === 'PATCH' && req.url.startsWith('/admin/reviews/')) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Conflict: version mismatch' }));
      }
      res.writeHead(404);
      res.end();
    });

    let threw = false;
    try {
      await moderateDesktopReviews(server.url, out, 'any_password');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('PATCH /admin/reviews/'), `Unexpected error: ${err.message}`);
    } finally {
      await server.close();
    }
    assert.ok(threw, 'Case 5: Must throw on 409 Conflict');
    testResults.push({ case: '409 Conflict refusal', status: 'PASS' });
  }

  // CASE 6: Idempotent positive pass: reviews already hidden (version >= 3), public reviews empty
  {
    let patchCount = 0;
    const server = await createMockServer((req, res) => {
      if (req.url === '/auth/login') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ token: 'mock-admin-token' }));
      }
      if (req.url === '/admin/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(allowlist.map((item, i) => ({
          id: item.id,
          content: '1791128697216 1791116304068 6ee1ceed-ea1a-46f2-ba76-fad88ba4d71e 1791123669318',
          booking_id: `b${i}`,
          rating: 5,
          hidden: true,
          version: 3,
          created_at: new Date().toISOString()
        }))));
      }
      if (req.url === '/vehicles/v3/reviews') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([]));
      }
      if (req.method === 'PATCH' && req.url.startsWith('/admin/reviews/')) {
        patchCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const res = await moderateDesktopReviews(server.url, out, 'any_password');
      assert.equal(patchCount, 0, 'No PATCH should be executed if reviews are already hidden');
      assert.equal(res.postSnapshot.targetReviewsAfter.length, 4);
      assert.equal(res.postSnapshot.publicV3ReviewsCount, 0);
    } finally {
      await server.close();
    }
    testResults.push({ case: 'Idempotent already-moderated verification', status: 'PASS' });
  }

  fs.writeFileSync(path.join(out, 'isolated-test-results.json'), JSON.stringify(testResults, null, 2));
  console.log('PASS: All 6 isolated moderation runner guard tests passed successfully.');
}

runTests().catch(err => {
  console.error('ISOLATED MODERATION TESTS FAILED:', err);
  process.exit(1);
});
