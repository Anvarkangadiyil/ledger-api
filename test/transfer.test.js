import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

// Transfers require a replica set or mongos. The default points at the local
// test replica set; override TEST_DB_URI when needed.
const TEST_DB_URI =
  process.env.TEST_DB_URI ||
  "mongodb://127.0.0.1:27018/ledger_api_test?replicaSet=rs0";

process.env.NODE_ENV = "test";
process.env.DB_URI = TEST_DB_URI;

let Account;
let Transaction;
let createTransfer;
let baseUrl;
let server;

before(async () => {
  try {
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 10000 });
  } catch {
    throw new Error(
      "Could not connect to the transfer test MongoDB. Set TEST_DB_URI to a replica-set-capable database."
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
      "Transfer tests require a MongoDB replica set or sharded cluster. Set TEST_DB_URI to a transaction-capable database."
    );
  }

  ({ default: Account } = await import("../models/account.model.js"));
  ({ default: Transaction } = await import("../models/transaction.model.js"));
  ({ createTransfer } = await import("../services/transaction.service.js"));

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
    name: `Transfer Account ${(accountSequence += 1)}`,
    balanceMinor,
  });

const makeBody = (source, destination, overrides = {}) => ({
  source_account_id: source._id.toString(),
  destination_account_id: destination._id.toString(),
  amount: 25,
  description: "Transfer test",
  reference_id: `trf-${new mongoose.Types.ObjectId()}`,
  ...overrides,
});

