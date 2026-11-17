import { AuthService } from "../services/auth.service.js";
import { UserModel } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  verifyRefreshToken,
  signRefreshToken,
} from "../utils/tokens.js";

export const signup = asyncHandler(async (req, res) => {
  // The one-step signup skips the email code and the payment; the site uses /auth/signup/start instead.
  if (!env.allowDirectSignup) {
    throw new ApiError(410, "Sign up now needs a verification code and a payment. Please use the website.");
  }
  const { user, accessToken, refreshToken } = await AuthService.signup(
    req.validated,
  );

  setRefreshCookie(res, refreshToken);

  return sendSuccess(res, {
    status: 201,
    message: "Account created successfully.",
    data: { user, accessToken },
  });
});

export const checkAvailability = asyncHandler(async (req, res) => {
  const result = await AuthService.checkAvailability(req.validated);
  return sendSuccess(res, { message: "Checked.", data: result });
});

export const login = asyncHandler(async (req, res) => {
  const { remember, ...credentials } = req.validated;
  const { user, accessToken } = await AuthService.login(credentials);
  // The service signs a default refresh token; re-sign it so "remember me" is carried inside it.
  const refreshToken = signRefreshToken(user, { remember: remember !== false });

  setRefreshCookie(res, refreshToken, { remember: remember !== false });

  return sendSuccess(res, {
    message: "Signed in successfully.",
    data: { user, accessToken },
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = readRefreshCookie(req);
  if (!token) {
    throw ApiError.unauthorized("Session expired. Please sign in again.");
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    clearRefreshCookie(res);
    throw ApiError.unauthorized("Session expired. Please sign in again.");
  }

  const remember = payload.rem !== false;
  let result;
  try {
    result = await AuthService.refresh(payload.sub, { remember });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
  const { user, accessToken, refreshToken } = result;

  setRefreshCookie(res, refreshToken, { remember });

  return sendSuccess(res, {
    message: "Session refreshed.",
    data: { user, accessToken },
  });
});

export const logout = asyncHandler(async (_req, res) => {
  clearRefreshCookie(res);
  return sendSuccess(res, { message: "Signed out successfully." });
});

export const me = asyncHandler(async (req, res) => {
  const user = await UserModel.findById(req.user.id);
  if (!user) {
    throw ApiError.notFound("Account not found.");
  }

  return sendSuccess(res, {
    message: "Current user.",
    data: { user: await AuthService.withProfiles(user) },
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await AuthService.requestPasswordReset(req.validated.email);
  return sendSuccess(res, {
    message: "If an account exists for that email, a reset link has been sent.",
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.validated;
  await AuthService.resetPassword({ token, password });
  return sendSuccess(res, { message: "Password updated. You can now sign in." });
});
