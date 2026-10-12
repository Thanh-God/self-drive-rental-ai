const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function mysqlTimestamp(iso) {
  const match = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?Z$/.exec(iso);
  assert.ok(match, 'UTC timestamp required');
  const fraction = (match[2] || '').padEnd(9, '0');
  const epochMicros = BigInt(Date.parse(`${match[1]}Z`)) * 1000n +
    (BigInt(fraction) + 500n) / 1000n;
  const seconds = epochMicros / 1000000n;
  const micros = (epochMicros % 1000000n).toString().padStart(6, '0');
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.${micros}`;
}

// One dispatcher owns each route. Scenario changes never unroute a handler
// while its real upstream response is still pending.
function dispatcher(scenarios, backendOrigin = 'http://127.0.0.1:8080') {
  return async (route) => {
    const request = route.request();
    const key = `${request.method()} ${request.url()}`;
    const scenario = scenarios.get(key);
    
    // Map URL from frontend host (5173) to backend host (8080)
    let upstreamUrl = request.url();
    if (upstreamUrl.includes(':5173/api/v1')) {
      upstreamUrl = upstreamUrl.replace(/http:\/\/(?:127\.0\.0\.1|localhost):5173\/api\/v1/, `${backendOrigin}/api/v1`);
    }

    if (scenario && scenario.error) {
      scenario.count = (scenario.count || 0) + 1;
      return route.fulfill({
        status: scenario.error,
        contentType: 'application/json',
        body: JSON.stringify({ message: scenario.message || 'Synthetic error' })
      });
    }

    const response = await route.fetch({ url: upstreamUrl });

    if (scenario) {
      scenario.count = (scenario.count || 0) + 1;
      scenario.response = response;
      try {
        scenario.payload = request.postDataJSON();
      } catch {
        scenario.payload = request.postData();
      }
      if (scenario.reached) scenario.reached.resolve();
      if (scenario.release) await scenario.release.promise;
      await route.fulfill({ response });
      if (scenario.finished) scenario.finished.resolve();
    } else {
      await route.fulfill({ response });
    }
  };
}

function expectedHttp(issue, expected) {
  return !issue.failure && expected.some((item) =>
    item.method === issue.method && item.url === issue.url && item.status === issue.status
  );
}

function expectedConsole(issue, expected) {
  if (issue.type !== 'console') return false;
  const match = /^Failed to load resource: the server responded with a status of (\d+)\b/.exec(issue.text);
  return Boolean(match && expected.some((item) =>
    item.url === issue.url && item.status === Number(match[1])
  ));
}

async function bounded(promise, label, ms = 15000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function assertNoUnexpected(http, consoleIssues, expected) {
  const unexpectedHttpIssues = http.filter((issue) => !expectedHttp(issue, expected));
  assert.deepEqual(unexpectedHttpIssues, [], 'unexpected HTTP failure');
  const unexpectedConsoleIssues = consoleIssues.filter((issue) => !expectedConsole(issue, expected));
  assert.deepEqual(unexpectedConsoleIssues, [], 'unexpected console/page error');
}

module.exports = {
  deferred,
  dispatcher,
  expectedHttp,
  expectedConsole,
  bounded,
  assertNoUnexpected,
  mysqlTimestamp
};

