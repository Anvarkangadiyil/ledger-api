import ApiError from "../errors/api-error.js";
import {
  MAX_REFERENCE_ID_LENGTH,
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  TRANSACTION_TYPES,
} from "../models/transaction.model.js";
import { amountToMinorUnits } from "../utils/money.js";

const ALLOWED_CREATE_FIELDS = new Set([
  "type",
  "amount",
  "description",
  "reference_id",
]);

/**
 * Validate and normalize a create-transaction payload.
 *
 * Unknown fields are rejected so clients cannot set the account ID, the
 * transaction ID, the server timestamp, or internal minor-unit amounts.
 */
export const validateCreateTransactionInput = (body) => {
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

  if (typeof body.type !== "string" || !TRANSACTION_TYPES.includes(body.type)) {
    throw new ApiError(400, "type must be either credit or debit");
  }

  let amountMinor;
  try {
    amountMinor = amountToMinorUnits(body.amount);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }

  if (typeof body.description !== "string") {
    throw new ApiError(400, "description is required and must be a string");
  }

  const description = body.description.trim();

  if (description.length === 0) {
    throw new ApiError(400, "description cannot be empty");
  }

  if (description.length > MAX_TRANSACTION_DESCRIPTION_LENGTH) {
    throw new ApiError(
      400,
      `description cannot exceed ${MAX_TRANSACTION_DESCRIPTION_LENGTH} characters`
    );
  }

  if (typeof body.reference_id !== "string") {
    throw new ApiError(
      400,
      "reference_id is required and must be a string"
    );
  }

  const referenceId = body.reference_id.trim();

  if (referenceId.length === 0) {
    throw new ApiError(400, "reference_id cannot be empty");
  }

  if (referenceId.length > MAX_REFERENCE_ID_LENGTH) {
    throw new ApiError(
      400,
      `reference_id cannot exceed ${MAX_REFERENCE_ID_LENGTH} characters`
    );
  }

  return {
    type: body.type,
    amountMinor,
    description,
    referenceId,
  };
};

export default validateCreateTransactionInput;
