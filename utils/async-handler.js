/**
 * Express 4 does not forward rejected promises to the error middleware.
 * Wrap async route handlers so failures reach the existing global handler.
 */
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export default asyncHandler;
