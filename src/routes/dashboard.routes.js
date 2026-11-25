import { Router } from "express";
import { sql } from "../config/database.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { getActivityFeed, getDashboardStats, getDonationTrends } from "../services/dashboard.service.js";

/**
 * @openapi
 * /api/v1/admin/dashboard/stats:
 *   get:
 *     tags: [Dashboard]
 *     summary: Aggregated admin dashboard metrics (admin)
 *     description: >
 *       One call for every stat card on the admin dashboard, plus the last
 *       12 months of paid-donation totals and a merged recent-activity feed.
 *       Every number is a live query — nothing here is mocked.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dashboard metrics }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * @openapi
 * /api/v1/admin/dashboard/pending:
 *   get:
 *     tags: [Dashboard]
 *     summary: How many things are waiting for an admin, section by section (admin)
 *     description: >
 *       The numbers behind the badges on the admin menu. Each is a live count of what still needs an approval, a rejection or a
 *       reply: pending registrations (in total and for temples, artists, dharamshalas and organisations), pending volunteers,
 *       members not yet verified, contact messages not yet handled, and photographs or videos shared for the galleries and waiting to be approved. A section with nothing waiting is 0.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Counts of items waiting for an admin }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/** Mounted at /api/v1/admin/dashboard. */
export const dashboardRouter = Router();

dashboardRouter.get(
  "/pending",
  ...requireAdmin,
  asyncHandler(async (_req, res) => {
    const [[reg], [volunteers], [verification], [contact], [gallery]] = await Promise.all([
      sql(`SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS registrations,
                  COUNT(*) FILTER (WHERE status = 'pending' AND type = 'temple')::int AS temples,
                  COUNT(*) FILTER (WHERE status = 'pending' AND type IN ('artist', 'dancer', 'musician'))::int AS artists,
                  COUNT(*) FILTER (WHERE status = 'pending' AND type = 'dharamshala')::int AS dharamshalas,
                  COUNT(*) FILTER (WHERE status = 'pending' AND type = 'mandal')::int AS organisations
             FROM all_registrations`),
      sql(`SELECT COUNT(*)::int AS n FROM volunteers WHERE status = 'pending'`),
      sql(`SELECT COUNT(*)::int AS n FROM users WHERE deleted_at IS NULL AND role <> 'admin' AND NOT is_verified AND NOT is_blocked`),
      sql(`SELECT COUNT(*)::int AS n FROM contact_submissions WHERE NOT is_handled`),
      sql(`SELECT COUNT(*)::int AS n FROM gallery_items WHERE status = 'pending'`),
    ]);
    sendSuccess(res, {
      data: {
        registrations: reg.registrations ?? 0,
        temples: reg.temples ?? 0,
        artists: reg.artists ?? 0,
        dharamshalas: reg.dharamshalas ?? 0,
        organisations: reg.organisations ?? 0,
        volunteers: volunteers.n ?? 0,
        verification: verification.n ?? 0,
        contactInquiries: contact.n ?? 0,
        gallery: gallery.n ?? 0,
      },
    });
  }),
);

dashboardRouter.get(
  "/stats",
  ...requireAdmin,
  asyncHandler(async (_req, res) => {
    const [stats, donationTrends, activity] = await Promise.all([
      getDashboardStats(),
      getDonationTrends(),
      getActivityFeed(),
    ]);

    sendSuccess(res, { data: { stats, donationTrends, activity } });
  }),
);
