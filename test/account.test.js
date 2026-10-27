import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, beforeEach, test } from "node:test";

import mongoose from "mongoose";

// Tests use the real MongoDB instance so model defaults, timestamps, and
// validation are exercised. Override TEST_DB_URI when the local server differs.
const TEST_DB_URI =
  process.env.TEST_DB_URI || "mongodb://127.0.0.1:27017/ledger_api_test";

process.env.NODE_ENV = "test";
process.env.DB_URI = TEST_DB_URI;

let Account;
let baseUrl;
let server;

before(async () => {
  try {
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch {
    throw new Error(
      "Could not connect to the test MongoDB. Set TEST_DB_URI to a reachable database."
    );
  }

  const { default: app } = await import("../app.js");
  ({ default: Account } = await import("../models/account.model.js"));

  if (!mongoose.connection.name.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing to run tests that delete accounts against a database whose name does not contain 'test'."
    );
  }

  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  await Account.deleteMany({});
});

after(async () => {
  if (Account) {
    await Account.deleteMany({});
  }

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  await mongoose.disconnect();
});

const postAccount = (body) =>
  fetch(`${baseUrl}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const assertNoAccountsCreated = async () => {
  assert.equal(await Account.countDocuments(), 0);
};

test("creates an account at zero balance with server-controlled fields", async () => {
  const response = await postAccount({ name: "  Ada Lovelace  " });
  assert.equal(response.status, 201);

  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.match(payload.data.id, /^[a-f0-9]{24}$/);
  assert.equal(payload.data.name, "Ada Lovelace");
  assert.equal(payload.data.balance, 0);
  assert.equal(typeof payload.data.created_at, "string");
  assert.ok(!Number.isNaN(Date.parse(payload.data.created_at)));
  assert.deepEqual(Object.keys(payload.data).sort(), [
    "balance",
    "created_at",
    "id",
    "name",
  ]);

  const storedAccount = await Account.findById(payload.data.id);
  assert.ok(storedAccount);
  assert.equal(storedAccount.name, "Ada Lovelace");
  assert.equal(storedAccount.balanceMinor, 0);
});

test("rejects attempts to set balance, identifiers, or timestamps", async () => {
  const forbiddenBodies = [
    { name: "Ada Lovelace", balance: 100 },
    { name: "Ada Lovelace", balance: 0 },
    { name: "Ada Lovelace", balanceMinor: 10000 },
    { name: "Ada Lovelace", id: "665f1c2a9b1e8a0012a4d3f1" },
    { name: "Ada Lovelace", _id: "665f1c2a9b1e8a0012a4d3f1" },
    { name: "Ada Lovelace", created_at: "2020-01-01T00:00:00.000Z" },
    { name: "Ada Lovelace", createdAt: "2020-01-01T00:00:00.000Z" },
  ];

  for (const body of forbiddenBodies) {
    const response = await postAccount(body);
    assert.equal(
      response.status,
      400,
      `expected 400 for fields: ${Object.keys(body).join(", ")}`
    );

    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }

  await assertNoAccountsCreated();
});

test("rejects missing, blank, non-string, and overlong names", async () => {
  const invalidBodies = [
    {},
    { name: "" },
    { name: "   " },
    { name: 123 },
    { name: null },
    { name: ["Ada Lovelace"] },
    { name: "a".repeat(121) },
  ];

  for (const body of invalidBodies) {
    const response = await postAccount(body);
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(typeof payload.error, "string");
  }

  await assertNoAccountsCreated();
});

test("rejects a request body that is not a JSON object", async () => {
  const response = await postAccount([]);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.success, false);
  await assertNoAccountsCreated();
});
