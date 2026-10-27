import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

// Transaction integration tests require a replica set or mongos. The default
// points at the local test replica set; override TEST_DB_URI when needed.
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
      "Could not connect to the transaction test MongoDB. Set TEST_DB_URI to a replica-set-capable database."
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
      "Transaction tests require a MongoDB replica set or sharded cluster. Set TEST_DB_URI to a transaction-capable database."
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

let accountSequence = 0;

const createAccount = (balanceMinor = 0) =>
  Account.create({
    name: `Test Account ${(accountSequence += 1)}`,
    balanceMinor,
  });

const makeBody = (overrides = {}) => ({
  type: "credit",
  amount: 10,
  description: "Test transaction",
  reference_id: `ref-${new mongoose.Types.ObjectId()}`,
  ...overrides,
});

const postTransaction = (accountId, body) =>
  fetch(`${baseUrl}/api/v1/accounts/${accountId}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const getBalanceMinor = async (accountId) => {
  const account = await Account.findById(accountId).lean();
  return account.balanceMinor;
};

const countTransactions = (accountId) =>
  Transaction.countDocuments({ accountId });

test("credits the account and returns the transaction with the new balance", async () => {
  const account = await createAccount();
  const response = await postTransaction(account._id, {
    type: "credit",
    amount: 125.5,
    description: "  Invoice payment  ",
    reference_id: "  INV-001  ",
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.success, true);

  const { transaction, balance } = payload.data;
  assert.match(transaction.id, /^[a-f0-9]{24}$/);
  assert.equal(transaction.account_id, account._id.toString());
  assert.equal(transaction.type, "credit");
  assert.equal(transaction.amount, 125.5);
  assert.equal(transaction.description, "Invoice payment");
  assert.equal(transaction.reference_id, "INV-001");
  assert.equal(typeof transaction.created_at, "string");
  assert.ok(!Number.isNaN(Date.parse(transaction.created_at)));
  assert.deepEqual(Object.keys(transaction).sort(), [
    "account_id",
    "amount",
    "created_at",
    "description",
    "id",
    "reference_id",
    "type",
  ]);
  assert.equal(balance, 125.5);

  assert.equal(await getBalanceMinor(account._id), 12550);
  const storedTransaction = await Transaction.findById(transaction.id).lean();
  assert.ok(storedTransaction);
  assert.equal(storedTransaction.amountMinor, 12550);
});

test("debits the account and returns the reduced balance", async () => {
  const account = await createAccount(1000);
  const response = await postTransaction(account._id, {
    type: "debit",
    amount: 2.5,
    description: "Bank withdrawal",
    reference_id: "WDR-001",
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.transaction.type, "debit");
  assert.equal(payload.data.transaction.amount, 2.5);
  assert.equal(payload.data.balance, 7.5);
  assert.equal(await getBalanceMinor(account._id), 750);
});

test("allows a debit for the exact available balance", async () => {
  const account = await createAccount(500);
  const response = await postTransaction(account._id, {
    type: "debit",
    amount: 5,
    description: "Full withdrawal",
    reference_id: "WDR-EXACT",
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.balance, 0);
  assert.equal(await getBalanceMinor(account._id), 0);
});

test("rejects insufficient funds without changing the balance or creating a transaction", async () => {
  const account = await createAccount(500);
  const response = await postTransaction(account._id, {
    type: "debit",
    amount: 5.01,
    description: "Too much",
    reference_id: "WDR-INSUFFICIENT",
  });

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /insufficient funds/i);
  assert.equal(await getBalanceMinor(account._id), 500);
  assert.equal(await countTransactions(account._id), 0);
});

test("returns 404 for a well-formed but missing account", async () => {
  const missingAccountId = new mongoose.Types.ObjectId();
  const response = await postTransaction(missingAccountId, makeBody());

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /account not found/i);
  assert.equal(await countTransactions(missingAccountId), 0);
});

test("returns 400 for malformed account IDs", async () => {
  const malformedIds = [
    "abc",
    "123456789012",
    "z".repeat(24),
    new mongoose.Types.ObjectId().toString().slice(0, 23),
  ];

  for (const accountId of malformedIds) {
    const response = await postTransaction(accountId, makeBody());
    assert.equal(response.status, 400, `expected 400 for ${accountId}`);

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.match(payload.error, /invalid account id/i);
  }
});

test("rejects invalid transaction payloads without side effects", async () => {
  const account = await createAccount(1000);
  const invalidBodies = [
    makeBody({ type: "deposit" }),
    makeBody({ type: "CREDIT" }),
    makeBody({ type: undefined }),
    makeBody({ amount: 0 }),
    makeBody({ amount: -1 }),
    makeBody({ amount: 1.001 }),
    makeBody({ amount: "10" }),
    makeBody({ amount: null }),
    makeBody({ amount: undefined }),
    makeBody({ description: "   " }),
    makeBody({ description: 10 }),
    makeBody({ description: "a".repeat(501) }),
    makeBody({ description: undefined }),
    makeBody({ reference_id: "   " }),
    makeBody({ reference_id: 10 }),
    makeBody({ reference_id: "a".repeat(256) }),
    makeBody({ reference_id: undefined }),
    makeBody({ account_id: account._id.toString() }),
    makeBody({ id: new mongoose.Types.ObjectId().toString() }),
    makeBody({ _id: new mongoose.Types.ObjectId().toString() }),
    makeBody({ created_at: "2020-01-01T00:00:00.000Z" }),
    makeBody({ amount_minor: 1000 }),
    makeBody({ balance: 1000 }),
  ];

  for (const body of invalidBodies) {
    const response = await postTransaction(account._id, body);
    assert.equal(
      response.status,
      400,
      `expected 400 for ${JSON.stringify(body)}`
    );

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }

  assert.equal(await getBalanceMinor(account._id), 1000);
  assert.equal(await countTransactions(account._id), 0);
});

test("rejects a duplicate reference and rolls back the attempted balance update", async () => {
  const account = await createAccount();

  const firstResponse = await postTransaction(account._id, {
    type: "credit",
    amount: 1,
    description: "First",
    reference_id: "DUPLICATE-REF",
  });
  assert.equal(firstResponse.status, 201);

  const duplicateResponse = await postTransaction(account._id, {
    type: "credit",
    amount: 2,
    description: "Duplicate",
    reference_id: "DUPLICATE-REF",
  });
  assert.equal(duplicateResponse.status, 409);

  const payload = await duplicateResponse.json();
  assert.match(payload.error, /reference_id already exists/i);
  assert.equal(await getBalanceMinor(account._id), 100);
  assert.equal(await countTransactions(account._id), 1);
});

test("allows the same reference ID on different accounts", async () => {
  const firstAccount = await createAccount();
  const secondAccount = await createAccount();

  const firstResponse = await postTransaction(
    firstAccount._id,
    makeBody({ reference_id: "SHARED-REF" })
  );
  const secondResponse = await postTransaction(
    secondAccount._id,
    makeBody({ reference_id: "SHARED-REF" })
  );

  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 201);
  assert.equal(await countTransactions(firstAccount._id), 1);
  assert.equal(await countTransactions(secondAccount._id), 1);
});

test("rolls back the balance when the transaction insert fails", async (t) => {
  const account = await createAccount();
  t.mock.method(Transaction, "create", async () => {
    throw new Error("simulated transaction insert failure");
  });

  const response = await postTransaction(account._id, makeBody({ amount: 5 }));

  assert.equal(response.status, 500);
  assert.equal(await getBalanceMinor(account._id), 0);
  assert.equal(await countTransactions(account._id), 0);
});

test("does not persist a transaction when the balance write fails", async (t) => {
  const account = await createAccount(1000);
  t.mock.method(Account, "findOneAndUpdate", async () => {
    throw new Error("simulated balance update failure");
  });

  const response = await postTransaction(
    account._id,
    makeBody({ type: "debit", amount: 5 })
  );

  assert.equal(response.status, 500);
  assert.equal(await getBalanceMinor(account._id), 1000);
  assert.equal(await countTransactions(account._id), 0);
});

test("concurrent debits cannot overspend the account", async () => {
  const account = await createAccount(1000);

  const responses = await Promise.all([
    postTransaction(
      account._id,
      makeBody({ type: "debit", amount: 8, reference_id: "CONCURRENT-A" })
    ),
    postTransaction(
      account._id,
      makeBody({ type: "debit", amount: 8, reference_id: "CONCURRENT-B" })
    ),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409]
  );
  assert.equal(await getBalanceMinor(account._id), 200);
  assert.equal(await countTransactions(account._id), 1);
});

test("concurrent duplicate references create only one transaction", async () => {
  const account = await createAccount();

  const responses = await Promise.all([
    postTransaction(
      account._id,
      makeBody({ amount: 5, reference_id: "CONCURRENT-DUPLICATE" })
    ),
    postTransaction(
      account._id,
      makeBody({ amount: 5, reference_id: "CONCURRENT-DUPLICATE" })
    ),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409]
  );
  assert.equal(await getBalanceMinor(account._id), 500);
  assert.equal(await countTransactions(account._id), 1);
});
