import { Router } from "express";
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
/** Mounted at /api/v1/admin/dashboard. */
export const dashboardRouter = Router();

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
