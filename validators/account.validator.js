import ApiError from "../errors/api-error.js";
import { MAX_ACCOUNT_NAME_LENGTH } from "../models/account.model.js";

const ALLOWED_CREATE_FIELDS = new Set(["name"]);

/**
 * Validate and normalize a create-account payload.
 *
 * Unknown fields are rejected rather than ignored. This explicitly blocks
 * attempts to set `balance`, IDs, or timestamps through the request body.
 */
export const validateCreateAccountInput = (body) => {
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

  if (typeof body.name !== "string") {
    throw new ApiError(400, "Account name is required and must be a string");
  }

  const name = body.name.trim();

  if (name.length === 0) {
    throw new ApiError(400, "Account name cannot be empty");
  }

  if (name.length > MAX_ACCOUNT_NAME_LENGTH) {
    throw new ApiError(
      400,
      `Account name cannot exceed ${MAX_ACCOUNT_NAME_LENGTH} characters`
    );
  }

  return { name };
};

export default validateCreateAccountInput;