const postTransfer = (body) =>
  fetch(`${baseUrl}/api/v1/transfers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const getBalanceMinor = async (accountId) => {
  const account = await Account.findById(accountId).lean();
  return account.balanceMinor;
};

const getTransactions = (accountId) =>
  Transaction.find({ accountId }).sort({ createdAt: 1, _id: 1 }).lean();

test("transfers money, updates both balances, and records both ledger entries", async () => {
  const source = await createAccount(10000);
  const destination = await createAccount(500);

  const response = await postTransfer(
    makeBody(source, destination, {
      amount: 25.25,
      description: "  Rent share  ",
      reference_id: "TRF-001",
    })
  );

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.success, true);

  const { transfer, source_balance, destination_balance, transactions } =
    payload.data;

  assert.equal(transfer.reference_id, "TRF-001");
  assert.equal(transfer.amount, 25.25);
  assert.equal(transfer.description, "Rent share");
  assert.equal(transfer.source_account_id, source._id.toString());
  assert.equal(transfer.destination_account_id, destination._id.toString());
  assert.ok(!Number.isNaN(Date.parse(transfer.created_at)));

  assert.equal(source_balance, 74.75);
  assert.equal(destination_balance, 30.25);
  assert.deepEqual(Object.keys(payload.data).sort(), [
    "destination_balance",
    "source_balance",
    "transactions",
    "transfer",
  ]);

  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].type, "debit");
  assert.equal(transactions[0].account_id, source._id.toString());
  assert.equal(transactions[0].reference_id, "TRF-001");
  assert.equal(transactions[0].amount, 25.25);
  assert.equal(transactions[1].type, "credit");
  assert.equal(transactions[1].account_id, destination._id.toString());
  assert.equal(transactions[1].reference_id, "TRF-001");
  assert.equal(transactions[1].amount, 25.25);

  assert.equal(await getBalanceMinor(source._id), 7475);
  assert.equal(await getBalanceMinor(destination._id), 3025);

  const sourceTransactions = await getTransactions(source._id);
  const destinationTransactions = await getTransactions(destination._id);
  assert.equal(sourceTransactions.length, 1);
  assert.equal(sourceTransactions[0].type, "debit");
  assert.equal(sourceTransactions[0].amountMinor, 2525);
  assert.equal(destinationTransactions.length, 1);
  assert.equal(destinationTransactions[0].type, "credit");
  assert.equal(destinationTransactions[0].amountMinor, 2525);
});

test("rejects insufficient source funds without moving money", async () => {
  const source = await createAccount(1000);
  const destination = await createAccount(500);

  const response = await postTransfer(
    makeBody(source, destination, { amount: 10.01 })
  );

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /insufficient funds/i);

  assert.equal(await getBalanceMinor(source._id), 1000);
  assert.equal(await getBalanceMinor(destination._id), 500);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("returns 404 when the source account is missing and changes nothing", async () => {
  const destination = await createAccount(500);
  const missingSource = new mongoose.Types.ObjectId();

  const response = await postTransfer(
    makeBody({ _id: missingSource }, destination)
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.match(payload.error, /source account not found/i);

  assert.equal(await getBalanceMinor(destination._id), 500);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("returns 404 when the destination account is missing and rolls back the source debit", async () => {
  const source = await createAccount(10000);
  const missingDestination = new mongoose.Types.ObjectId();

  const response = await postTransfer(
    makeBody(source, { _id: missingDestination })
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.match(payload.error, /destination account not found/i);

  assert.equal(await getBalanceMinor(source._id), 10000);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("rejects a self-transfer without changing balances", async () => {
  const account = await createAccount(1000);

  const response = await postTransfer(
    makeBody(account, account, { reference_id: "TRF-SELF" })
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /must be different/i);

  assert.equal(await getBalanceMinor(account._id), 1000);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("rejects a duplicate transfer reference without moving money again", async () => {
  const source = await createAccount(10000);
  const destination = await createAccount(0);
  const body = makeBody(source, destination, {
    amount: 5,
    reference_id: "TRF-DUPLICATE",
  });

  const firstResponse = await postTransfer(body);
  assert.equal(firstResponse.status, 201);

  const duplicateResponse = await postTransfer({
    ...body,
    amount: 7,
  });
  assert.equal(duplicateResponse.status, 409);

  const payload = await duplicateResponse.json();
  assert.match(payload.error, /reference_id already exists/i);

  assert.equal(await getBalanceMinor(source._id), 9500);
  assert.equal(await getBalanceMinor(destination._id), 500);
  assert.equal(await Transaction.countDocuments(), 2);
});

test("rolls back the source debit when the destination ledger insert conflicts", async () => {
  const source = await createAccount(1000);
  const destination = await createAccount(100);
  const conflictingReference = "TRF-DEST-CONFLICT";

  // Give the destination an existing ledger entry with the same reference.
  await Transaction.create({
    accountId: destination._id,
    type: "credit",
    amountMinor: 100,
    description: "Existing destination entry",
    referenceId: conflictingReference,
  });

  const response = await postTransfer(
    makeBody(source, destination, {
      amount: 5,
      reference_id: conflictingReference,
    })
  );

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error, /reference_id already exists/i);

  assert.equal(await getBalanceMinor(source._id), 1000);
  assert.equal(await getBalanceMinor(destination._id), 100);
  assert.equal(await Transaction.countDocuments({ accountId: source._id }), 0);
  assert.equal(
    await Transaction.countDocuments({ accountId: destination._id }),
    1
  );
});

test("rolls back the source debit when the destination balance update fails", async (t) => {
  const source = await createAccount(1000);
  const destination = await createAccount(0);

  t.mock.method(Account, "findByIdAndUpdate", async () => {
    throw new Error("simulated destination balance failure");
  });

  const response = await postTransfer(
    makeBody(source, destination, { amount: 5 })
  );

  assert.equal(response.status, 500);
  assert.equal(await getBalanceMinor(source._id), 1000);
  assert.equal(await getBalanceMinor(destination._id), 0);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("concurrent transfers cannot overspend the source account", async () => {
  const source = await createAccount(10000);
  const firstDestination = await createAccount(0);
  const secondDestination = await createAccount(0);

  const responses = await Promise.all([
    postTransfer(
      makeBody(source, firstDestination, {
        amount: 80,
        reference_id: "TRF-CONCURRENT-A",
      })
    ),
    postTransfer(
      makeBody(source, secondDestination, {
        amount: 80,
        reference_id: "TRF-CONCURRENT-B",
      })
    ),
  ]);

  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [201, 409]
  );
  assert.equal(await getBalanceMinor(source._id), 2000);

  const destinationBalances = [
    await getBalanceMinor(firstDestination._id),
    await getBalanceMinor(secondDestination._id),
  ].sort((left, right) => left - right);
  assert.deepEqual(destinationBalances, [0, 8000]);

  assert.equal(await Transaction.countDocuments(), 2);
});

test("rejects malformed IDs, invalid fields, and unexpected fields without side effects", async () => {
  const source = await createAccount(1000);
  const destination = await createAccount(0);

  const invalidBodies = [
    makeBody(source, destination, { source_account_id: "abc" }),
    makeBody(source, destination, { destination_account_id: "z".repeat(24) }),
    makeBody(source, destination, { amount: 0 }),
    makeBody(source, destination, { amount: -1 }),
    makeBody(source, destination, { amount: 1.001 }),
    makeBody(source, destination, { amount: "5" }),
    makeBody(source, destination, { amount: undefined }),
    makeBody(source, destination, { description: "   " }),
    makeBody(source, destination, { description: undefined }),
    makeBody(source, destination, { reference_id: "   " }),
    makeBody(source, destination, { reference_id: undefined }),
    makeBody(source, destination, { type: "debit" }),
    makeBody(source, destination, { balance: 1000 }),
    makeBody(source, destination, { source_balance: 1 }),
    makeBody(source, destination, { id: new mongoose.Types.ObjectId().toString() }),
  ];

  for (const body of invalidBodies) {
    const response = await postTransfer(body);
    assert.equal(
      response.status,
      400,
      `expected 400 for ${JSON.stringify(body)}`
    );

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }

  assert.equal(await getBalanceMinor(source._id), 1000);
  assert.equal(await getBalanceMinor(destination._id), 0);
  assert.equal(await Transaction.countDocuments(), 0);
});

test("maps unavailable MongoDB transaction support to 503", async (t) => {
  const unsupportedError = Object.assign(
    new Error(
      "Transaction numbers are only allowed on a replica set member or mongos"
    ),
    { code: 20 }
  );

  t.mock.method(mongoose, "startSession", async () => ({
    withTransaction: async () => {
      throw unsupportedError;
    },
    endSession: async () => {},
  }));

  await assert.rejects(
    createTransfer({
      sourceAccountId: new mongoose.Types.ObjectId().toString(),
      destinationAccountId: new mongoose.Types.ObjectId().toString(),
      amountMinor: 100,
      description: "Probe",
      referenceId: "TRF-PROBE",
    }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /does not support transactions/i);
      return true;
    }
  );
});
