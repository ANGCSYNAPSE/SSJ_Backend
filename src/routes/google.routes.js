import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { validate } from "../middleware/validate.js";
import { signupFlowLimiter } from "../middleware/rateLimiter.js";
import { UserModel } from "../models/user.model.js";
import { RefreshTokens } from "../models/refreshToken.model.js";
import { AuthService } from "../services/auth.service.js";
import { SignupService } from "../services/signup.service.js";
import { verifyGoogleCredential } from "../services/google.service.js";
import { signAccessToken, setRefreshCookie } from "../utils/tokens.js";

/** Sign in / sign up with Google. Mounted at /api/v1/auth/google. */
export const googleRouter = Router();

const credential = z.string({ required_error: "Missing Google sign-in." }).min(20).max(4096);
const signInSchema = z.object({ credential, remember: z.boolean().optional() });
const startSchema = z.object({
  credential,
  mobile: z
    .string({ required_error: "Mobile number is required." })
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Please accept the Terms of Service to continue." }) }),
});

const sessionContext = (req) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });

/**
 * @openapi
 * /api/v1/auth/google:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in with a Google ID token
 *     description: "Body: { credential, remember? }. Returns { user, accessToken } for an existing account (linked by verified email), { resume } when the email has an unfinished registration, or { newAccount: { fullName, email } } when there is nothing yet (the person then adds a mobile number at /auth/google/start). Admin accounts cannot use Google."
 *     responses:
 *       200: { description: Signed in, resume, or newAccount }
 *       401: { description: The Google token could not be verified }
 *       403: { description: Suspended account, or an admin account }
 *       503: { description: Google sign-in is not configured }
 * /api/v1/auth/google/start:
 *   post:
 *     tags: [Auth]
 *     summary: Begin a registration with Google (no password, no emailed code)
 *     description: "Body: { credential, mobile, acceptTerms }. Google has already proved the email, so the registration starts at its details step. The account is still only created after the minimum fee is paid."
 *     responses:
 *       200: { description: The registration state, like /auth/signup/resume }
 *       409: { description: The email or mobile already has an account }
 */
googleRouter.post(
  "/",
  signupFlowLimiter,
  validate(signInSchema),
  asyncHandler(async (req, res) => {
    const { credential: token, remember } = req.validated;
    const profile = await verifyGoogleCredential(token);

    const [bySub] = await sql(`SELECT id FROM users WHERE google_sub = $1 AND deleted_at IS NULL`, [profile.sub]);
    const found = bySub ? await UserModel.findById(bySub.id) : await UserModel.findByEmail(profile.email);

    if (found) {
      if (found.role === "admin") throw ApiError.forbidden("This email belongs to an administrator account, and for security administrators cannot use Google. Please sign in with your email and password, or use a different Google account.");
      if (found.isBlocked) throw ApiError.forbidden("This account has been suspended. Please contact support.");

      const [{ google_sub: linked }] = await sql(`SELECT google_sub FROM users WHERE id = $1`, [found.id]);
      if (linked && linked !== profile.sub) {
        throw ApiError.forbidden("This account is linked to a different Google account. Please sign in with your email and password.");
      }
      // The first Google sign-in links the account. Google has verified the email, so that counts as the email proof too.
      await sql(`UPDATE users SET google_sub = COALESCE(google_sub, $2), email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, [found.id, profile.sub]);
      await UserModel.touchLastLogin(found.id);

      const user = await UserModel.findById(found.id);
      const keep = remember !== false;
      setRefreshCookie(res, await RefreshTokens.issue(user, { remember: keep, ...sessionContext(req) }), { remember: keep });
      return sendSuccess(res, {
        message: "Signed in with Google.",
        data: { user: await AuthService.withProfiles(user), accessToken: signAccessToken(user) },
      });
    }

    // No account. An unfinished registration with this email carries on (Google proves the email is theirs).
    const resume = await SignupService.resumeFromGoogle(profile);
    if (resume) {
      return sendSuccess(res, { message: "Your registration is not finished yet. Let's continue.", data: { resume } });
    }

    sendSuccess(res, {
      message: "Almost there. Add your mobile number to continue.",
      data: { newAccount: { fullName: profile.name || profile.email.split("@")[0], email: profile.email } },
    });
  }),
);

googleRouter.post(
  "/start",
  signupFlowLimiter,
  validate(startSchema),
  asyncHandler(async (req, res) => {
    const profile = await verifyGoogleCredential(req.validated.credential);
    sendSuccess(res, {
      message: "Your email is verified with Google. Let's continue.",
      data: await SignupService.startWithGoogle({ profile, mobile: req.validated.mobile }),
    });
  }),
);
