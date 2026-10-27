import { Router } from "express";

import {
  createTransactionHandler,
  getTransactionHistoryHandler,
} from "../controllers/transaction.controller.js";

const transactionRouter = Router();

/**
 * @openapi
 * /api/v1/accounts/{accountId}/transactions:
 *   post:
 *     summary: Create a credit or debit transaction
 *     description: >
 *       Creates an immutable ledger entry and updates the account balance in a
 *       single MongoDB transaction. A credit increases the balance; a debit
 *       decreases it only when sufficient funds exist. The transaction insert
 *       and balance update commit or roll back together. The same
 *       `reference_id` is allowed on different accounts but not twice within
 *       one account.
 *     tags:
 *       - Transactions
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         description: 24-character hexadecimal account identifier.
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *           example: 665f1c2a9b1e8a0012a4d3f1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - amount
 *               - description
 *               - reference_id
 *             additionalProperties: false
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [credit, debit]
 *                 description: Credit increases the balance; debit decreases it.
 *                 example: credit
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 description: >
 *                   Positive amount in major currency units. At most two
 *                   decimal places are accepted.
 *                 example: 125.50
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 500
 *                 description: Human-readable description; surrounding whitespace is trimmed.
 *                 example: Invoice payment
 *               reference_id:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *                 description: >
 *                   Idempotency reference unique within the account. Surrounding
 *                   whitespace is trimmed.
 *                 example: INV-2026-001
 *           examples:
 *             credit:
 *               summary: Credit transaction
 *               value:
 *                 type: credit
 *                 amount: 125.50
 *                 description: Invoice payment
 *                 reference_id: INV-2026-001
 *             debit:
 *               summary: Debit transaction
 *               value:
 *                 type: debit
 *                 amount: 25.00
 *                 description: Bank withdrawal
 *                 reference_id: WDR-2026-001
 *     responses:
 *       201:
 *         description: Transaction committed and account balance updated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   required: [transaction, balance]
 *                   properties:
 *                     transaction:
 *                       $ref: '#/components/schemas/Transaction'
 *                     balance:
 *                       type: number
 *                       description: Account balance after this transaction.
 *                       example: 125.5
 *             example:
 *               success: true
 *               data:
 *                 transaction:
 *                   id: 666f1c2a9b1e8a0012a4d3f2
 *                   account_id: 665f1c2a9b1e8a0012a4d3f1
 *                   type: credit
 *                   amount: 125.5
 *                   description: Invoice payment
 *                   reference_id: INV-2026-001
 *                   created_at: '2026-10-27T10:05:00.000Z'
 *                 balance: 125.5
 *       400:
 *         description: >
 *           Invalid account ID or request body. Returned for a malformed ID,
 *           unsupported type, non-positive or over-precise amount, blank
 *           description/reference ID, or unexpected fields such as
 *           `account_id`, `id`, `_id`, `created_at`, or internal amount fields.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               malformedId:
 *                 summary: Malformed account ID
 *                 value:
 *                   success: false
 *                   error: Invalid account ID
 *               invalidAmount:
 *                 summary: Invalid amount
 *                 value:
 *                   success: false
 *                   error: Amount must be a positive number
 *       404:
 *         description: The account ID is well-formed but no account exists.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: Account not found
 *       409:
 *         description: >
 *           The transaction was rejected without changing the balance. Returned
 *           for insufficient funds or a duplicate `reference_id` within the
 *           same account.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               insufficientFunds:
 *                 summary: Debit exceeds the available balance
 *                 value:
 *                   success: false
 *                   error: Insufficient funds
 *               duplicateReference:
 *                 summary: Reference already used by this account
 *                 value:
 *                   success: false
 *                   error: A transaction with this reference_id already exists for this account
 *       503:
 *         description: >
 *           MongoDB is not running with transaction support (a replica set or
 *           sharded cluster is required).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: Transaction processing is unavailable because MongoDB does not support transactions
 *       500:
 *         description: Unexpected server or database failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
transactionRouter.post("/:accountId/transactions", createTransactionHandler);

/**
 * @openapi
 * /api/v1/accounts/{accountId}/transactions:
 *   get:
 *     summary: List an account's transaction history
 *     description: >
 *       Returns the account's immutable ledger entries, newest first by
 *       `created_at` with `_id` descending as a deterministic tie-breaker.
 *       Filtering and pagination run in MongoDB. An empty result set returns
 *       an empty `transactions` array, `total` 0, and `total_pages` 0, while
 *       `page` echoes the requested page.
 *     tags:
 *       - Transactions
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         description: 24-character hexadecimal account identifier.
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *           example: 665f1c2a9b1e8a0012a4d3f1
 *       - in: query
 *         name: type
 *         required: false
 *         description: Restrict results to credits or debits. Omit to return both.
 *         schema:
 *           type: string
 *           enum: [credit, debit]
 *         example: credit
 *       - in: query
 *         name: page
 *         required: false
 *         description: One-based page number.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         example: 1
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Number of records per page.
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         example: 20
 *     responses:
 *       200:
 *         description: A page of matching transactions and pagination metadata.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   required: [transactions, pagination]
 *                   properties:
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       type: object
 *                       required: [page, limit, total, total_pages]
 *                       description: >
 *                         Pagination metadata for the filtered result set.
 *                       properties:
 *                         page:
 *                           type: integer
 *                           description: Current page number.
 *                           example: 1
 *                         limit:
 *                           type: integer
 *                           description: Page size used for this response.
 *                           example: 20
 *                         total:
 *                           type: integer
 *                           description: Total number of matching transactions.
 *                           example: 2
 *                         total_pages:
 *                           type: integer
 *                           description: >
 *                             Total number of pages. Zero when no transactions
 *                             match the filter.
 *                           example: 1
 *             example:
 *               success: true
 *               data:
 *                 transactions:
 *                   - id: 666f1c2a9b1e8a0012a4d3f2
 *                     account_id: 665f1c2a9b1e8a0012a4d3f1
 *                     type: credit
 *                     amount: 125.5
 *                     description: Invoice payment
 *                     reference_id: INV-2026-001
 *                     created_at: '2026-10-27T10:05:00.000Z'
 *                   - id: 666f1c2a9b1e8a0012a4d3f1
 *                     account_id: 665f1c2a9b1e8a0012a4d3f1
 *                     type: debit
 *                     amount: 25
 *                     description: Bank withdrawal
 *                     reference_id: WDR-2026-001
 *                     created_at: '2026-10-27T10:00:00.000Z'
 *                 pagination:
 *                   page: 1
 *                   limit: 20
 *                   total: 2
 *                   total_pages: 1
 *       400:
 *         description: >
 *           Malformed account ID or query parameters. `type` must be `credit`
 *           or `debit`; `page` and `limit` must be positive integers and
 *           `limit` cannot exceed 100.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               malformedId:
 *                 summary: Malformed account ID
 *                 value:
 *                   success: false
 *                   error: Invalid account ID
 *               invalidType:
 *                 summary: Unsupported type filter
 *                 value:
 *                   success: false
 *                   error: type must be either credit or debit
 *               invalidLimit:
 *                 summary: Limit above the documented maximum
 *                 value:
 *                   success: false
 *                   error: limit cannot exceed 100
 *       404:
 *         description: The account ID is well-formed but no account exists.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: Account not found
 *       500:
 *         description: Unexpected server or database failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
transactionRouter.get("/:accountId/transactions", getTransactionHistoryHandler);

export default transactionRouter;
