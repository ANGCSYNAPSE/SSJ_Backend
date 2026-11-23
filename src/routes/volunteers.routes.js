import { Router } from "express";
import { sql } from "../config/database.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { NotificationModel } from "../models/notification.model.js";
import { VolunteerModel, toVolunteer } from "../models/volunteer.model.js";
import { volunteerListQuerySchema, volunteerReviewSchema, volunteerSelfUpdateSchema } from "../validators/volunteer.validator.js";

/**
 * @openapi
 * /api/v1/me/volunteer:
 *   get:
 *     tags: [Volunteers]
 *     summary: The signed-in person's volunteer details (404 if they are not a volunteer)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Volunteer details }
 *   patch:
 *     tags: [Volunteers]
 *     summary: Change the seva, skills, availability, city or note on your own volunteer record
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated }
 * /api/v1/admin/volunteers:
 *   get:
 *     tags: [Volunteers]
 *     summary: All volunteers, with filters for status, seva, state and a search (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Volunteers }
 * /api/v1/admin/volunteers/{id}:
 *   patch:
 *     tags: [Volunteers]
 *     summary: Approve, reject or block a volunteer, with an optional note (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reviewed }
 */

/** The volunteer's own record. Mounted at /api/v1/me/volunteer. */
export const volunteerMeRouter = Router();

volunteerMeRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await VolunteerModel.findByUser(req.user.id);
    if (!row) throw ApiError.notFound("You are not registered as a volunteer.");
    sendSuccess(res, { data: toVolunteer(row) });
  }),
);

volunteerMeRouter.patch(
  "/",
  requireAuth,
  validate(volunteerSelfUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await VolunteerModel.findByUser(req.user.id);
    if (!row) throw ApiError.notFound("You are not registered as a volunteer.");
    const updated = await VolunteerModel.update(row.id, req.validated);
    sendSuccess(res, { message: "Saved.", data: toVolunteer(updated) });
  }),
);

/* ---------- the admin's side ---------- */

const toAdminItem = (row) => ({
  id: row.id,
  userId: row.user_id,
  fullName: row.full_name,
  email: row.email,
  mobile: row.mobile,
  isBlocked: row.is_blocked,
  isMember: Number(row.paid) > 0,
  status: row.status,
  interests: row.interests ?? [],
  skills: row.skills ?? [],
  availability: row.availability,
  city: row.city,
  state: row.state,
  about: row.about,
  adminNote: row.admin_note,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
});

const SELECT = `SELECT v.*, u.full_name, u.email, u.mobile, u.is_blocked,
                       (SELECT COALESCE(SUM(p.net_amount_in_rupees), 0) FROM registration_payments p WHERE p.user_id = u.id AND p.status = 'paid') AS paid
                  FROM volunteers v JOIN users u ON u.id = v.user_id`;

/** Volunteers for the admin. Mounted at /api/v1/admin/volunteers (the admin guard is on the parent router). */
export const adminVolunteersRouter = Router();

adminVolunteersRouter.get(
  "/",
  validateQuery(volunteerListQuerySchema),
  asyncHandler(async (req, res) => {
    const { status, interest, state, q } = req.validatedQuery;
    const where = ["u.deleted_at IS NULL"];
    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (status) where.push(`v.status = ${add(status)}::registration_status`);
    if (interest) where.push(`v.interests ? ${add(interest)}`);
    if (state) where.push(`v.state ILIKE ${add(state)}`);
    if (q) {
      const like = add(`%${q}%`);
      where.push(`(u.full_name ILIKE ${like} OR u.email ILIKE ${like} OR u.mobile ILIKE ${like} OR v.city ILIKE ${like})`);
    }
    const rows = await sql(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY v.created_at DESC LIMIT 500`, params);
    const counts = await sql(`SELECT status::text AS status, COUNT(*)::int AS n FROM volunteers GROUP BY status`);
    sendSuccess(res, {
      data: {
        items: rows.map(toAdminItem),
        counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      },
    });
  }),
);

const REVIEW_MESSAGES = {
  approved: { kind: "success", title: "Volunteer registration approved", message: "Thank you for offering your time. We will be in touch when seva begins in your area." },
  rejected: { kind: "warning", title: "Volunteer registration", message: "We could not approve your volunteer registration right now. Please contact us if you would like to know more." },
};

adminVolunteersRouter.patch(
  "/:id",
  validate(volunteerReviewSchema),
  asyncHandler(async (req, res) => {
    const { status, adminNote } = req.validated;
    const existing = await VolunteerModel.findById(req.params.id);
    if (!existing) throw ApiError.notFound("Volunteer not found.");
    const [row] = await sql(
      `UPDATE volunteers SET status = $2::registration_status, admin_note = COALESCE($3, admin_note), reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1 RETURNING id`,
      [existing.id, status, adminNote ?? null, req.user.id],
    );
    if (status !== existing.status && REVIEW_MESSAGES[status]) {
      await NotificationModel.notify(existing.userId, { category: "system", link: "/profile", dedupeKey: `volunteer-${status}-${existing.id}`, ...REVIEW_MESSAGES[status] });
    }
    const [item] = await sql(`${SELECT} WHERE v.id = $1`, [row.id]);
    sendSuccess(res, { message: "Saved.", data: toAdminItem(item) });
  }),
);
