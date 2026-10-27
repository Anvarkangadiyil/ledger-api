import ApiError from "../errors/api-error.js";

const GENERIC_SERVER_ERROR = "Internal Server Error";
const DUPLICATE_KEY_MESSAGE = "A record with this unique value already exists";

const getDuplicateKeyMessage = (err) => {
  if (!err.keyValue) {
    return DUPLICATE_KEY_MESSAGE;
  }

  // Expose the conflicting field names, not the index name or document.
  return `${Object.keys(err.keyValue).join(", ")} already exists`;
};

/**
 * Translate known error types into the API's expected error contract.
 * Raw driver, parser, and runtime errors are never returned to clients.
 */
const toApiError = (err) => {
  if (err instanceof ApiError) {
    return err;
  }

  // body-parser errors carry a raw parser message that may include part of
  // the request body, so replace them with a stable public message.
  if (err.type === "entity.parse.failed") {
    return new ApiError(400, "Request body contains invalid JSON");
  }

  if (err.type === "entity.too.large") {
    return new ApiError(413, "Request body is too large");
  }

  // Mongoose bad ObjectId (CastError)
  if (err.name === "CastError") {
    return new ApiError(404, "Resource not found");
  }

  // MongoDB duplicate key. Transaction creation maps this earlier with a
  // reference-specific message; this is the shared fallback.
  if (err.code === 11000) {
    return new ApiError(409, getDuplicateKeyMessage(err));
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((validationError) => validationError.message)
      .join(", ");
    return new ApiError(400, message);
  }

  if (
    typeof err.statusCode === "number" &&
    err.statusCode >= 400 &&
    err.statusCode < 600
  ) {
    return new ApiError(err.statusCode, err.message);
  }

  return null;
};

const errorMiddleware = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const apiError = toApiError(err);
  const statusCode = apiError?.statusCode ?? 500;
  const isProduction = process.env.NODE_ENV === "production";
  const message =
    apiError?.message ||
    (isProduction ? GENERIC_SERVER_ERROR : err.message || GENERIC_SERVER_ERROR);

  // Diagnostic logs exclude request bodies and redact URI credentials.
  if (process.env.NODE_ENV !== "test") {
    const redactSensitive = (value) =>
      String(value).replace(
        /(mongodb(?:\+srv)?:\/\/)[^@\s]+@/gi,
        "$1[redacted]@"
      );
    const requestPath = (req.originalUrl || "").split("?")[0];
    const log = statusCode >= 500 ? console.error : console.warn;

    log(
      `[${req.method} ${requestPath}] ${statusCode}: ${redactSensitive(message)}`
    );

    if (statusCode >= 500 && err.stack) {
      console.error(redactSensitive(err.stack));
    }
  }

  return res.status(statusCode).json({
    success: false,
    error: message,
  });
};

export default errorMiddleware;
