import {
  createTransaction,
  getTransactionHistory,
} from "../services/transaction.service.js";
import asyncHandler from "../utils/async-handler.js";
import { validateAccountId } from "../validators/object-id.validator.js";
import {
  validateCreateTransactionInput,
  validateTransactionHistoryQuery,
} from "../validators/transaction.validator.js";

export const createTransactionHandler = asyncHandler(async (req, res) => {
  const accountId = validateAccountId(req.params.accountId);
  const input = validateCreateTransactionInput(req.body);
  const result = await createTransaction({ accountId, ...input });

  res.status(201).json({
    success: true,
    data: result,
  });
});

export const getTransactionHistoryHandler = asyncHandler(async (req, res) => {
  const accountId = validateAccountId(req.params.accountId);
  const { type, page, limit } = validateTransactionHistoryQuery(req.query);
  const history = await getTransactionHistory({
    accountId,
    type,
    page,
    limit,
  });

  res.status(200).json({
    success: true,
    data: history,
  });
});

export default createTransactionHandler;
