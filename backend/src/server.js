'use strict';

const { MongoClient } = require('mongodb');
const { createApp } = require('./app');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://admin:password@localhost:27017';
const DB_NAME = process.env.MONGO_DB_NAME || 'user-account';
const PORT = Number(process.env.PORT) || 3000;

const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
const db = client.db(DB_NAME);

// connect() is lazy per operation: the driver reconnects, so a DB outage at boot
// shows up as 503 on /api/health instead of crashing the process.
client.connect().catch((err) => console.error(JSON.stringify({ level: 'error', message: `initial connect failed: ${err.message}` })));

const app = createApp({
  employees: db.collection('employees'),
  ping: () => db.command({ ping: 1 }),
});

const server = app.listen(PORT, () => {
  console.log(JSON.stringify({ level: 'info', message: `backend listening on :${PORT}` }));
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(JSON.stringify({ level: 'info', message: `${signal} received, shutting down` }));
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    await client.close().catch(() => {});
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
