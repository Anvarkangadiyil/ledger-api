import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

// History retrieval is read-only, so it can run against a standalone MongoDB.
// Override TEST_DB_URI when the local server differs.
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
      "Could not connect to the transaction history test MongoDB. Set TEST_DB_URI to a reachable database."
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

const createAccount = async (name = "History Test Account") => {
  const response = await fetch(`${baseUrl}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

  assert.equal(response.status, 201);
  return (await response.json()).data;
};

const insertTransactions = async (accountId, entries) => {
  const documents = entries.map(
    ({
      id = new mongoose.Types.ObjectId(),
      type,
      amountMinor,
      createdAt,
      description = "Seed transaction",
      referenceId = `ref-${id}`,
    }) => ({
      _id: id,
      accountId: new mongoose.Types.ObjectId(accountId),
      type,
      amountMinor,
      description,
      referenceId,
      createdAt: new Date(createdAt),
    })
  );

  await Transaction.collection.insertMany(documents);
  return documents;
};

const fetchHistory = (accountId, query = "") =>
  fetch(
    `${baseUrl}/api/v1/accounts/${accountId}/transactions${query}`
  );

test("returns mixed transactions newest first by created_at", async () => {
  const account = await createAccount();
  await insertTransactions(account.id, [
    {
      type: "debit",
      amountMinor: 500,
      createdAt: "2026-01-01T00:00:00.000Z",
      referenceId: "MIXED-1",
    },
    {
      type: "credit",
      amountMinor: 12550,
      createdAt: "2026-01-02T00:00:00.000Z",
      referenceId: "MIXED-2",
    },
    {
      type: "credit",
      amountMinor: 3000,
      createdAt: "2026-01-03T00:00:00.000Z",
      referenceId: "MIXED-3",
    },
  ]);

  const response = await fetchHistory(account.id);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.success, true);

  assert.deepEqual(Object.keys(payload.data).sort(), [
    "pagination",
    "transactions",
  ]);
  assert.deepEqual(payload.data.pagination, {
    page: 1,
    limit: 20,
    total: 3,
    total_pages: 1,
  });

  const { transactions } = payload.data;
  assert.deepEqual(
    transactions.map((transaction) => transaction.reference_id),
    ["MIXED-3", "MIXED-2", "MIXED-1"]
  );
  assert.deepEqual(
    transactions.map((transaction) => transaction.type),
    ["credit", "credit", "debit"]
  );
  assert.deepEqual(
    transactions.map((transaction) => transaction.amount),
    [30, 125.5, 5]
  );
  assert.deepEqual(Object.keys(transactions[0]).sort(), [
    "account_id",
    "amount",
    "created_at",
    "description",
    "id",
    "reference_id",
    "type",
  ]);
});

test("filters by credit and debit while omitting type returns both", async () => {
  const account = await createAccount();
  const inserted = await insertTransactions(account.id, [
    {
      type: "debit",
      amountMinor: 100,
      createdAt: "2026-02-01T00:00:00.000Z",
      referenceId: "FILTER-DEBIT",
    },
    {
      type: "credit",
      amountMinor: 200,
      createdAt: "2026-02-02T00:00:00.000Z",
      referenceId: "FILTER-CREDIT-1",
    },
    {
      type: "credit",
      amountMinor: 300,
      createdAt: "2026-02-03T00:00:00.000Z",
      referenceId: "FILTER-CREDIT-2",
    },
  ]);

  const allResponse = await fetchHistory(account.id);
  assert.equal(allResponse.status, 200);
  assert.equal((await allResponse.json()).data.pagination.total, 3);

  const creditResponse = await fetchHistory(account.id, "?type=credit");
  assert.equal(creditResponse.status, 200);
  const creditPayload = await creditResponse.json();
  assert.equal(creditPayload.data.pagination.total, 2);
  assert.equal(creditPayload.data.pagination.total_pages, 1);
  assert.deepEqual(
    creditPayload.data.transactions.map((transaction) => transaction.reference_id),
    [inserted[2].referenceId, inserted[1].referenceId]
  );

  const debitResponse = await fetchHistory(account.id, "?type=debit");
  assert.equal(debitResponse.status, 200);
  const debitPayload = await debitResponse.json();
  assert.equal(debitPayload.data.pagination.total, 1);
  assert.deepEqual(
    debitPayload.data.transactions.map((transaction) => transaction.reference_id),
    [inserted[0].referenceId]
  );
});

test("uses _id as a deterministic tie-breaker for equal timestamps", async () => {
  const account = await createAccount();
  const sharedTimestamp = "2026-03-01T00:00:00.000Z";
  const ids = Array.from(
    { length: 5 },
    (_, index) =>
      new mongoose.Types.ObjectId(`00000000000000000000000${index + 1}`)
  );

  await insertTransactions(
    account.id,
    ids.map((id, index) => ({
      id,
      type: "credit",
      amountMinor: (index + 1) * 100,
      createdAt: sharedTimestamp,
      referenceId: `TIE-${index + 1}`,
    }))
  );

  const expectedIds = [...ids]
    .sort((left, right) =>
      right.toString().localeCompare(left.toString())
    )
    .map((id) => id.toString());

  const pageOneResponse = await fetchHistory(account.id, "?limit=2&page=1");
  const pageTwoResponse = await fetchHistory(account.id, "?limit=2&page=2");
  const pageThreeResponse = await fetchHistory(account.id, "?limit=2&page=3");

  assert.equal(pageOneResponse.status, 200);
  assert.equal(pageTwoResponse.status, 200);
  assert.equal(pageThreeResponse.status, 200);

  const pageOne = await pageOneResponse.json();
  const pageTwo = await pageTwoResponse.json();
  const pageThree = await pageThreeResponse.json();

  assert.deepEqual(
    pageOne.data.transactions.map((transaction) => transaction.id),
    expectedIds.slice(0, 2)
  );
  assert.deepEqual(
    pageTwo.data.transactions.map((transaction) => transaction.id),
    expectedIds.slice(2, 4)
  );
  assert.deepEqual(
    pageThree.data.transactions.map((transaction) => transaction.id),
    expectedIds.slice(4)
  );

  for (const page of [pageOne, pageTwo, pageThree]) {
    assert.equal(page.data.pagination.total, 5);
    assert.equal(page.data.pagination.limit, 2);
    assert.equal(page.data.pagination.total_pages, 3);
  }
});

test("paginates first, middle, out-of-range pages and documents empty pages", async () => {
  const account = await createAccount();
  const inserted = await insertTransactions(
    account.id,
    Array.from({ length: 5 }, (_, index) => ({
      type: "credit",
      amountMinor: 1000 + index,
      createdAt: `2026-04-0${index + 1}T00:00:00.000Z`,
      referenceId: `PAGE-${index + 1}`,
    }))
  );

  const firstResponse = await fetchHistory(account.id, "?page=1&limit=2");
  const middleResponse = await fetchHistory(account.id, "?page=2&limit=2");
  const lastResponse = await fetchHistory(account.id, "?page=3&limit=2");
  const beyondResponse = await fetchHistory(account.id, "?page=4&limit=2");

  assert.equal(firstResponse.status, 200);
  assert.equal(middleResponse.status, 200);
  assert.equal(lastResponse.status, 200);
  assert.equal(beyondResponse.status, 200);

  const first = await firstResponse.json();
  const middle = await middleResponse.json();
  const last = await lastResponse.json();
  const beyond = await beyondResponse.json();

  const referenceIds = (payload) =>
    payload.data.transactions.map((transaction) => transaction.reference_id);

  assert.deepEqual(referenceIds(first), ["PAGE-5", "PAGE-4"]);
  assert.deepEqual(referenceIds(middle), ["PAGE-3", "PAGE-2"]);
  assert.deepEqual(referenceIds(last), ["PAGE-1"]);
  assert.deepEqual(referenceIds(beyond), []);

  assert.deepEqual(first.data.pagination, {
    page: 1,
    limit: 2,
    total: 5,
    total_pages: 3,
  });
  assert.deepEqual(middle.data.pagination, {
    page: 2,
    limit: 2,
    total: 5,
    total_pages: 3,
  });
  assert.deepEqual(last.data.pagination, {
    page: 3,
    limit: 2,
    total: 5,
    total_pages: 3,
  });
  assert.deepEqual(beyond.data.pagination, {
    page: 4,
    limit: 2,
    total: 5,
    total_pages: 3,
  });

  assert.equal(inserted.length, 5);
});

test("returns an empty page with total_pages zero for an account with no transactions", async () => {
  const account = await createAccount();

  const response = await fetchHistory(account.id, "?type=debit");
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(payload.data.transactions, []);
  assert.deepEqual(payload.data.pagination, {
    page: 1,
    limit: 20,
    total: 0,
    total_pages: 0,
  });
});

test("accepts the documented limit boundary of 100", async () => {
  const account = await createAccount();
  const response = await fetchHistory(account.id, "?limit=100");
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.data.pagination.limit, 100);
});

test("rejects malformed query parameters", async () => {
  const account = await createAccount();
  const invalidQueries = [
    "?type=transfer",
    "?type=",
    "?type=CREDIT",
    "?type=credit&type=debit",
    "?page=0",
    "?page=-1",
    "?page=1.5",
    "?page=abc",
    "?page=",
    "?page=1&page=2",
    "?limit=0",
    "?limit=-1",
    "?limit=1.5",
    "?limit=abc",
    "?limit=",
    "?limit=101",
    "?limit=1&limit=2",
  ];

  for (const query of invalidQueries) {
    const response = await fetchHistory(account.id, query);
    assert.equal(response.status, 400, `expected 400 for ${query}`);

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }
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
    const response = await fetchHistory(accountId);
    assert.equal(response.status, 400, `expected 400 for ${accountId}`);

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.match(payload.error, /invalid account id/i);
  }
});

test("returns 404 for a well-formed but missing account", async () => {
  const missingAccountId = new mongoose.Types.ObjectId().toString();
  const response = await fetchHistory(missingAccountId);

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /account not found/i);
});
