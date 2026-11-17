import { Router } from "express";
import authRoutes from "./auth.routes.js";
import { adsRouter } from "./ads.routes.js";
import { blogCategoriesRouter, blogPostsRouter } from "./blog.routes.js";
import { communitiesRouter } from "./communities.routes.js";
import { adminContactRouter, contactRouter } from "./contact.routes.js";
import { dashboardRouter } from "./dashboard.routes.js";
import { donationContentRouter } from "./donationContent.routes.js";
import { adminDonationsRouter, donationsRouter } from "./donations.routes.js";
import {
  adminEventVolunteersRouter,
  eventVolunteersRouter,
  eventsRouter,
} from "./events.routes.js";
import { initiativesRouter } from "./initiatives.routes.js";
import { meRouter } from "./me.routes.js";
import { adminPaymentsRouter, paymentsRouter } from "./payments.routes.js";
import { adminNotificationsRouter, notificationsRouter } from "./notifications.routes.js";
import { organisationsRouter } from "./organisations.routes.js";
import { productsRouter } from "./products.routes.js";
import { adminRegistrationsRouter, registrationsRouter } from "./registrations.routes.js";
import { adminSettingsRouter, settingsRouter } from "./settings.routes.js";
import { stateChaptersRouter } from "./stateChapters.routes.js";
import { teamMembersRouter } from "./teamMembers.routes.js";
import { adminTeamProfilesRouter, teamProfilesRouter } from "./teamProfiles.routes.js";
import { uploadsRouter } from "./uploads.routes.js";
import { adminUsersRouter } from "./users.routes.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

/**
 * @openapi
 * /api/v1/health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness probe
 *     responses:
 *       200:
 *         description: Service is up
 */
router.get("/health", (_req, res) => {
  res.json({ success: true, message: "OK", data: { uptime: process.uptime() } });
});

/**
 * Everything under /api/v1/admin is for administrators only. The guard sits
 * here, once, so no admin route can be added to this router and forget it —
 * and it is easy to tell at a glance (and in logs) which endpoints are admin.
 */
const admin = Router();
admin.use(...requireAdmin);

admin.use("/users", adminUsersRouter);
admin.use("/dashboard", dashboardRouter);
admin.use("/registrations", adminRegistrationsRouter);
admin.use("/notifications", adminNotificationsRouter);
admin.use("/payments", adminPaymentsRouter);
admin.use("/contact", adminContactRouter);
admin.use("/donations", adminDonationsRouter);
admin.use("/settings", adminSettingsRouter);
admin.use("/team-profiles", adminTeamProfilesRouter);
admin.use("/events/:eventId/volunteers", adminEventVolunteersRouter);

/**
 * Content resources built from the shared CRUD router: the public site reads
 * them at /<resource> (published items only), and admins create, edit, delete
 * and see unpublished items at /admin/<resource>.
 */
const content = {
  "/ads": adsRouter,
  "/blog-posts": blogPostsRouter,
  "/blog-categories": blogCategoriesRouter,
  "/communities": communitiesRouter,
  "/donation-content": donationContentRouter,
  "/events": eventsRouter,
  "/initiatives": initiativesRouter,
  "/organisations": organisationsRouter,
  "/products": productsRouter,
  "/state-chapters": stateChaptersRouter,
  "/team-members": teamMembersRouter,
};
for (const [path, crud] of Object.entries(content)) {
  router.use(path, crud.reads);
  admin.use(path, crud);
}

router.use("/admin", admin);

router.use("/auth", authRoutes);
router.use("/contact", contactRouter);
router.use("/donations", donationsRouter);
router.use("/events/:eventId/volunteers", eventVolunteersRouter);
router.use("/me", meRouter);
router.use("/notifications", notificationsRouter);
router.use("/payments", paymentsRouter);
router.use("/registrations", registrationsRouter);
router.use("/settings", settingsRouter);
router.use("/team-profiles", teamProfilesRouter);
router.use("/uploads", uploadsRouter);

export default router;
