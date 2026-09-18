import { Router } from "express";
import authRoutes from "./auth.routes.js";
import { adsRouter } from "./ads.routes.js";
import { blogCategoriesRouter, blogPostsRouter } from "./blog.routes.js";
import { contactRouter } from "./contact.routes.js";
import { donationContentRouter } from "./donationContent.routes.js";
import { donationsRouter } from "./donations.routes.js";
import { eventVolunteersRouter, eventsRouter } from "./events.routes.js";
import { initiativesRouter } from "./initiatives.routes.js";
import { registrationsRouter } from "./registrations.routes.js";
import { settingsRouter } from "./settings.routes.js";
import { stateChaptersRouter } from "./stateChapters.routes.js";
import { teamMembersRouter } from "./teamMembers.routes.js";
import { teamProfilesRouter } from "./teamProfiles.routes.js";
import { uploadsRouter } from "./uploads.routes.js";
import { adminUsersRouter } from "./users.routes.js";

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

router.use("/auth", authRoutes);
router.use("/admin/users", adminUsersRouter);
router.use("/ads", adsRouter);
router.use("/blog-posts", blogPostsRouter);
router.use("/blog-categories", blogCategoriesRouter);
router.use("/contact", contactRouter);
router.use("/donation-content", donationContentRouter);
router.use("/donations", donationsRouter);
router.use("/events/:eventId/volunteers", eventVolunteersRouter);
router.use("/events", eventsRouter);
router.use("/initiatives", initiativesRouter);
router.use("/registrations", registrationsRouter);
router.use("/settings", settingsRouter);
router.use("/state-chapters", stateChaptersRouter);
router.use("/team-members", teamMembersRouter);
router.use("/team-profiles", teamProfilesRouter);
router.use("/uploads", uploadsRouter);

export default router;
