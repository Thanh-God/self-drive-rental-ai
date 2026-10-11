const assert = require('node:assert/strict');
function assertSections(sections) {
  assert.ok(Object.keys(sections).length > 0, 'No sections');
  for (const [section, checks] of Object.entries(sections)) {
    assert.ok(Object.keys(checks).length > 0, `Empty section ${section}`);
    for (const [name, value] of Object.entries(checks)) assert.equal(value, true, `${section}.${name}`);
  }
  return true;
}
function assertUnchanged(before, after) { assert.deepEqual(after, before, 'Full DB row changed'); }
function assertSafeDom(evidence, payload) {
  assert.equal(evidence.text, payload);
  assert.equal(evidence.scriptCount, 0);
  assert.equal(evidence.imageCount, 0);
  assert.equal(evidence.scriptExecuted, false);
  assert.equal(evidence.imageExecuted, false);
}
function assertConsoleHealth(faults, events) {
  const expected = new Map([
    ['Failed to load resource: the server responded with a status of 500 (Internal Server Error)', {status:500,path:'/api/v1/bookings/c6-get-null/review',method:'GET'}],
    ['Failed to load resource: the server responded with a status of 409 (Conflict)', {status:409,method:'PATCH'}],
  ]);
  const counts = new Map();
  for(const fault of faults) {
    const allowed=expected.get(fault.message);
    assert.equal(fault.type,'console','Unexpected runtime exception');
    assert.ok(allowed,'Unexpected console error');
    assert.ok(events.some(e=>e.status===allowed.status&&e.method===allowed.method&&(allowed.path?e.path===allowed.path:e.path.startsWith('/api/v1/admin/reviews/'))),'Expected HTTP response missing');
    counts.set(fault.message,(counts.get(fault.message)||0)+1);
    assert.equal(counts.get(fault.message),1,'Repeated console error');
  }
  return true;
}
module.exports = { assertSections, assertUnchanged, assertSafeDom, assertConsoleHealth };
