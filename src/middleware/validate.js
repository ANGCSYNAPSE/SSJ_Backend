import { ApiError } from "../utils/ApiError.js";

/**
 * Parses req.body with a Zod schema. On success the coerced result is exposed
 * as req.validated so handlers never touch unvalidated input.
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "form",
      message: issue.message,
    }));
    return next(ApiError.badRequest("Validation failed.", errors));
  }

  req.validated = result.data;
  return next();
};
