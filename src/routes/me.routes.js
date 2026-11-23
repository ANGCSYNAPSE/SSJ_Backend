import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { RefreshTokens } from "../models/refreshToken.model.js";
import { sendSecurityNoticeEmail } from "../services/mail.service.js";
import { emailField, mobileField, passwordField } from "../validators/auth.validator.js";
import { setRefreshCookie } from "../utils/tokens.js";
import { UserModel } from "../models/user.model.js";
import { NotificationModel } from "../models/notification.model.js";
import { findProfileByUser, listProfilesForUser } from "../models/profile.model.js";
import { feeStatusFor } from "./payments.routes.js";
import { VolunteerModel, toVolunteer } from "../models/volunteer.model.js";
import { REQUIRED_FIELDS } from "../validators/profiles.validator.js";

/** The signed-in user's own account page. Mounted at /api/v1/me. */
export const meRouter = Router();

const updateAccountSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    location: z.string().trim().max(120).nullable().optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  })
  .strict();

/** Share of the required details that are filled in, 0-100. */
const percent = (total, missing) => (total === 0 ? 100 : Math.round(((total - missing) / total) * 100));

/**
 * @openapi
 * /api/v1/me/dashboard:
 *   get:
 *     tags: [Me]
 *     summary: Everything for the signed-in user's dashboard in one call
 *     description: >
 *       The account, how complete it is, every category profile with its full details and the
 *       list of required details still missing, unread messages from the team, and the user's
 *       paid donations (matched by the account email).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ account, completion, profiles[], notifications, donations }" }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 * /api/v1/me:
 *   patch:
 *     tags: [Me]
 *     summary: Edit your own name, location or photo
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string }
 *               location: { type: string, nullable: true }
 *               avatarUrl: { type: string, format: uri, nullable: true }
 *     responses:
 *       200: { description: Updated account }
 */
