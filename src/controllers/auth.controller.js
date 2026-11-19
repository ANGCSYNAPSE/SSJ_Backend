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
} from "../utils/tokens.js";
import { RefreshTokens } from "../models/refreshToken.model.js";
import { SignupService } from "../services/signup.service.js";

const sessionContext = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

export const signup = asyncHandler(async (req, res) => {
  // The one-step signup skips the email code and the payment; the site uses /auth/signup/start instead.
  if (!env.allowDirectSignup) {
    throw new ApiError(410, "Sign up now needs a verification code and a payment. Please use the website.");
  }
  const { user, accessToken } = await AuthService.signup(req.validated);
  setRefreshCookie(res, await RefreshTokens.issue(user, sessionContext(req)));

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

  // An email with no account may still belong to a signup the person never finished (verified, or even
  // further). Their password proves it is theirs, so send them back to the step they had reached; they
  // get no session and no account until the payment is done.
  if (!(await UserModel.findByEmail(credentials.email))) {
    const resume = await SignupService.resumeFromLogin(credentials);
    if (resume) {
      return sendSuccess(res, {
        message: "Your registration is not finished yet. Let's continue.",
        data: { resume },
      });
    }
  }

  const { user, accessToken } = await AuthService.login(credentials);
  const keep = remember !== false;
  setRefreshCookie(res, await RefreshTokens.issue(user, { remember: keep, ...sessionContext(req) }), { remember: keep });

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

  // The token must be the one the server issued and still holds: a copied, used or ended token is refused.
  const rotated = await RefreshTokens.rotate(token, sessionContext(req));
  if (!rotated || rotated.reused) {
    clearRefreshCookie(res);
    throw ApiError.unauthorized("Session expired. Please sign in again.");
  }

  let result;
  try {
    result = await AuthService.refresh(rotated.userId);
  } catch (err) {
    // The account is gone or blocked: end every session, not just this one.
    await RefreshTokens.revokeAllForUser(rotated.userId);
    clearRefreshCookie(res);
    throw err;
  }

  setRefreshCookie(res, rotated.token, { remember: rotated.remember });

  return sendSuccess(res, {
    message: "Session refreshed.",
    data: { user: result.user, accessToken: result.accessToken },
  });
});

export const logout = asyncHandler(async (req, res) => {
  const token = readRefreshCookie(req);
  if (token) await RefreshTokens.revoke(token);
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
  const { resendAfterSeconds } = await AuthService.requestPasswordReset(req.validated.email);
  return sendSuccess(res, {
    message: "If an account exists for that email, we have sent a 6-digit code.",
    data: { resendAfterSeconds },
  });
});

export const verifyResetCode = asyncHandler(async (req, res) => {
  const data = await AuthService.verifyPasswordResetCode(req.validated);
  return sendSuccess(res, { message: "Code verified. Choose a new password.", data });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.validated;
  await AuthService.resetPassword({ token, password });
  return sendSuccess(res, { message: "Password updated. You can now sign in." });
});
