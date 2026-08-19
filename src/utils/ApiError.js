/**
 * Error type the error handler knows how to render. Anything thrown that is
 * NOT an ApiError is treated as an unexpected fault and reported as a 500.
 */
export class ApiError extends Error {
  constructor(statusCode, message, errors = null) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, errors = null) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = "Invalid email or password.") {
    return new ApiError(401, message);
  }

  static forbidden(message = "You do not have access to this resource.") {
    return new ApiError(403, message);
  }

  static notFound(message = "Resource not found.") {
    return new ApiError(404, message);
  }

  static conflict(message, errors = null) {
    return new ApiError(409, message, errors);
  }

  static tooManyRequests(message = "Too many requests. Please try again later.") {
    return new ApiError(429, message);
  }

  static internal(message = "Something went wrong. Please try again.") {
    return new ApiError(500, message);
  }
}
