const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deferred, dispatcher, expectedHttp, expectedConsole, bounded, mysqlTimestamp } = require('./browser-controls.cjs');

test('TIMESTAMP(6) comparison rounds nanoseconds with carry and preserves exact microseconds', () => {
  assert.equal(mysqlTimestamp('2026-10-11T09:59:16.518726Z'), '2026-10-11T09:59:16.518726');
  assert.equal(mysqlTimestamp('2026-10-11T09:59:16.518726700Z'), '2026-10-11T09:59:16.518727');
  assert.equal(mysqlTimestamp('2026-10-11T09:59:16.999999700Z'), '2026-10-11T09:59:17.000000');
});

test('held real response is fulfilled once even when the scenario is removed', async () => {
  const scenario = { reached: deferred(), release: deferred(), finished: deferred() };
  const scenarios = new Map([['POST http://fixture/incidents', scenario]]);
  const calls = [];
  const response = { status: () => 201 };
  const route = {
    request: () => ({ method: () => 'POST', url: () => 'http://fixture/incidents', postDataJSON: () => ({ occurredAt: 'UTC' }) }),
    fetch: async () => { calls.push('fetch'); return response; },
    fulfill: async (value) => { calls.push(value.response); },
    continue: async () => { throw new Error('unexpected continue'); },
  };
  const running = dispatcher(scenarios)(route);
  await scenario.reached.promise;
  scenarios.clear();
  assert.deepEqual(calls, ['fetch']);
  scenario.release.resolve();
  await running;
  assert.deepEqual(calls, ['fetch', response]);
  assert.equal(scenario.count, 1);
});

test('intentional transport failure awaits one fulfillment; upstream failures propagate', async () => {
  const scenarios = new Map([['GET u', { error: 500, message: 'planned' }]]);
  let count = 0;
  await dispatcher(scenarios)({ request: () => ({ method: () => 'GET', url: () => 'u' }),
    fulfill: async ({ status }) => { assert.equal(status, 500); count++; } });
  assert.equal(count, 1);
  scenarios.set('GET u', { reached: deferred(), release: deferred() });
  await assert.rejects(dispatcher(scenarios)({ request: () => ({ method: () => 'GET', url: () => 'u' }),
    fetch: async () => { throw new Error('UPSTREAM_FAILURE'); } }), /UPSTREAM_FAILURE/);
});

test('error classification rejects wrong endpoint, status, method and page errors', () => {
  const expected = [{ method: 'GET', url: 'u', status: 500 }];
  assert.equal(expectedHttp({ method: 'GET', url: 'u', status: 500 }, expected), true);
  for (const issue of [{ method: 'POST', url: 'u', status: 500 }, { method: 'GET', url: 'other', status: 500 },
    { method: 'GET', url: 'u', status: 403 }, { method: 'GET', url: 'u', status: 500, failure: 'aborted' }]) {
    assert.equal(expectedHttp(issue, expected), false);
  }
  const issue = { type: 'console', url: 'u', text: 'Failed to load resource: the server responded with a status of 500 (Server Error)' };
  assert.equal(expectedConsole(issue, expected), true);
  assert.equal(expectedConsole({ ...issue, url: 'other' }, expected), false);
  assert.equal(expectedConsole({ ...issue, type: 'pageerror' }, expected), false);
  assert.equal(expectedConsole({ ...issue, text: '/api/v1/incidents unexpected bug' }, expected), false);
});

test('missing response checkpoint times out instead of hanging', async () => {
  await assert.rejects(bounded(new Promise(() => {}), 'response', 5), /Timeout: response/);
});
