import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import { NotificationModel } from "../models/notification.model.js";
import { findProfileByUser, listProfilesForUser } from "../models/profile.model.js";
import { feeStatusFor } from "./payments.routes.js";
import { REGISTRATION_PLANS } from "../config/plans.js";
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
      { key: "isVerified", filled: Boolean(user.isVerified) },
    ];
    const required = profiles.reduce((sum, p) => sum + p.requiredCount, 0) + accountChecks.length;
    const missing = profiles.reduce((sum, p) => sum + p.missing.length, 0) + accountChecks.filter((c) => !c.filled).length;

    const registrationFee = await feeStatusFor(user.id);
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
        registrationFee: { ...registrationFee, plans: REGISTRATION_PLANS },
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
