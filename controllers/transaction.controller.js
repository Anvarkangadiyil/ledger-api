import { createTransaction } from "../services/transaction.service.js";
import asyncHandler from "../utils/async-handler.js";
import { validateAccountId } from "../validators/object-id.validator.js";
import { validateCreateTransactionInput } from "../validators/transaction.validator.js";

export const createTransactionHandler = asyncHandler(async (req, res) => {
  const accountId = validateAccountId(req.params.accountId);
  const input = validateCreateTransactionInput(req.body);
  const result = await createTransaction({ accountId, ...input });

  res.status(201).json({
    success: true,
    data: result,
  });
});

export default createTransactionHandler;
