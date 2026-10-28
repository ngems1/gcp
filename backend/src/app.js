'use strict';

const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const { validateEmployee, DEPARTMENTS, STATUSES } = require('./validation');

const MAX_LIST = 1000;
const INSTANCE = process.env.INSTANCE_NAME || os.hostname();

function toApi(doc) {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

const byName = (a, b) =>
  a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
  a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' });

/**
 * @param {object} deps
 * @param {object} deps.employees MongoDB-style collection (findOne, find().limit().toArray(),
 *   insertOne, updateOne, deleteOne)
 * @param {() => Promise<unknown>} deps.ping resolves when the database is reachable
 * @param {(line: object) => void} [deps.log] receives one object per request
 */
function createApp({ employees, ping, log = (line) => console.log(JSON.stringify(line)) }) {
  const app = express();
  app.disable('x-powered-by');

  // Served-by header + one JSON log line per request.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.setHeader('X-Served-By', INSTANCE);
    res.on('finish', () => {
      log({
        time: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        latencyMs: Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(2)),
        instance: INSTANCE,
      });
    });
    next();
  });

  app.get('/healthz', (req, res) => res.status(200).type('text/plain').send('ok'));

  app.use(express.json({ limit: '20kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const api = express.Router();

  api.get('/health', async (req, res) => {
    try {
      await ping();
      res.json({ status: 'ok', database: 'up', instance: INSTANCE });
    } catch {
      res.status(503).json({ status: 'error', database: 'down', instance: INSTANCE });
    }
  });

  api.get('/meta', (req, res) =>
    res.json({ departments: DEPARTMENTS, statuses: STATUSES, instance: INSTANCE }));

  api.get('/employees', wrap(async (req, res) => {
    const filter = {};
    const errors = {};
    if (req.query.department !== undefined) {
      if (DEPARTMENTS.includes(req.query.department)) filter.department = req.query.department;
      else errors.department = 'Unknown department';
    }
    if (req.query.status !== undefined) {
      if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
      else errors.status = 'Unknown status';
    }
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Invalid filter', fields: errors });
    }
    const docs = await employees.find(filter).limit(MAX_LIST).toArray();
    res.json(docs.sort(byName).map(toApi));
  }));

  api.get('/employees/:id', wrap(async (req, res) => {
    const doc = await employees.findOne({ _id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Employee not found' });
    res.json(toApi(doc));
  }));

  api.post('/employees', wrap(async (req, res) => {
    const { value, errors } = validateEmployee(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }
    if (await employees.findOne({ email: value.email })) {
      return res.status(409).json({
        error: 'An employee with this email already exists',
        fields: { email: 'Email is already in use' },
      });
    }
    const now = new Date().toISOString();
    const doc = { _id: crypto.randomUUID(), ...value, createdAt: now, updatedAt: now };
    await employees.insertOne(doc);
    res.status(201).json(toApi(doc));
  }));

  api.put('/employees/:id', wrap(async (req, res) => {
    const { value, errors } = validateEmployee(req.body, { partial: true });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Validation failed', fields: errors });
    }
    const existing = await employees.findOne({ _id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Employee not found' });

    if (value.email && value.email !== existing.email) {
      const clash = await employees.findOne({ email: value.email });
      if (clash && clash._id !== existing._id) {
        return res.status(409).json({
          error: 'An employee with this email already exists',
          fields: { email: 'Email is already in use' },
        });
      }
    }
    const changes = { ...value, updatedAt: new Date().toISOString() };
    await employees.updateOne({ _id: existing._id }, { $set: changes });
    res.json(toApi({ ...existing, ...changes }));
  }));

  api.delete('/employees/:id', wrap(async (req, res) => {
    const result = await employees.deleteOne({ _id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Employee not found' });
    res.status(204).end();
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large' });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'An employee with this email already exists',
        fields: { email: 'Email is already in use' },
      });
    }
    log({
      time: new Date().toISOString(),
      level: 'error',
      method: req.method,
      path: req.originalUrl.split('?')[0],
      message: err.message,
      instance: INSTANCE,
    });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
