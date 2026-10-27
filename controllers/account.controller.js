import { createAccount } from "../services/account.service.js";
import asyncHandler from "../utils/async-handler.js";
import { validateCreateAccountInput } from "../validators/account.validator.js";

export const createAccountHandler = asyncHandler(async (req, res) => {
  const { name } = validateCreateAccountInput(req.body);
  const account = await createAccount({ name });

  res.status(201).json({
    success: true,
    data: account,
  });
});

export default createAccountHandler;
