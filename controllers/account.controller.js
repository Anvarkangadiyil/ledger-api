import {
  createAccount,
  getAccountBalance,
} from "../services/account.service.js";
import asyncHandler from "../utils/async-handler.js";
import { validateCreateAccountInput } from "../validators/account.validator.js";
import { validateAccountId } from "../validators/object-id.validator.js";

export const createAccountHandler = asyncHandler(async (req, res) => {
  const { name } = validateCreateAccountInput(req.body);
  const account = await createAccount({ name });

  res.status(201).json({
    success: true,
    data: account,
  });
});

export const getAccountBalanceHandler = asyncHandler(async (req, res) => {
  const accountId = validateAccountId(req.params.accountId);
  const balance = await getAccountBalance(accountId);

  res.status(200).json({
    success: true,
    data: balance,
  });
});

export default createAccountHandler;
