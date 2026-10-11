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
function dispatcher(scenarios) {
  return async (route) => {
    const request = route.request();
    const scenario = scenarios.get(`${request.method()} ${request.url()}`);
    if (!scenario) return route.continue();
    scenario.count = (scenario.count || 0) + 1;
    if (scenario.error) {
      return route.fulfill({ status: scenario.error, contentType: 'application/json',
        body: JSON.stringify({ message: scenario.message }) });
    }
    const response = await route.fetch();
    scenario.response = response;
    scenario.payload = request.postDataJSON();
    scenario.reached.resolve();
    await scenario.release.promise;
    await route.fulfill({ response });
    scenario.finished.resolve();
  };
}

function expectedHttp(issue, expected) {
  return !issue.failure && expected.some((item) => item.method === issue.method &&
    item.url === issue.url && item.status === issue.status);
}

function expectedConsole(issue, expected) {
  if (issue.type !== 'console') return false;
  const match = /^Failed to load resource: the server responded with a status of (\d+)\b/.exec(issue.text);
  return Boolean(match && expected.some((item) =>
    item.url === issue.url && item.status === Number(match[1])));
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
  assert.deepEqual(http.filter((issue) => !expectedHttp(issue, expected)), [], 'unexpected HTTP failure');
  assert.deepEqual(consoleIssues.filter((issue) => !expectedConsole(issue, expected)), [], 'unexpected console/page error');
}

module.exports = { deferred, dispatcher, expectedHttp, expectedConsole, bounded, assertNoUnexpected, mysqlTimestamp };
