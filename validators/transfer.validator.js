import ApiError from "../errors/api-error.js";
import { validateAccountId } from "./object-id.validator.js";
import { validateCreateTransactionInput } from "./transaction.validator.js";

const ALLOWED_CREATE_FIELDS = new Set([
  "source_account_id",
  "destination_account_id",
  "amount",
  "description",
  "reference_id",
]);

/**
 * Validate and normalize a create-transfer payload.
 *
 * The transfer reference is recorded on both ledger entries, so it is unique
 * per account through the existing transaction index. Unknown fields are
 * rejected to prevent mass assignment.
 */
export const validateCreateTransferInput = (body) => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }

  const unexpectedFields = Object.keys(body).filter(
    (field) => !ALLOWED_CREATE_FIELDS.has(field)
  );

  if (unexpectedFields.length > 0) {
    throw new ApiError(
      400,
      `Unexpected field(s): ${unexpectedFields.join(", ")}`
    );
  }

  if (typeof body.source_account_id !== "string") {
    throw new ApiError(
      400,
      "source_account_id is required and must be a string"
    );
  }

  if (typeof body.destination_account_id !== "string") {
    throw new ApiError(
      400,
      "destination_account_id is required and must be a string"
    );
  }

  const sourceAccountId = validateAccountId(body.source_account_id);
  const destinationAccountId = validateAccountId(body.destination_account_id);

  if (sourceAccountId.toLowerCase() === destinationAccountId.toLowerCase()) {
    throw new ApiError(
      400,
      "source_account_id and destination_account_id must be different"
    );
  }

  // Reuse transaction-field validation for amount, description, and reference.
  const { amountMinor, description, referenceId } =
    validateCreateTransactionInput({
      type: "debit",
      amount: body.amount,
      description: body.description,
      reference_id: body.reference_id,
    });

  return {
    sourceAccountId,
    destinationAccountId,
    amountMinor,
    description,
    referenceId,
  };
};

export default validateCreateTransferInput;
