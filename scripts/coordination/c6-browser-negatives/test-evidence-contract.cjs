const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSections, assertUnchanged, assertSafeDom, assertConsoleHealth } = require('./evidence-contract.cjs');
test('Explicit sections pass without interpreting metadata or initial result flag', () => {
  const result = { TestSuite: 'C6', AllAssertionsPassed: false, sections: { held: { count: true } } };
  result.AllAssertionsPassed = assertSections(result.sections);
  assert.equal(result.AllAssertionsPassed, true);
});
test('Expected negative HTTP console events require real matching responses', () => {
  const fault={type:'console',message:'Failed to load resource: the server responded with a status of 409 (Conflict)'};
  const events=[{status:409,method:'PATCH',path:'/api/v1/admin/reviews/id'}];
  assertConsoleHealth([fault],events);
  assert.throws(()=>assertConsoleHealth([fault],[]));
  assert.throws(()=>assertConsoleHealth([fault],[{...events[0],path:'/other'}]));
  assert.throws(()=>assertConsoleHealth([fault,fault],events));
  assert.throws(()=>assertConsoleHealth([{...fault,type:'pageerror'}],events));
  assert.throws(()=>assertConsoleHealth([{type:'console',message:'unexpected500'}],events));
});
test('Missing, empty, false, string and skipped assertions fail closed', () => {
  for (const sample of [{}, {a:{}}, {a:{b:false}}, {a:{b:'true'}}, {a:{b:'SKIP'}}]) assert.throws(() => assertSections(sample));
});
test('Entire row includes audit, timestamp, version, content and null values', () => {
  const row = {id:'a',content:'x',version:1,moderated_by:'admin',moderated_at:'now',created_at:'then',hidden:1};
  assertUnchanged(row, {...row});
  for (const key of Object.keys(row)) assert.throws(() => assertUnchanged(row, {...row,[key]:null}));
});
test('Literal dangerous text is allowed; actual DOM elements and sentinels fail', () => {
  const payload='<script>window.__xssScriptExecuted=true;</script><img src="x" onerror="window.__xssImageExecuted=true;">';
  const good={text:payload,scriptCount:0,imageCount:0,scriptExecuted:false,imageExecuted:false};
  assertSafeDom(good,payload);
  for(const [key,value] of [['text','other'],['scriptCount',1],['imageCount',1],['scriptExecuted',true],['imageExecuted',true]]) assert.throws(() => assertSafeDom({...good,[key]:value},payload));
});
