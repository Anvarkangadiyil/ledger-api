import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";

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
