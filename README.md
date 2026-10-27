# Transaction Ledger API

A small REST API for an immutable transaction ledger, built for the Full Stack
Developer Assessment. It supports account creation, atomic credits and debits,
balance lookup, filtered and paginated transaction history, and atomic transfers
between accounts.

## Features

- Account creation with a server-generated ID, server-generated timestamp, and a
  zero opening balance.
- Atomic credit and debit transactions: the balance update and ledger insert
  commit or roll back together.
- Conditional debit updates so concurrent requests cannot overspend an account.
- Per-account idempotency through a unique `(accountId, referenceId)` index.
- Balance lookup with distinct `400` (malformed ID) and `404` (missing account)
  behavior.
- Transaction history with `type` filtering, page/limit pagination, newest-first
  ordering, and a deterministic `_id` tie-breaker.
- Immutable ledger records: there are no transaction update or delete endpoints.
- Bonus: atomic money transfers between two accounts.
- Consistent JSON error envelope and Swagger/OpenAPI documentation.
- Integration tests against a real MongoDB replica set.

## Stack

- Node.js, ES modules
- Express 4
- MongoDB with Mongoose 9
- Swagger/OpenAPI via `swagger-jsdoc` and `swagger-ui-express`
- Node's built-in test runner and ESLint

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine with Docker Compose v2.17+
  for the container setup. This is the simplest way for a reviewer to run the
  project.
- Node.js 20 or newer for the non-Docker setup. The project was verified on
  Node.js 20.20.0; no `engines` constraint is declared in `package.json`.
- npm.
- MongoDB configured as a **replica set** or sharded cluster (not needed with
  Docker). Transactions are required and there is no two-write fallback.
  MongoDB 8.3 was used locally.

## Quick start with Docker

The Compose stack runs the API, a single-node MongoDB 8.0 replica set, a
one-shot replica-set initializer, and a one-shot index setup. No local MongoDB
or `.env` file is required.

```bash
docker compose up --build
```

Wait for `Server running` in the app logs, then open:

- API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/api-docs`
- OpenAPI JSON: `http://localhost:3000/api-docs.json`

Verify the stack:

```bash
curl http://localhost:3000/api/v1/health
curl -X POST http://localhost:3000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace"}'
```

Run in the background and follow the logs:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Stop the stack:

```bash
docker compose down       # stop, keep the MongoDB data volume
docker compose down -v    # stop and delete the data volume for a clean start
```

Use a different host port if `3000` is already in use. The app and the Swagger
server URL both follow `APP_PORT`.

Bash:

```bash
APP_PORT=8080 docker compose up --build
```

PowerShell:

```powershell
$env:APP_PORT = "8080"
docker compose up --build
```

Services started by Compose:

| Service | Purpose |
| --- | --- |
| `mongo` | MongoDB 8.0 started with `--replSet rs0`. Data persists in the `mongo-data` volume; its port is not published to the host. |
| `mongo-init` | Idempotently runs `rs.initiate(...)` and waits for a primary. |
| `indexes` | Runs `npm run indexes` once, before the API starts. |
| `app` | Production Node image built from `Dockerfile`, with a health check at `/api/v1/health`. |

Inspect the replica set:

```bash
docker compose exec mongo mongosh --quiet --eval "rs.status().ok"
```

The app container uses `NODE_ENV=production`, so stack traces and database
details are not returned in API errors. This setup is intended for local
evaluation and does not configure MongoDB authentication or TLS.

## Local setup without Docker

Skip this section if you use the Compose stack above.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file from the template:

   ```bash
   cp .env.example .env.development.local
   ```

   On PowerShell:

   ```powershell
   Copy-Item .env.example .env.development.local
   ```

   `config/env.js` loads `.env.${NODE_ENV || "development"}.local`, so
   `.env.development.local` is used by default. Do not commit real `.env.*.local`
   files; they are gitignored.

