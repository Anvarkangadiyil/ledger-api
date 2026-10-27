import ApiError from "../errors/api-error.js";

/**
 * Keep unknown routes on the same JSON error envelope as the rest of the API
 * instead of falling through to Express's default HTML 404 response.
 */
const notFoundMiddleware = (req, res, next) => {
  next(new ApiError(404, "Route not found"));
};

export default notFoundMiddleware;
