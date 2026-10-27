import { createTransfer } from "../services/transaction.service.js";
import asyncHandler from "../utils/async-handler.js";
import { validateCreateTransferInput } from "../validators/transfer.validator.js";

export const createTransferHandler = asyncHandler(async (req, res) => {
  const input = validateCreateTransferInput(req.body);
  const result = await createTransfer(input);

  res.status(201).json({
    success: true,
    data: result,
  });
});

export default createTransferHandler;
