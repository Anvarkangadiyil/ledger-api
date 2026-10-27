import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DB_URI =
  process.env.DB_URI || "mongodb://127.0.0.1:27017/ledger_api_test";

const { swaggerSpec } = await import("../config/swagger.js");

const EXPECTED_OPERATIONS = {
  "/api/v1/health": { get: ["200"] },
  "/api/v1/accounts": { post: ["201", "400", "413", "500"] },
  "/api/v1/accounts/{accountId}/balance": {
    get: ["200", "400", "404", "500"],
  },
  "/api/v1/accounts/{accountId}/transactions": {
    post: ["201", "400", "404", "409", "413", "500", "503"],
    get: ["200", "400", "404", "500"],
  },
  "/api/v1/transfers": {
    post: ["201", "400", "404", "409", "413", "500", "503"],
  },
};

const getOperations = () => {
  const operations = [];

  for (const [path, methods] of Object.entries(swaggerSpec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      operations.push({ path, method, operation });
    }
  }

  return operations;
};

test("documents every implemented endpoint and status code", () => {
  const documented = {};

  for (const { path, method, operation } of getOperations()) {
    documented[path] ??= {};
    documented[path][method] = Object.keys(operation.responses ?? {}).sort();
  }

  const expected = Object.fromEntries(
    Object.entries(EXPECTED_OPERATIONS).map(([path, methods]) => [
      path,
      Object.fromEntries(
        Object.entries(methods).map(([method, statuses]) => [
          method,
          [...statuses].sort(),
        ])
      ),
    ])
  );

  assert.deepEqual(documented, expected);
});

test("documents the server URL used by the app", () => {
  const expectedPort = process.env.PORT || 3000;
  assert.equal(
    swaggerSpec.servers?.[0]?.url,
    `http://localhost:${expectedPort}`
  );
});

test("documents no transaction update or delete operations", () => {
  for (const { path, method } of getOperations()) {
    assert.ok(
      !["put", "patch", "delete"].includes(method),
      `unexpected ${method.toUpperCase()} ${path} operation`
    );
  }
});

test("uses the shared ErrorResponse schema for every documented error", () => {
  for (const { path, method, operation } of getOperations()) {
    for (const [statusCode, response] of Object.entries(
      operation.responses ?? {}
    )) {
      if (Number(statusCode) < 400) {
        continue;
      }

      assert.equal(
        response.content?.["application/json"]?.schema?.$ref,
        "#/components/schemas/ErrorResponse",
        `${method.toUpperCase()} ${path} ${statusCode} must use ErrorResponse`
      );
    }
  }

  assert.ok(swaggerSpec.components?.schemas?.ErrorResponse);
  assert.deepEqual(
    swaggerSpec.components.schemas.ErrorResponse.required.sort(),
    ["error", "success"]
  );
});

test("write endpoints reject unexpected fields in their documented schemas", () => {
  const writeOperations = getOperations().filter(
    ({ method }) => method === "post"
  );

  assert.ok(writeOperations.length > 0);

  for (const { path, method, operation } of writeOperations) {
    const schema =
      operation.requestBody?.content?.["application/json"]?.schema;

    assert.ok(schema, `${method.toUpperCase()} ${path} needs a request schema`);
    assert.equal(
      schema.additionalProperties,
      false,
      `${method.toUpperCase()} ${path} must reject unexpected fields`
    );
  }
});

test("documents the exact public response field names", () => {
  const { schemas } = swaggerSpec.components;

  assert.deepEqual([...schemas.Account.required].sort(), [
    "balance",
    "created_at",
    "id",
    "name",
  ]);
  assert.deepEqual([...schemas.Transaction.required].sort(), [
    "account_id",
    "amount",
    "created_at",
    "description",
    "id",
    "reference_id",
    "type",
  ]);
  assert.deepEqual([...schemas.Transfer.required].sort(), [
    "amount",
    "created_at",
    "description",
    "destination_account_id",
    "reference_id",
    "source_account_id",
  ]);

  assert.deepEqual(schemas.Transaction.properties.type.enum, [
    "credit",
    "debit",
  ]);
  assert.equal(schemas.Account.properties.created_at.format, "date-time");
  assert.equal(schemas.Transaction.properties.created_at.format, "date-time");
  assert.equal(schemas.Transfer.properties.created_at.format, "date-time");
});

test("serves the Swagger UI and generated OpenAPI document", async () => {
  const { default: app } = await import("../app.js");
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const uiResponse = await fetch(`${baseUrl}/api-docs/`);
    assert.equal(uiResponse.status, 200);

    const uiHtml = await uiResponse.text();
    assert.match(uiHtml, /swagger ui/i);

    const specResponse = await fetch(`${baseUrl}/api-docs.json`);
    assert.equal(specResponse.status, 200);

    const spec = await specResponse.json();
    assert.ok(spec.paths["/api/v1/transfers"]?.post);
    assert.ok(
      spec.paths["/api/v1/accounts/{accountId}/transactions"]?.get
    );
    assert.ok(spec.components?.schemas?.Transfer);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
