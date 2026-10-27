import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

// Immutability checks are read/write-route checks and do not need a replica
// set; seeded ledger entries are inserted directly through the model.
const TEST_DB_URI =
  process.env.TEST_DB_URI || "mongodb://127.0.0.1:27017/ledger_api_test";

process.env.NODE_ENV = "test";
process.env.DB_URI = TEST_DB_URI;

let Account;
let Transaction;
let baseUrl;
let server;

before(async () => {
  try {
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch {
    throw new Error(
      "Could not connect to the immutability test MongoDB. Set TEST_DB_URI to a reachable database."
    );
  }

  if (!mongoose.connection.name.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing to run tests that delete ledger data against a database whose name does not contain 'test'."
    );
  }

  ({ default: Account } = await import("../models/account.model.js"));
  ({ default: Transaction } = await import("../models/transaction.model.js"));

  await Account.createIndexes();
  await Transaction.createIndexes();

  const { default: app } = await import("../app.js");
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await Transaction.deleteMany({});
  await Account.deleteMany({});
});

after(async () => {
  await Transaction.deleteMany({});
  await Account.deleteMany({});

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await mongoose.disconnect();
});

const createAccount = async () => {
  const response = await fetch(`${baseUrl}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Immutability Account" }),
  });

  assert.equal(response.status, 201);
  return (await response.json()).data;
};

const seedTransaction = async (accountId) => {
  const account = await Account.findById(accountId);
  const transaction = await Transaction.create({
    accountId: account._id,
    type: "credit",
    amountMinor: 2500,
    description: "Original ledger entry",
    referenceId: "IMMUTABLE-1",
  });

  account.balanceMinor = 2500;
  await account.save();

  return transaction;
};

test("exposes no transaction update or delete routes", async () => {
  const account = await createAccount();
  const transaction = await seedTransaction(account.id);

  const accountTransactionsUrl = `${baseUrl}/api/v1/accounts/${account.id}/transactions`;
  const attempts = [
    {
      method: "PUT",
      url: `${accountTransactionsUrl}/${transaction._id}`,
      body: { amount: 1 },
    },
    {
      method: "PATCH",
      url: `${accountTransactionsUrl}/${transaction._id}`,
      body: { description: "Tampered" },
    },
    {
      method: "DELETE",
      url: `${accountTransactionsUrl}/${transaction._id}`,
    },
    {
      method: "PUT",
      url: accountTransactionsUrl,
      body: { amount: 1 },
    },
    {
      method: "PATCH",
      url: accountTransactionsUrl,
      body: { type: "debit" },
    },
    {
      method: "DELETE",
      url: accountTransactionsUrl,
    },
    {
      method: "PATCH",
      url: `${baseUrl}/api/v1/transactions/${transaction._id}`,
      body: { amount: 1 },
    },
  ];

  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: attempt.method,
      headers: attempt.body ? { "content-type": "application/json" } : {},
      body: attempt.body ? JSON.stringify(attempt.body) : undefined,
    });

    assert.equal(
      response.status,
      404,
      `expected 404 for ${attempt.method} ${attempt.url}`
    );

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }

  const storedTransaction = await Transaction.findById(transaction._id).lean();
  assert.ok(storedTransaction);
  assert.equal(storedTransaction.type, "credit");
  assert.equal(storedTransaction.amountMinor, 2500);
  assert.equal(storedTransaction.description, "Original ledger entry");
  assert.equal(storedTransaction.referenceId, "IMMUTABLE-1");
  assert.equal(storedTransaction.accountId.toString(), account.id);
  assert.equal(storedTransaction.createdAt.toISOString(), transaction.createdAt.toISOString());

  assert.equal(await Transaction.countDocuments(), 1);
  assert.equal(await Account.findById(account.id).lean().then((doc) => doc.balanceMinor), 2500);
});

test("rejects server-controlled fields when creating a ledger entry", async () => {
  const account = await createAccount();
  const serverControlledFields = [
    { _id: new mongoose.Types.ObjectId().toString() },
    { id: new mongoose.Types.ObjectId().toString() },
    { account_id: account.id },
    { created_at: "2020-01-01T00:00:00.000Z" },
    { amount_minor: 100 },
    { balance: 100 },
  ];

  for (const fields of serverControlledFields) {
    const response = await fetch(
      `${baseUrl}/api/v1/accounts/${account.id}/transactions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "credit",
          amount: 1,
          description: "Mass assignment attempt",
          reference_id: `MASS-${Object.keys(fields)[0]}`,
          ...fields,
        }),
      }
    );

    assert.equal(
      response.status,
      400,
      `expected 400 for ${Object.keys(fields)[0]}`
    );

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }

  assert.equal(await Transaction.countDocuments(), 0);
  assert.equal(await Account.findById(account.id).lean().then((doc) => doc.balanceMinor), 0);
});
