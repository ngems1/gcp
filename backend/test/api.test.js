'use strict';

const { test, beforeEach, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

// Minimal in-memory stand-in for a MongoDB collection (only what app.js uses).
function fakeCollection() {
  const docs = new Map();
  const matches = (d, f) => Object.entries(f).every(([k, v]) => d[k] === v);
  return {
    docs,
    async findOne(f) { return [...docs.values()].find((d) => matches(d, f)) || null; },
    find(f) {
      const rows = [...docs.values()].filter((d) => matches(d, f));
      return { limit(n) { return { async toArray() { return rows.slice(0, n).map((r) => ({ ...r })); } }; } };
    },
    async insertOne(d) { docs.set(d._id, { ...d }); return { insertedId: d._id }; },
    async updateOne(f, u) {
      const d = [...docs.values()].find((x) => matches(x, f));
      if (d) Object.assign(d, u.$set);
      return { matchedCount: d ? 1 : 0 };
    },
    async deleteOne(f) {
      const d = [...docs.values()].find((x) => matches(x, f));
      if (d) docs.delete(d._id);
      return { deletedCount: d ? 1 : 0 };
    },
  };
}

let server;
let base;
let employees;
let dbUp;
let logs;

before(async () => {
  employees = fakeCollection();
  dbUp = true;
  logs = [];
  const app = createApp({
    employees,
    ping: async () => { if (!dbUp) throw new Error('down'); },
    log: (l) => logs.push(l),
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { employees.docs.clear(); dbUp = true; logs.length = 0; });

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
}

const valid = (o = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', email: 'Ada@Example.com',
  department: 'Engineering', role: 'Engineer', hireDate: '2022-02-02', ...o,
});

test('healthz is ok and does not touch the db', async () => {
  dbUp = false;
  const r = await call('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.text, 'ok');
});

test('CRUD happy path', async () => {
  const created = await call('POST', '/api/employees', valid());
  assert.equal(created.status, 201);
  assert.equal(created.json.email, 'ada@example.com');
  assert.equal(created.json.status, 'active');
  assert.ok(created.json.id);
  assert.equal(created.json._id, undefined);
  assert.ok(created.json.createdAt && created.json.updatedAt);
  const { id } = created.json;

  const got = await call('GET', `/api/employees/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.firstName, 'Ada');

  const upd = await call('PUT', `/api/employees/${id}`, { role: 'Principal Engineer', status: 'on_leave' });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.role, 'Principal Engineer');
  assert.equal(upd.json.status, 'on_leave');
  assert.equal(upd.json.firstName, 'Ada');

  const list = await call('GET', '/api/employees');
  assert.equal(list.json.length, 1);

  assert.equal((await call('DELETE', `/api/employees/${id}`)).status, 204);
  assert.equal((await call('GET', `/api/employees/${id}`)).status, 404);
});

test('list is sorted by last then first name and supports exact filters', async () => {
  await call('POST', '/api/employees', valid({ firstName: 'Zed', lastName: 'Adams', email: 'z@x.com', department: 'Sales' }));
  await call('POST', '/api/employees', valid({ firstName: 'Amy', lastName: 'Adams', email: 'a@x.com', status: 'inactive' }));
  await call('POST', '/api/employees', valid({ firstName: 'Bob', lastName: 'Baker', email: 'b@x.com' }));

  const all = await call('GET', '/api/employees');
  assert.deepEqual(all.json.map((e) => e.firstName), ['Amy', 'Zed', 'Bob']);

  const sales = await call('GET', '/api/employees?department=Sales');
  assert.deepEqual(sales.json.map((e) => e.firstName), ['Zed']);

  const inactive = await call('GET', '/api/employees?status=inactive');
  assert.deepEqual(inactive.json.map((e) => e.firstName), ['Amy']);

  const both = await call('GET', '/api/employees?department=Engineering&status=active');
  assert.deepEqual(both.json.map((e) => e.firstName), ['Bob']);

  assert.equal((await call('GET', '/api/employees?department=Nope')).status, 400);
});

test('validation errors list every bad field', async () => {
  const r = await call('POST', '/api/employees', {
    firstName: '', lastName: 'x'.repeat(61), email: 'nope', department: 'Piracy',
    role: '', hireDate: '2022-13-45', status: 'zombie',
  });
  assert.equal(r.status, 400);
  assert.deepEqual(Object.keys(r.json.fields).sort(),
    ['department', 'email', 'firstName', 'hireDate', 'lastName', 'role', 'status']);

  const missing = await call('POST', '/api/employees', {});
  assert.equal(missing.status, 400);
  assert.ok(missing.json.fields.email);
});

test('update validates fields and rejects empty updates', async () => {
  const { json } = await call('POST', '/api/employees', valid());
  const bad = await call('PUT', `/api/employees/${json.id}`, { email: 'bad' });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.fields.email);
  const empty = await call('PUT', `/api/employees/${json.id}`, { nothing: 1 });
  assert.equal(empty.status, 400);
});

test('unknown keys and $ operators are never stored', async () => {
  const r = await call('POST', '/api/employees', valid({ admin: true, $set: { x: 1 }, _id: 'evil', createdAt: 'x' }));
  assert.equal(r.status, 201);
  assert.notEqual(r.json.id, 'evil');
  const stored = employees.docs.get(r.json.id);
  assert.deepEqual(Object.keys(stored).sort(),
    ['_id', 'createdAt', 'department', 'email', 'firstName', 'hireDate', 'lastName', 'role', 'status', 'updatedAt']);
  assert.notEqual(stored.createdAt, 'x');

  const u = await call('PUT', `/api/employees/${r.json.id}`, { role: 'New', $unset: { email: 1 }, extra: 1 });
  assert.equal(u.status, 200);
  assert.equal(employees.docs.get(r.json.id).extra, undefined);
  assert.equal(employees.docs.get(r.json.id).$unset, undefined);
});

test('duplicate email returns 409 on create and update (case-insensitive)', async () => {
  await call('POST', '/api/employees', valid());
  const dup = await call('POST', '/api/employees', valid({ email: 'ADA@example.com' }));
  assert.equal(dup.status, 409);
  assert.ok(dup.json.fields.email);

  const other = await call('POST', '/api/employees', valid({ email: 'other@example.com' }));
  const clash = await call('PUT', `/api/employees/${other.json.id}`, { email: 'ada@example.com' });
  assert.equal(clash.status, 409);

  const same = await call('PUT', `/api/employees/${other.json.id}`, { email: 'other@example.com', role: 'Y' });
  assert.equal(same.status, 200);
});

test('404s are JSON', async () => {
  const cases = [
    ['GET', '/api/employees/nope'],
    ['PUT', '/api/employees/nope', { role: 'x' }],
    ['DELETE', '/api/employees/nope'],
    ['GET', '/api/unknown'],
  ];
  for (const [m, p, b] of cases) {
    const r = await call(m, p, b);
    assert.equal(r.status, 404, `${m} ${p}`);
    assert.ok(r.json.error);
  }
});

test('malformed JSON gives 400 and oversized bodies give 413', async () => {
  const res = await fetch(`${base}/api/employees`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"firstName": ',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Malformed JSON body');

  const big = await fetch(`${base}/api/employees`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'x'.repeat(30000) }),
  });
  assert.equal(big.status, 413);
});

test('/api/health reports database up and down', async () => {
  const up = await call('GET', '/api/health');
  assert.equal(up.status, 200);
  assert.equal(up.json.status, 'ok');
  assert.ok(up.json.instance);

  dbUp = false;
  const down = await call('GET', '/api/health');
  assert.equal(down.status, 503);
  assert.equal(down.json.database, 'down');
});

test('/api/meta lists departments and statuses', async () => {
  const r = await call('GET', '/api/meta');
  assert.ok(r.json.departments.includes('Engineering'));
  assert.deepEqual(r.json.statuses, ['active', 'on_leave', 'inactive']);
});

test('unexpected errors give 500 without leaking details', async () => {
  const orig = employees.find;
  employees.find = () => { throw new Error('secret db detail'); };
  const r = await call('GET', '/api/employees');
  employees.find = orig;
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'Internal server error');
  assert.ok(!r.text.includes('secret db detail'));
});

test('every response has X-Served-By and each request is logged as JSON', async () => {
  const r = await call('GET', '/api/employees/missing');
  assert.ok(r.headers.get('x-served-by'));
  assert.equal((await call('GET', '/healthz')).headers.get('x-served-by'), r.headers.get('x-served-by'));
  const line = logs.find((l) => l.path === '/api/employees/missing');
  assert.equal(line.method, 'GET');
  assert.equal(line.status, 404);
  assert.equal(typeof line.latencyMs, 'number');
  assert.ok(line.instance);
});
