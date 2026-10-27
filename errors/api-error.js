/**
 * Error type for expected API failures (validation, missing resources, conflicts).
 * The existing global error middleware reads `statusCode` and renders the
 * established `{ success: false, error }` envelope.
 */
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    Error.captureStackTrace?.(this, ApiError);
  }
}

export default ApiError;
