import { Router } from "express";

import { createAccountHandler } from "../controllers/account.controller.js";

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
 *           Invalid request. Returned for a missing, blank, non-string, or
 *           overlong name, or for unsupported fields such as `balance`, `id`,
 *           `_id`, `created_at`, or `createdAt`.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: 'Unexpected field(s): balance'
 *       500:
 *         description: Unexpected server or database failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
accountRouter.post("/", createAccountHandler);

export default accountRouter;