meRouter.get(
  "/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");

    const summaries = await listProfilesForUser(user.id);
    const profiles = await Promise.all(
      summaries.map(async ({ category, status, isComplete, missing }) => {
        const data = await findProfileByUser(category, user.id);
        const required = REQUIRED_FIELDS[category] ?? [];
        const missingList = missing ?? [];
        return {
          category,
          status,
          isComplete,
          missing: missingList,
          requiredCount: required.length,
          completion: percent(required.length, missingList.length),
          data,
        };
      }),
    );

    // The account itself: name, email, mobile are always there; these are the optional extras.
    const accountChecks = [
      { key: "location", filled: Boolean(user.location) },
      { key: "avatarUrl", filled: Boolean(user.avatarUrl) },
    ];
    const required = profiles.reduce((sum, p) => sum + p.requiredCount, 0) + accountChecks.length;
    const missing = profiles.reduce((sum, p) => sum + p.missing.length, 0) + accountChecks.filter((c) => !c.filled).length;

    const registrationFee = await feeStatusFor(user.id);
    const volunteer = toVolunteer(await VolunteerModel.findByUser(user.id));
    const [unread, donations] = await Promise.all([
      NotificationModel.listUnread(user.id, 5),
      sql(
        `SELECT id, amount_in_rupees, cause, created_at FROM donations
         WHERE status = 'paid' AND lower(email) = lower($1) ORDER BY created_at DESC LIMIT 5`,
        [user.email],
      ),
    ]);
    const [totals] = await sql(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_in_rupees), 0)::float AS total FROM donations
       WHERE status = 'paid' AND lower(email) = lower($1)`,
      [user.email],
    );

    sendSuccess(res, {
      data: {
        account: user,
        completion: {
          percent: percent(required, missing),
          missingAccount: accountChecks.filter((c) => !c.filled).map((c) => c.key),
        },
        profiles,
        volunteer: volunteer ?? undefined,
        registrationFee,
        notifications: { unread: unread.length, recent: unread },
        donations: {
          count: totals?.count ?? 0,
          total: totals?.total ?? 0,
          recent: donations.map((d) => ({
            id: d.id,
            amount: Number(d.amount_in_rupees),
            cause: d.cause,
            createdAt: d.created_at,
          })),
        },
      },
    });
  }),
);

meRouter.patch(
  "/",
  requireAuth,
  validate(updateAccountSchema),
  asyncHandler(async (req, res) => {
    const updated = await UserModel.update(req.user.id, req.validated);
    sendSuccess(res, { message: "Account updated.", data: updated });
  }),
);

/* ───────── Changing the sign-in details (needs the current password) ───────── */

const accountSchema = z
  .object({
    fullName: z.string().trim().min(2, "Please enter the full name.").max(120).optional(),
    mobile: mobileField.optional(),
    email: emailField.optional(),
    currentPassword: z.string().min(1).optional(),
  })
  .strict();

const passwordChangeSchema = z
  .object({
    currentPassword: z.string({ required_error: "Enter your current password." }).min(1, "Enter your current password."),
    newPassword: passwordField,
    confirmPassword: z.string({ required_error: "Please confirm the new password." }),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "The new passwords do not match." });

/** The signed-in person's password must match before anything sensitive changes. */
async function requireCurrentPassword(userId, email, currentPassword) {
  const record = await UserModel.findByEmailWithPassword(email);
  const ok = Boolean(currentPassword) && record && record.id === userId && (await bcrypt.compare(currentPassword, record.passwordHash));
  if (!ok) {
    throw ApiError.badRequest("Your current password is not right.", [{ field: "currentPassword", message: "Your current password is not right." }]);
  }
  return record;
}

/**
 * @openapi
 * /api/v1/me/account:
 *   patch:
 *     tags: [Me]
 *     summary: Change your name, mobile number or sign-in email
 *     description: "Any signed-in user can change their name. Changing the email or mobile number is for administrators only (members would need a verification step) and needs the current password. A notice goes to the old email."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The updated account }
 *       400: { description: Wrong current password or invalid values }
 *       403: { description: Not allowed for this account type }
 *       409: { description: Email or mobile already in use }
 * /api/v1/me/password:
 *   post:
 *     tags: [Me]
 *     summary: Change your password
 *     description: "Needs the current password. Every other signed-in session of the account is ended; this device stays signed in."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Wrong current password or weak new password }
 */
meRouter.patch(
  "/account",
  requireAuth,
  authLimiter,
  validate(accountSchema),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");
    const { fullName, mobile, email, currentPassword } = req.validated;

    const changesEmail = email !== undefined && email !== user.email;
    const changesMobile = mobile !== undefined && mobile !== user.mobile;

    if ((changesEmail || changesMobile) && user.role !== "admin") {
      throw ApiError.forbidden("Changing the email or mobile number needs a verification step that is not available yet.");
    }
    if (changesEmail || changesMobile) await requireCurrentPassword(user.id, user.email, currentPassword);

    const conflicts = [];
    if (changesEmail) {
      const taken = await UserModel.findByEmail(email);
      if (taken && taken.id !== user.id) conflicts.push({ field: "email", message: "Another account already uses this email." });
    }
    if (changesMobile) {
      const taken = await UserModel.findByMobile(mobile);
      if (taken && taken.id !== user.id) conflicts.push({ field: "mobile", message: "Another account already uses this mobile number." });
    }
    if (conflicts.length > 0) throw ApiError.conflict("That is already in use.", conflicts);

    const patch = {};
    if (fullName !== undefined) patch.fullName = fullName;
    if (changesEmail) patch.email = email;
    if (changesMobile) patch.mobile = mobile;

    let updated;
    try {
      updated = await UserModel.update(user.id, patch);
    } catch (error) {
      if (error?.code === "23505") throw ApiError.conflict("That is already in use.");
      throw error;
    }

    // The old address is told, so a change made by someone else does not go unnoticed.
    if (changesEmail) {
      sendSecurityNoticeEmail({ to: user.email, fullName: user.fullName, what: "sign-in email", detail: `now ${email}` }).catch((error) =>
        console.error("[mail] security notice failed:", error.message),
      );
    }
    sendSuccess(res, { message: "Account updated.", data: updated });
  }),
);

meRouter.post(
  "/password",
  requireAuth,
  authLimiter,
  validate(passwordChangeSchema),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");
    const { currentPassword, newPassword } = req.validated;

    const record = await requireCurrentPassword(user.id, user.email, currentPassword);
    if (await bcrypt.compare(newPassword, record.passwordHash)) {
      throw ApiError.badRequest("Choose a password you have not used for this account.", [
        { field: "newPassword", message: "The new password must be different from the current one." },
      ]);
    }

    await UserModel.setPassword(user.id, await bcrypt.hash(newPassword, env.bcryptRounds));
    // Every session signed in with the old password ends; this device gets a fresh one so the person stays in.
    await RefreshTokens.revokeAllForUser(user.id);
    setRefreshCookie(res, await RefreshTokens.issue(user, { remember: true, ip: req.ip, userAgent: req.headers["user-agent"] }));

    sendSecurityNoticeEmail({ to: user.email, fullName: user.fullName, what: "password" }).catch((error) =>
      console.error("[mail] security notice failed:", error.message),
    );
    sendSuccess(res, { message: "Password changed." });
  }),
);
