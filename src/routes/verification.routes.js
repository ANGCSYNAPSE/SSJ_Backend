import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { getRegistrationFee } from "../config/plans.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { setVerified } from "../services/verification.service.js";

/** Account verification by an admin. Mounted at /api/v1/admin/verification (admin only). */
export const adminVerificationRouter = Router();

const listQuery = z.object({
  status: z.enum(["all", "verified", "unverified", "ready"]).default("all"),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const oneSchema = z.object({ verified: z.boolean() });
const bulkSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(200), verified: z.boolean() });

const PAID = "(SELECT COALESCE(SUM(p.net_amount_in_rupees), 0) FROM registration_payments p WHERE p.user_id = u.id AND p.status = 'paid')";

/**
 * @openapi
 * /api/v1/admin/verification:
 *   get:
 *     tags: [Verification]
 *     summary: Accounts to verify, with what the admin needs to decide (admin)
 *     description: "Query: status (all|verified|unverified|ready = unverified and the minimum fee is paid), q, page, pageSize. Returns { counts, items[], total }."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: One page of accounts }
 * /api/v1/admin/verification/bulk:
 *   post:
 *     tags: [Verification]
 *     summary: Verify or un-verify several accounts at once (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ changed }" }
 * /api/v1/admin/verification/{userId}:
 *   patch:
 *     tags: [Verification]
 *     summary: Verify or un-verify one account; the person is notified (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: userId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Updated }
 */
adminVerificationRouter.get(
  "/",
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const { status, q, page, pageSize } = req.validatedQuery;
    const { total: feeTotal, minimum } = await getRegistrationFee();

    const base = ["u.deleted_at IS NULL", "u.role <> 'admin'"];
    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (q) {
      const like = add(`%${q.replace(/[%_\\]/g, "\\$&")}%`);
      base.push(`(u.full_name ILIKE ${like} OR u.email ILIKE ${like} OR u.mobile ILIKE ${like})`);
    }
    const baseParams = [...params];
    const where = [...base];
    if (status === "verified") where.push("u.is_verified = TRUE");
    if (status === "unverified") where.push("u.is_verified = FALSE");
    if (status === "ready") where.push(`u.is_verified = FALSE AND u.is_blocked = FALSE AND ${PAID} >= ${add(minimum)}`);

    const [counts] = await sql(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE u.is_verified)::int AS verified,
              COUNT(*) FILTER (WHERE NOT u.is_verified)::int AS unverified
         FROM users u WHERE ${base.join(" AND ")}`,
      baseParams,
    );
    const [{ n: total }] = await sql(`SELECT COUNT(*)::int AS n FROM users u WHERE ${where.join(" AND ")}`, params);

    const rows = await sql(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.location, u.is_verified, u.is_blocked, u.verified_at, u.email_verified_at, u.mobile_verified_at, u.created_at,
              ${PAID} AS paid,
              COALESCE((SELECT json_agg(json_build_object('type', r.type::text, 'status', r.status::text, 'name', r.display_name, 'complete', r.is_complete, 'missing', jsonb_array_length(r.missing_fields)) ORDER BY r.created_at)
                          FROM all_registrations r WHERE r.user_id = u.id), '[]'::json) AS registrations,
              vb.full_name AS verified_by
         FROM users u LEFT JOIN users vb ON vb.id = u.verified_by
        WHERE ${where.join(" AND ")}
        ORDER BY u.is_verified ASC, u.created_at DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    );

    sendSuccess(res, {
      data: {
        counts,
        total,
        page,
        pageSize,
        fee: { total: feeTotal, minimum },
        items: rows.map((row) => ({
          id: row.id,
          fullName: row.full_name,
          email: row.email,
          mobile: row.mobile,
          location: row.location,
          isVerified: row.is_verified,
          isBlocked: row.is_blocked,
          emailVerified: Boolean(row.email_verified_at),
          mobileVerified: Boolean(row.mobile_verified_at),
          verifiedAt: row.verified_at,
          verifiedBy: row.verified_by,
          createdAt: row.created_at,
          paid: Number(row.paid),
          registrations: row.registrations,
        })),
      },
    });
  }),
);

// The bulk route is declared before "/:userId" so "bulk" is never read as an id.
adminVerificationRouter.post(
  "/bulk",
  validate(bulkSchema),
  asyncHandler(async (req, res) => {
    const changed = await setVerified(req.validated.userIds, req.validated.verified, req.user.id);
    sendSuccess(res, {
      message: changed.length === 0 ? "Nothing changed." : `${changed.length} ${changed.length === 1 ? "account" : "accounts"} ${req.validated.verified ? "verified" : "set to unverified"}.`,
      data: { changed: changed.length },
    });
  }),
);

adminVerificationRouter.patch(
  "/:userId",
  validate(oneSchema),
  asyncHandler(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.userId).success) throw ApiError.notFound("Account not found.");
    const [user] = await sql(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND role <> 'admin'`, [req.params.userId]);
    if (!user) throw ApiError.notFound("Account not found.");
    const changed = await setVerified([user.id], req.validated.verified, req.user.id);
    sendSuccess(res, {
      message: changed.length === 0 ? "Already up to date." : req.validated.verified ? "Account verified." : "Account set to unverified.",
      data: { id: user.id, isVerified: req.validated.verified, changed: changed.length > 0 },
    });
  }),
);
