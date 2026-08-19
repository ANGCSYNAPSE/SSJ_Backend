import { AuthService } from "../services/auth.service.js";
import { UserModel } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
  verifyRefreshToken,
} from "../utils/tokens.js";

export const signup = asyncHandler(async (req, res) => {
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

export const login = asyncHandler(async (req, res) => {
  const { remember, ...credentials } = req.validated;
  const { user, accessToken, refreshToken } = await AuthService.login(
    credentials,
  );

  setRefreshCookie(res, refreshToken, { remember });

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

  const { user, accessToken, refreshToken } = await AuthService.refresh(
    payload.sub,
  );

  setRefreshCookie(res, refreshToken);

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

  return sendSuccess(res, { message: "Current user.", data: { user } });
});
