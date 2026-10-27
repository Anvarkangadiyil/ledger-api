import { Router } from "express";

import {
  createAccountHandler,
  getAccountBalanceHandler,
} from "../controllers/account.controller.js";

const accountRouter = Router();

/**
 * @openapi
 * /api/v1/accounts:
 *   post:
 *     summary: Create an account
 *     description: >
 *       Creates an account with a server-generated identifier and creation
 *       timestamp. The opening balance is always zero; clients cannot set it.
 *     tags:
 *       - Accounts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             additionalProperties: false
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 120
 *                 description: Account holder name. Leading and trailing whitespace is trimmed.
 *                 example: Ada Lovelace
 *           example:
 *             name: Ada Lovelace
 *     responses:
 *       201:
 *         description: Account created. The opening balance is always zero.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Account'
 *             example:
 *               success: true
 *               data:
 *                 id: 665f1c2a9b1e8a0012a4d3f1
 *                 name: Ada Lovelace
 *                 balance: 0
 *                 created_at: '2026-10-27T10:00:00.000Z'
 *       400:
 *         description: >
 *           Invalid request. Returned for malformed JSON, a missing, blank,
 *           non-string, or overlong name, or for unsupported fields such as
 *           `balance`, `id`, `_id`, `created_at`, or `createdAt`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: 'Unexpected field(s): balance'
 *       413:
 *         description: Request body is too large.
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
accountRouter.post("/", createAccountHandler);

/**
 * @openapi
 * /api/v1/accounts/{accountId}/balance:
 *   get:
 *     summary: Get the current account balance
 *     description: >
 *       Returns the balance persisted for the account. The value is stored and
 *       updated in integer minor units, so it is not recomputed from
 *       transaction history and does not drift through floating-point
 *       arithmetic. Balance changes only happen through transaction
 *       endpoints, never through this read.
 *     tags:
 *       - Accounts
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         description: 24-character hexadecimal account identifier.
 *         schema:
 *           type: string
 *           pattern: '^[a-fA-F0-9]{24}$'
 *           example: 665f1c2a9b1e8a0012a4d3f1
 *     responses:
 *       200:
 *         description: Current account balance.
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
 *                   required: [account_id, balance]
 *                   properties:
 *                     account_id:
 *                       type: string
 *                       description: Public account identifier.
 *                       example: 665f1c2a9b1e8a0012a4d3f1
 *                     balance:
 *                       type: number
 *                       description: >
 *                         Current balance in major currency units with at most
 *                         two decimal places.
 *                       example: 125.5
 *             example:
 *               success: true
 *               data:
 *                 account_id: 665f1c2a9b1e8a0012a4d3f1
 *                 balance: 125.5
 *       400:
 *         description: >
 *           Malformed account ID. The ID must be 24 hexadecimal characters.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: Invalid account ID
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
accountRouter.get("/:accountId/balance", getAccountBalanceHandler);

export default accountRouter;
