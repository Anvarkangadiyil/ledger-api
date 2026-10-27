import { Router } from "express";

import { createTransferHandler } from "../controllers/transfer.controller.js";

const transferRouter = Router();

/**
 * @openapi
 * /api/v1/transfers:
 *   post:
 *     summary: Transfer money between two accounts
 *     description: >
 *       Debits the source account, credits the destination account, and
 *       inserts both immutable ledger entries in one MongoDB transaction. A
 *       conditional source debit prevents concurrent transfers from
 *       overspending. If any account update or ledger insert fails, every
 *       change rolls back. Source and destination must be different accounts.
 *
 *       The caller-supplied `reference_id` is recorded on both ledger entries.
 *       Because references are unique per account, a retry with the same
 *       reference is rejected with 409 and moves no money, even after a
 *       successful transfer. Use a new reference for a genuinely new transfer.
 *       Both accounts must not have used the reference before.
 *     tags:
 *       - Transfers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - source_account_id
 *               - destination_account_id
 *               - amount
 *               - description
 *               - reference_id
 *             additionalProperties: false
 *             properties:
 *               source_account_id:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{24}$'
 *                 description: Account to debit.
 *                 example: 665f1c2a9b1e8a0012a4d3f1
 *               destination_account_id:
 *                 type: string
 *                 pattern: '^[a-fA-F0-9]{24}$'
 *                 description: Account to credit. Must differ from the source.
 *                 example: 666f1c2a9b1e8a0012a4d3f2
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 description: >
 *                   Positive amount in major currency units with at most two
 *                   decimal places.
 *                 example: 25
 *               description:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 500
 *                 description: Human-readable description; whitespace is trimmed.
 *                 example: Rent share
 *               reference_id:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *                 description: >
 *                   Transfer reference unique per account. It is recorded on
 *                   both ledger entries and is not globally unique.
 *                 example: TRF-2026-001
 *           example:
 *             source_account_id: 665f1c2a9b1e8a0012a4d3f1
 *             destination_account_id: 666f1c2a9b1e8a0012a4d3f2
 *             amount: 25
 *             description: Rent share
 *             reference_id: TRF-2026-001
 *     responses:
 *       201:
 *         description: Transfer committed and both account balances updated.
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
 *                   required:
 *                     - transfer
 *                     - source_balance
 *                     - destination_balance
 *                     - transactions
 *                   properties:
 *                     transfer:
 *                       $ref: '#/components/schemas/Transfer'
 *                     source_balance:
 *                       type: number
 *                       description: Source balance after the transfer.
 *                       example: 75
 *                     destination_balance:
 *                       type: number
 *                       description: Destination balance after the transfer.
 *                       example: 25
 *                     transactions:
 *                       type: array
 *                       description: >
 *                         The source debit followed by the destination credit.
 *                       minItems: 2
 *                       maxItems: 2
 *                       items:
 *                         $ref: '#/components/schemas/Transaction'
 *             example:
 *               success: true
 *               data:
 *                 transfer:
 *                   reference_id: TRF-2026-001
 *                   amount: 25
 *                   description: Rent share
 *                   source_account_id: 665f1c2a9b1e8a0012a4d3f1
 *                   destination_account_id: 666f1c2a9b1e8a0012a4d3f2
 *                   created_at: '2026-10-27T10:10:00.000Z'
 *                 source_balance: 75
 *                 destination_balance: 25
 *                 transactions:
 *                   - id: 667f1c2a9b1e8a0012a4d3f3
 *                     account_id: 665f1c2a9b1e8a0012a4d3f1
 *                     type: debit
 *                     amount: 25
 *                     description: Rent share
 *                     reference_id: TRF-2026-001
 *                     created_at: '2026-10-27T10:10:00.000Z'
 *                   - id: 667f1c2a9b1e8a0012a4d3f4
 *                     account_id: 666f1c2a9b1e8a0012a4d3f2
 *                     type: credit
 *                     amount: 25
 *                     description: Rent share
 *                     reference_id: TRF-2026-001
 *                     created_at: '2026-10-27T10:10:00.000Z'
 *       400:
 *         description: >
 *           Invalid transfer. Returned for malformed JSON, missing or
 *           malformed account IDs, identical source and destination accounts,
 *           non-positive or over-precise amounts, blank description or
 *           reference ID, or unexpected fields.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               sameAccount:
 *                 summary: Source equals destination
 *                 value:
 *                   success: false
 *                   error: source_account_id and destination_account_id must be different
 *               malformedId:
 *                 summary: Malformed account ID
 *                 value:
 *                   success: false
 *                   error: Invalid account ID
 *       404:
 *         description: >
 *           The source or destination ID is well-formed but no matching
 *           account exists. No balance or ledger change is committed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               sourceMissing:
 *                 value:
 *                   success: false
 *                   error: Source account not found
 *               destinationMissing:
 *                 value:
 *                   success: false
 *                   error: Destination account not found
 *       409:
 *         description: >
 *           The transfer was rejected without moving money. Returned for
 *           insufficient source funds or when the reference already exists on
 *           either account.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               insufficientFunds:
 *                 value:
 *                   success: false
 *                   error: Insufficient funds
 *               duplicateReference:
 *                 value:
 *                   success: false
 *                   error: A transaction with this reference_id already exists for the source or destination account
 *       413:
 *         description: Request body is too large.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       503:
 *         description: >
 *           MongoDB is not running with transaction support (a replica set or
 *           sharded cluster is required). No partial transfer is written.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Unexpected server or database failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
transferRouter.post("/", createTransferHandler);

export default transferRouter;
