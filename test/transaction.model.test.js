import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

import Transaction from "../models/transaction.model.js";

const TEST_DB_URI =
  process.env.TEST_DB_URI || "mongodb://127.0.0.1:27017/ledger_api_test";

process.env.NODE_ENV = "test";
process.env.DB_URI = TEST_DB_URI;

before(async () => {
  try {
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch {
    throw new Error(
      "Could not connect to the test MongoDB. Set TEST_DB_URI to a reachable database."
    );
  }

  if (!mongoose.connection.name.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing to run tests that delete transactions against a database whose name does not contain 'test'."
    );
  }

  // SQL migrations are not part of this project yet. Create the declared
  // indexes explicitly for the same reason `npm run indexes` exists.
  await Transaction.createIndexes();
});

beforeEach(async () => {
  await Transaction.deleteMany({});
});

after(async () => {
  await Transaction.deleteMany({});
  await mongoose.disconnect();
});

const makeTransaction = (overrides = {}) => ({
  accountId: new mongoose.Types.ObjectId(),
  type: "credit",
  amountMinor: 1000,
  description: "Opening deposit",
  referenceId: `ref-${new mongoose.Types.ObjectId()}`,
  ...overrides,
});

const assertValidationError = async (input, field) => {
  await assert.rejects(
    () => new Transaction(input).validate(),
    (error) => {
      assert.ok(
        error.errors?.[field],
        `expected a validation error for ${field}`
      );
      return true;
    }
  );
};

test("creates a valid transaction with a server-controlled timestamp", async () => {
  const before = Date.now();
  const suppliedTimestamp = new Date("2000-01-01T00:00:00.000Z");

  const transaction = await Transaction.create(
    makeTransaction({
      description: "  Opening deposit  ",
      referenceId: "  ref-1  ",
      createdAt: suppliedTimestamp,
    })
  );
  const after = Date.now();

  assert.ok(transaction._id);
  assert.equal(transaction.description, "Opening deposit");
  assert.equal(transaction.referenceId, "ref-1");
  assert.equal(transaction.amountMinor, 1000);
  assert.ok(transaction.createdAt instanceof Date);
  assert.ok(transaction.createdAt.getTime() >= before);
  assert.ok(transaction.createdAt.getTime() <= after);
  assert.notEqual(transaction.createdAt.getTime(), suppliedTimestamp.getTime());
  assert.equal(transaction.updatedAt, undefined);
  assert.equal(transaction.__v, undefined);
});

test("rejects missing required transaction fields", async () => {
  const requiredFields = [
    "accountId",
    "type",
    "amountMinor",
    "description",
    "referenceId",
  ];

  for (const field of requiredFields) {
    const input = makeTransaction();
    delete input[field];

    await assertValidationError(input, field);
  }
});

test("rejects blank descriptions and reference IDs", async () => {
  for (const field of ["description", "referenceId"]) {
    for (const value of ["", "   "]) {
      await assertValidationError(
        makeTransaction({ [field]: value }),
        field
      );
    }
  }
});

test("rejects unsupported transaction types", async () => {
  for (const type of ["deposit", "CREDIT", "transfer", null]) {
    await assertValidationError(makeTransaction({ type }), "type");
  }
});

test("rejects zero, negative, fractional, and non-numeric amounts", async () => {
  for (const amountMinor of [0, -1, 1.5, Number.NaN, undefined]) {
    await assertValidationError(
      makeTransaction({ amountMinor }),
      "amountMinor"
    );
  }
});

test("rejects malformed account IDs", async () => {
  await assertValidationError(
    makeTransaction({ accountId: "not-an-object-id" }),
    "accountId"
  );
});

test("rejects fields that are not in the strict schema", () => {
  assert.throws(
    () => new Transaction(makeTransaction({ unexpected: true })),
    /strict/i
  );
});

test("creates the expected unique and history indexes", async () => {
  const indexes = await Transaction.collection.indexes();
  const indexesByName = new Map(indexes.map((index) => [index.name, index]));

  const uniqueIndex = indexesByName.get("uniq_account_reference");
  assert.ok(uniqueIndex);
  assert.equal(uniqueIndex.unique, true);
  assert.deepEqual(uniqueIndex.key, { accountId: 1, referenceId: 1 });

  assert.deepEqual(indexesByName.get("account_history")?.key, {
    accountId: 1,
    createdAt: -1,
    _id: -1,
  });
  assert.deepEqual(indexesByName.get("account_type_history")?.key, {
    accountId: 1,
    type: 1,
    createdAt: -1,
    _id: -1,
  });
});

test("enforces reference uniqueness within one account", async () => {
  const accountId = new mongoose.Types.ObjectId();
  await Transaction.create(
    makeTransaction({ accountId, referenceId: "duplicate-reference" })
  );

  await assert.rejects(
    () =>
      Transaction.create(
        makeTransaction({ accountId, referenceId: "duplicate-reference" })
      ),
    (error) => error.code === 11000
  );

  assert.equal(await Transaction.countDocuments({ accountId }), 1);
});

test("allows the same reference ID on different accounts", async () => {
  const firstAccountId = new mongoose.Types.ObjectId();
  const secondAccountId = new mongoose.Types.ObjectId();

  await Transaction.create(
    makeTransaction({ accountId: firstAccountId, referenceId: "shared-ref" })
  );
  await Transaction.create(
    makeTransaction({ accountId: secondAccountId, referenceId: "shared-ref" })
  );

  assert.equal(
    await Transaction.countDocuments({ referenceId: "shared-ref" }),
    2
  );
});

test("allows multiple reference IDs within one account", async () => {
  const accountId = new mongoose.Types.ObjectId();

  await Transaction.create(
    makeTransaction({ accountId, referenceId: "ref-one" })
  );
  await Transaction.create(
    makeTransaction({ accountId, referenceId: "ref-two" })
  );

  assert.equal(await Transaction.countDocuments({ accountId }), 2);
});
