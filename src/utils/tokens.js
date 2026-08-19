import jwt from "jsonwebtoken";
import { env, isProduction } from "../config/env.js";

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

const REFRESH_COOKIE = "ssj_refresh";

/**
 * The refresh token is httpOnly so page scripts can never read it; the short
 * lived access token is the only thing handed to the client.
 */
export function setRefreshCookie(res, token, { remember = true } = {}) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/api/v1/auth",
    maxAge: remember ? 7 * 24 * 60 * 60 * 1000 : undefined,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
}

export function readRefreshCookie(req) {
  return req.cookies?.[REFRESH_COOKIE] ?? null;
}