3. Configure the environment variables:

   | Variable | Required | Default | Purpose |
   | --- | --- | --- | --- |
   | `PORT` | No | `3000` | HTTP port used by the app and the Swagger server URL. |
   | `NODE_ENV` | No | `development` | Selects `.env.<NODE_ENV>.local` and controls production error sanitization. |
   | `DB_URI` | Yes | — | MongoDB connection string. It must point at a replica set or mongos. |
   | `TEST_DB_URI` | No | see [Testing](#testing) | Overrides the database used by the test suites. The database name must contain `test`. |

   Example safe placeholders:

   ```dotenv
   PORT=3000
   NODE_ENV=development
   DB_URI=mongodb://127.0.0.1:27017/ledger?replicaSet=rs0
   ```

## Run a local MongoDB replica set

A standalone `mongod` cannot run the transactions used by this API. Start a
dedicated single-node replica set, for example on port `27018`:

Bash:

```bash
mkdir -p /tmp/ledger-mongo
mongod --dbpath /tmp/ledger-mongo --port 27018 \
  --bind_ip 127.0.0.1 --replSet rs0
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\ledger-mongo" | Out-Null
mongod --dbpath "$env:TEMP\ledger-mongo" --port 27018 `
  --bind_ip 127.0.0.1 --replSet rs0
```

In another terminal, initialize the set once:

```bash
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
mongosh --port 27018 --eval "rs.status().ok"
```

Then point the application at it:

```dotenv
DB_URI=mongodb://127.0.0.1:27018/ledger?replicaSet=rs0
```

If you use an existing MongoDB service on `27017`, it must also be started with
replica-set configuration. When transactions are unavailable, transaction and
transfer requests return `503` rather than performing unsafe partial writes.

## Database indexes

Create the declared ledger indexes explicitly after configuring `DB_URI`:

```bash
npm run indexes
```

This runs `scripts/ensure-indexes.js`, which calls `createIndexes()` for the
transaction model and prints the resulting index names. It never drops existing
indexes and does not call `syncIndexes()`. The transaction model disables
Mongoose automatic index creation, so run this command during setup and after
deploying index changes.

Transaction indexes:

- `uniq_account_reference`: unique `(accountId, referenceId)`
- `account_history`: `(accountId, createdAt desc, _id desc)`
- `account_type_history`: `(accountId, type, createdAt desc, _id desc)`

## Run the API

```bash
npm start       # node app.js
npm run dev     # nodemon app.js
```

Health check:

```bash
curl http://localhost:3000/api/v1/health
```

## API documentation

- Swagger UI: `http://localhost:<PORT>/api-docs`
- OpenAPI JSON: `http://localhost:<PORT>/api-docs.json`

With the default configuration, use `http://localhost:3000/api-docs`. The server
URL in the generated specification uses the same `PORT` default as the app.

## Response conventions

Success responses use:

```json
{
  "success": true,
  "data": {}
}
```

Errors use the same envelope without stack traces, raw driver errors, or
connection details:

```json
{
  "success": false,
  "error": "Human-readable message"
}
```

Status codes:

| Status | Meaning |
| --- | --- |
| `200` | Successful read. |
| `201` | Account, transaction, or transfer created. |
| `400` | Malformed JSON, invalid/absent fields, malformed account IDs, invalid query parameters, or a self-transfer. |
| `404` | Well-formed account ID with no matching account, or an unknown route. |
| `409` | Duplicate `reference_id` or insufficient funds. No balance or ledger change is committed. |
| `413` | Request body exceeds the parser limit. |
| `500` | Unexpected server or database failure. |
| `503` | MongoDB does not support transactions. |

## Endpoints

### Create an account

`POST /api/v1/accounts`

```bash
curl -X POST http://localhost:3000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace"}'
```

The opening balance is always zero. Clients cannot set `balance`, IDs, or
timestamps; unexpected fields are rejected.

```json
{
  "success": true,
  "data": {
    "id": "665f1c2a9b1e8a0012a4d3f1",
    "name": "Ada Lovelace",
    "balance": 0,
    "created_at": "2026-10-27T10:00:00.000Z"
  }
}
```

### Create a credit or debit

`POST /api/v1/accounts/:accountId/transactions`

Credit:

```bash
curl -X POST http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "type":"credit",
    "amount":125.50,
    "description":"Invoice payment",
    "reference_id":"INV-2026-001"
  }'
```

Debit:

```bash
curl -X POST http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "type":"debit",
    "amount":25.00,
    "description":"Bank withdrawal",
    "reference_id":"WDR-2026-001"
  }'
```

Successful response (`201`):

```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "666f1c2a9b1e8a0012a4d3f2",
      "account_id": "665f1c2a9b1e8a0012a4d3f1",
      "type": "credit",
      "amount": 125.5,
      "description": "Invoice payment",
      "reference_id": "INV-2026-001",
      "created_at": "2026-10-27T10:05:00.000Z"
    },
    "balance": 125.5
  }
}
```

A debit is rejected with `409` and no side effects when the account has
insufficient funds. A duplicate `reference_id` on the same account also returns
`409` and creates no transaction.

### Get an account balance

`GET /api/v1/accounts/:accountId/balance`

```bash
curl http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/balance
```

```json
{
  "success": true,
  "data": {
    "account_id": "665f1c2a9b1e8a0012a4d3f1",
    "balance": 125.5
  }
}
```

Malformed IDs return `400`; well-formed but missing accounts return `404`.

### Get transaction history

`GET /api/v1/accounts/:accountId/transactions`

Query parameters:

| Parameter | Default | Rules |
| --- | --- | --- |
| `type` | both | `credit` or `debit`. |
| `page` | `1` | Positive integer, one-based. |
| `limit` | `20` | Positive integer, maximum `100`. |

```bash
curl "http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/transactions?type=credit&page=1&limit=20"
```

```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "666f1c2a9b1e8a0012a4d3f2",
        "account_id": "665f1c2a9b1e8a0012a4d3f1",
        "type": "credit",
        "amount": 125.5,
        "description": "Invoice payment",
        "reference_id": "INV-2026-001",
        "created_at": "2026-10-27T10:05:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "total_pages": 1
    }
  }
}
```

Results are sorted newest first by `created_at`, then `_id` descending. An empty
result returns `transactions: []`, `total: 0`, and `total_pages: 0`.

### Transfer money (bonus)

`POST /api/v1/transfers`

```bash
curl -X POST http://localhost:3000/api/v1/transfers \
  -H "Content-Type: application/json" \
  -d '{
    "source_account_id":"665f1c2a9b1e8a0012a4d3f1",
    "destination_account_id":"666f1c2a9b1e8a0012a4d3f2",
    "amount":25.00,
    "description":"Rent share",
    "reference_id":"TRF-2026-001"
  }'
```

```json
{
  "success": true,
  "data": {
    "transfer": {
      "reference_id": "TRF-2026-001",
      "amount": 25,
      "description": "Rent share",
      "source_account_id": "665f1c2a9b1e8a0012a4d3f1",
      "destination_account_id": "666f1c2a9b1e8a0012a4d3f2",
      "created_at": "2026-10-27T10:10:00.000Z"
    },
    "source_balance": 75,
    "destination_balance": 25,
    "transactions": [
      {
        "id": "667f1c2a9b1e8a0012a4d3f3",
        "account_id": "665f1c2a9b1e8a0012a4d3f1",
        "type": "debit",
        "amount": 25,
        "description": "Rent share",
        "reference_id": "TRF-2026-001",
        "created_at": "2026-10-27T10:10:00.000Z"
      },
      {
        "id": "667f1c2a9b1e8a0012a4d3f4",
        "account_id": "666f1c2a9b1e8a0012a4d3f2",
        "type": "credit",
        "amount": 25,
        "description": "Rent share",
        "reference_id": "TRF-2026-001",
        "created_at": "2026-10-27T10:10:00.000Z"
      }
    ]
  }
}
```

Both account updates and both ledger inserts run in one MongoDB transaction. If
either account update or ledger insert fails, every change rolls back.

## Money representation

- Internally, money is stored as integer minor units (`balanceMinor`,
  `amountMinor`).
- Public requests and responses use major currency units with at most two
  decimal places. `100` minor units equal `1` major unit.
- Amounts must be positive JSON numbers. Zero, negative, non-numeric, and
  over-precise values are rejected with `400`.
- Conversions happen once at the API boundary; balances are never recomputed
  from history.
- No currency is specified; the API assumes a single two-decimal currency.

## Idempotency and immutability

- `reference_id` is unique per account through the database index
  `uniq_account_reference` on `(accountId, referenceId)`.
- The same `reference_id` may be used by different accounts.
- A duplicate reference returns `409` and changes neither the balance nor the
  ledger.
- Ledger entries are immutable. No transaction update or delete endpoint
  exists, and clients cannot set IDs, timestamps, account IDs, or internal
  amount fields.
- All identifiers and timestamps are server-generated.

### Transfer reference semantics

The transfer `reference_id` is recorded on **both** ledger entries, so it is
subject to the per-account unique index on each side. Both accounts must not have
used that reference before. Retrying a transfer with the same reference returns
`409` and moves no money, including after a successful transfer. Use a new
reference for a genuinely new transfer. Self-transfers are rejected with `400`.

## Testing

The Docker image installs production dependencies only, so run the test suite on
the host with the setup described in [Local setup without Docker](#local-setup-without-docker).
The test database remains a normal MongoDB replica set; Compose is only for
running the API.

Run the lint check and the full suite:

```bash
npm run lint
npm test
```

The tests need a transaction-capable database. The simplest setup is to point
every suite at the test replica set:

Bash:

```bash
TEST_DB_URI="mongodb://127.0.0.1:27018/ledger_api_test?replicaSet=rs0" npm test
```

PowerShell:

```powershell
$env:TEST_DB_URI = "mongodb://127.0.0.1:27018/ledger_api_test?replicaSet=rs0"
npm test
```

If `TEST_DB_URI` is not set, transaction, transfer, and balance tests default to
`mongodb://127.0.0.1:27018/ledger_api_test?replicaSet=rs0`, while the read-only
account, history, model, and immutability suites default to
`mongodb://127.0.0.1:27017/ledger_api_test`. Both databases are therefore needed
for a bare `npm test`.

The test suites refuse to delete data unless the database name contains `test`.

There is no TypeScript or separate build step, so no type-check or build command
is available.

## Project structure

```text
app.js                  Express app, middleware, route mounting
config/                 Environment, database, and Swagger setup
controllers/            Thin request handlers
docker/                 Compose replica-set initializer
errors/                 ApiError class
middlewares/            Global error and not-found middleware
models/                 Account and Transaction schemas and indexes
routes/                 Express routers with OpenAPI annotations
scripts/                Explicit index setup
services/               Account, transaction, history, and transfer logic
test/                   Integration, validation, immutability, and contract tests
utils/                  Async handler and money conversion
validators/             Request and query validation
Dockerfile              Production application image
docker-compose.yml      API, MongoDB replica set, init, and index services
```

## Assumptions and limitations

- Authentication, authorization, multi-currency support, queues, caching, and
  deployment infrastructure are out of scope.
- A MongoDB replica set or sharded cluster is required. Standalone deployments
  are deliberately rejected at operation time with `503`.
- Transaction indexes must be created with `npm run indexes`; index creation is
  not performed automatically on startup.
- There are no correction, update, or delete endpoints. Any future correction
  would require a compensating transaction.
- History pagination is one-based and capped at `limit=100`; empty results report
  `total_pages: 0`.
- A transfer reference is recorded on both ledger entries, so either account
  having used it already causes a `409`.
- Automated tests were run against MongoDB 8.3 on Node.js 20.20.0. No CI
  pipeline is included.
- The Compose stack is for local evaluation: it has no MongoDB authentication,
  TLS, or public MongoDB port. Do not expose it directly to the internet.
