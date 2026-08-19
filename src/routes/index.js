import { Router } from "express";
import authRoutes from "./auth.routes.js";

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

export default router;
