import jwt from "jsonwebtoken";
import { env, isProduction } from "../config/env.js";

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  });
}

/** `remember: false` marks a "don't keep me signed in" session; the flag survives every refresh. */
export function signRefreshToken(user, { remember = true } = {}) {
  return jwt.sign({ sub: user.id, rem: remember }, env.jwt.refreshSecret, {
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

/** Reads a TTL like "7d", "12h", "30m" or plain seconds into milliseconds. */
function ttlToMs(ttl) {
  const match = /^(d+)s*([smhd]?)$/.exec(String(ttl).trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const unit = { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return Number(match[1]) * unit * 1000;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/api/v1/auth",
});

/**
 * The refresh token is httpOnly so page scripts can never read it; the short
 * lived access token is the only thing handed to the client.
 */
export function setRefreshCookie(res, token, { remember = true } = {}) {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    // Same lifetime as the refresh token itself; a session cookie (gone when the browser closes) when not remembered.
    maxAge: remember ? ttlToMs(env.jwt.refreshTtl) : undefined,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

export function readRefreshCookie(req) {
  return req.cookies?.[REFRESH_COOKIE] ?? null;
}
