import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";

import mongoose from "mongoose";

import ApiError from "../errors/api-error.js";
import errorMiddleware from "../middlewares/error.middleware.js";
import { createTransaction } from "../services/transaction.service.js";

let baseUrl;
let server;

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.DB_URI =
    process.env.DB_URI || "mongodb://127.0.0.1:27017/ledger_api_test";

  const { default: app } = await import("../app.js");
  server = app.listen(0);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

const assertErrorEnvelope = (status, payload) => {
  assert.equal(payload.success, false);
  assert.equal(typeof payload.error, "string");
  assert.deepEqual(Object.keys(payload).sort(), ["error", "success"]);
  assert.equal(status >= 400, true);
};

const runMiddleware = (err, nodeEnv = "test") => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;

  try {
    return new Promise((resolve, reject) => {
      const req = { method: "POST", originalUrl: "/api/v1/test" };
      let statusCode;

      const res = {
        headersSent: false,
        status(code) {
          statusCode = code;
          return this;
        },
        json(body) {
          resolve({ statusCode, body });
          return this;
        },
      };

      errorMiddleware(err, req, res, (nextError) => reject(nextError));
    });
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
};

test("unknown routes return the shared 404 error envelope", async () => {
  const response = await fetch(`${baseUrl}/api/v1/does-not-exist`);

  assert.equal(response.status, 404);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/json/
  );

  const payload = await response.json();
  assertErrorEnvelope(response.status, payload);
  assert.match(payload.error, /route not found/i);
});

test("malformed JSON returns a clean 400 without parser internals", async () => {
  const response = await fetch(`${baseUrl}/api/v1/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"name": "Ada Lovelace"',
  });

  assert.equal(response.status, 400);
  const payload = await response.json();

  assertErrorEnvelope(response.status, payload);
  assert.equal(payload.error, "Request body contains invalid JSON");
  assert.doesNotMatch(payload.error, /unexpected token|position|stack/i);
});

test("passes ApiError status and message through unchanged", async () => {
  const { statusCode, body } = await runMiddleware(
    new ApiError(409, "Insufficient funds")
  );

  assert.equal(statusCode, 409);
  assert.deepEqual(body, { success: false, error: "Insufficient funds" });
});

test("maps duplicate-key errors to 409 without exposing index details", async () => {
  const duplicateKeyError = Object.assign(
    new Error("E11000 duplicate key error collection: ledger.transactions"),
    {
      code: 11000,
      keyValue: { accountId: "665f1c2a9b1e8a0012a4d3f1", referenceId: "REF-1" },
      keyPattern: { accountId: 1, referenceId: 1 },
    }
  );

  const { statusCode, body } = await runMiddleware(duplicateKeyError);

  assert.equal(statusCode, 409);
  assert.deepEqual(body, {
    success: false,
    error: "accountId, referenceId already exists",
  });
  assert.doesNotMatch(body.error, /e11000|collection|keyPattern/i);
});

test("maps Mongoose validation errors to 400", async () => {
  const validationError = Object.assign(
    new Error("Transaction validation failed"),
    {
      name: "ValidationError",
      errors: {
        amountMinor: { message: "Amount must be greater than zero" },
        referenceId: { message: "Reference ID is required" },
      },
    }
  );

  const { statusCode, body } = await runMiddleware(validationError);

  assert.equal(statusCode, 400);
  assert.deepEqual(body, {
    success: false,
    error: "Amount must be greater than zero, Reference ID is required",
  });
});

test("maps Mongoose CastError to a 404 without casting details", async () => {
  const castError = Object.assign(new Error("Cast to ObjectId failed"), {
    name: "CastError",
    value: "not-an-object-id",
  });

  const { statusCode, body } = await runMiddleware(castError);

  assert.equal(statusCode, 404);
  assert.deepEqual(body, { success: false, error: "Resource not found" });
});

test("hides unexpected error details in production", async () => {
  const unexpectedError = new Error(
    "connect ECONNREFUSED mongodb://admin:secret@127.0.0.1:27017"
  );

  const { statusCode, body } = await runMiddleware(
    unexpectedError,
    "production"
  );

  assert.equal(statusCode, 500);
  assert.deepEqual(body, {
    success: false,
    error: "Internal Server Error",
  });
  assert.doesNotMatch(body.error, /mongodb|secret|econnrefused/i);
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
    createTransaction({
      accountId: new mongoose.Types.ObjectId().toString(),
      type: "credit",
      amountMinor: 100,
      description: "Probe",
      referenceId: "PROBE-1",
    }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /does not support transactions/i);
      return true;
    }
  );
});

test("does not write a second response when headers were already sent", async () => {
  const originalError = new Error("late failure");
  let nextError;
  let jsonCalled = false;

  const req = { method: "GET", originalUrl: "/api/v1/test" };
  const res = {
    headersSent: true,
    status() {
      throw new Error("status must not be called");
    },
    json() {
      jsonCalled = true;
      throw new Error("json must not be called");
    },
  };

  errorMiddleware(originalError, req, res, (error) => {
    nextError = error;
  });

  assert.equal(nextError, originalError);
  assert.equal(jsonCalled, false);
});
