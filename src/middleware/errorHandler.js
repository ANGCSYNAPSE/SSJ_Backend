import { ApiError } from "../utils/ApiError.js";
import { sendError } from "../utils/apiResponse.js";
import { isProduction } from "../config/env.js";

/** Terminal 404 for any path no router claimed. */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

/* eslint-disable no-unused-vars -- Express identifies error middleware by arity. */
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return sendError(res, {
      status: err.statusCode,
      message: err.message,
      errors: err.errors,
    });
  }

  // Unique violation that slipped past the pre-checks (e.g. a race between
  // two concurrent signups for the same email).
  if (err.code === "23505") {
    return sendError(res, {
      status: 409,
      message: "This account already exists.",
    });
  }

  console.error("Unhandled error:", err);

  return sendError(res, {
    status: 500,
    message: isProduction
      ? "Something went wrong. Please try again."
      : err.message,
  });
}
