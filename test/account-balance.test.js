import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

// The balance tests create credits and debits through the API, so they need a
// transaction-capable MongoDB. The default points at the local test replica
// set; override TEST_DB_URI when needed.
const TEST_DB_URI =
  process.env.TEST_DB_URI ||
  "mongodb://127.0.0.1:27018/ledger_api_test?replicaSet=rs0";

process.env.NODE_ENV = "test";
process.env.DB_URI = TEST_DB_URI;

let Account;
let Transaction;
let baseUrl;
let server;

before(async () => {
  try {
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 10000 });
  } catch {
    throw new Error(
      "Could not connect to the balance test MongoDB. Set TEST_DB_URI to a replica-set-capable database."
    );
  }

  if (!mongoose.connection.name.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing to run tests that delete ledger data against a database whose name does not contain 'test'."
    );
  }

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    throw new Error(
      "Balance tests require a MongoDB replica set or sharded cluster because they create transactions. Set TEST_DB_URI to a transaction-capable database."
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

const createAccount = async (name = "Balance Test Account") => {
  const response = await fetch(`${baseUrl}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

  assert.equal(response.status, 201);
  return (await response.json()).data;
};

const createTransaction = (accountId, body) =>
  fetch(`${baseUrl}/api/v1/accounts/${accountId}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const getBalance = (accountId) =>
  fetch(`${baseUrl}/api/v1/accounts/${accountId}/balance`);

test("returns zero for a newly created account", async () => {
  const account = await createAccount();
  const response = await getBalance(account.id);

  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.success, true);
  assert.deepEqual(payload.data, {
    account_id: account.id,
    balance: 0,
  });
  assert.deepEqual(Object.keys(payload.data).sort(), ["account_id", "balance"]);
});

test("returns the persisted balance after credit and debit transactions", async () => {
  const account = await createAccount();

  const creditResponse = await createTransaction(account.id, {
    type: "credit",
    amount: 125.5,
    description: "Invoice payment",
    reference_id: "BAL-CREDIT-1",
  });
  assert.equal(creditResponse.status, 201);

  const debitResponse = await createTransaction(account.id, {
    type: "debit",
    amount: 25.25,
    description: "Bank withdrawal",
    reference_id: "BAL-DEBIT-1",
  });
  assert.equal(debitResponse.status, 201);

  const response = await getBalance(account.id);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.data.account_id, account.id);
  assert.equal(payload.data.balance, 100.25);

  // The API response must match the persisted minor-unit value exactly.
  const storedAccount = await Account.findById(account.id).lean();
  assert.equal(storedAccount.balanceMinor, 10025);
});

test("returns 400 for malformed account IDs", async () => {
  const malformedIds = [
    "abc",
    "123456789012",
    "z".repeat(24),
    new mongoose.Types.ObjectId().toString().slice(0, 23),
    "665f1c2a9b1e8a0012a4d3f1ff",
  ];

  for (const accountId of malformedIds) {
    const response = await getBalance(accountId);
    assert.equal(response.status, 400, `expected 400 for ${accountId}`);

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.match(payload.error, /invalid account id/i);
  }
});

test("returns 404 for a well-formed but missing account", async () => {
  const missingAccountId = new mongoose.Types.ObjectId().toString();
  const response = await getBalance(missingAccountId);

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /account not found/i);
});
