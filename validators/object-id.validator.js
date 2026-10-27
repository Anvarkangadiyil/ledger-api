import ApiError from "../errors/api-error.js";

const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

/**
 * Public identifiers are 24-character hexadecimal MongoDB ObjectIds.
 * Rejecting other strings here lets the API return 400 without attempting a
 * database cast; a well-formed but unknown ID is handled as a 404 later.
 */
export const validateAccountId = (accountId) => {
  if (typeof accountId !== "string" || !OBJECT_ID_PATTERN.test(accountId)) {
    throw new ApiError(400, "Invalid account ID");
  }

  return accountId;
};

export default validateAccountId;
