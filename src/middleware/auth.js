import { ApiError } from "../utils/ApiError.js";
import { verifyAccessToken } from "../utils/tokens.js";

/** Requires a valid Bearer access token; attaches { id, role } to req.user. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(ApiError.unauthorized("Authentication required."));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch {
    return next(ApiError.unauthorized("Session expired. Please sign in again."));
  }
}

/**
 * Attaches { id, role } to req.user when a valid Bearer token is present,
 * but never rejects the request — used on routes that serve a public subset
 * to anonymous callers and the full set to admins (see buildCrudRouter's
 * `publicRead`). Without this, req.user is never set on those routes, so an
 * admin's token is silently ignored and everyone gets the public view.
 */
export function attachUserIfPresent(req, _res, next) {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme === "Bearer" && token) {
    try {
      const payload = verifyAccessToken(token);
      req.user = { id: payload.sub, role: payload.role };
    } catch {
      // Invalid/expired token on an optional-auth route: fall through as anonymous.
    }
  }

  return next();
}

/** Gates a route to specific roles. Must run after requireAuth. */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden());
    }
    return next();
  };

/** Spread onto a route (`...requireAdmin`) to require an authenticated admin. */
export const requireAdmin = [requireAuth, requireRole("admin")];
