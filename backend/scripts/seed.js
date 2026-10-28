'use strict';

// Inserts sample employees. Idempotent: skips any email that already exists.
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || 'mongodb://admin:password@localhost:27017';
const DB_NAME = process.env.MONGO_DB_NAME || 'user-account';

const SAMPLE = [
  ['Amara', 'Okafor', 'amara.okafor@example.com', 'Engineering', 'Senior Software Engineer', '2021-03-15', 'active'],
  ['Liam', 'Chen', 'liam.chen@example.com', 'Engineering', 'Engineering Manager', '2019-08-01', 'active'],
  ['Sofia', 'Martinez', 'sofia.martinez@example.com', 'Sales', 'Account Executive', '2022-01-10', 'active'],
  ['Noah', 'Williams', 'noah.williams@example.com', 'Sales', 'Sales Director', '2018-05-21', 'on_leave'],
  ['Priya', 'Patel', 'priya.patel@example.com', 'Marketing', 'Content Strategist', '2023-02-06', 'active'],
  ['Ethan', 'Brown', 'ethan.brown@example.com', 'Finance', 'Financial Analyst', '2020-11-02', 'active'],
  ['Grace', 'Nakamura', 'grace.nakamura@example.com', 'HR', 'HR Business Partner', '2017-09-18', 'active'],
  ['Mateo', 'Garcia', 'mateo.garcia@example.com', 'Operations', 'Logistics Coordinator', '2022-07-25', 'on_leave'],
  ['Hannah', 'Schmidt', 'hannah.schmidt@example.com', 'Support', 'Support Specialist', '2024-01-08', 'active'],
  ['Omar', 'Hassan', 'omar.hassan@example.com', 'Support', 'Support Team Lead', '2019-04-29', 'inactive'],
];

async function main() {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  try {
    const employees = client.db(DB_NAME).collection('employees');
    let inserted = 0;
    for (const [firstName, lastName, email, department, role, hireDate, status] of SAMPLE) {
      if (await employees.findOne({ email })) continue;
      const now = new Date().toISOString();
      await employees.insertOne({
        _id: crypto.randomUUID(), firstName, lastName, email, department, role, hireDate, status,
        createdAt: now, updatedAt: now,
      });
      inserted += 1;
    }
    console.log(`Seed complete: ${inserted} inserted, ${SAMPLE.length - inserted} already present.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
