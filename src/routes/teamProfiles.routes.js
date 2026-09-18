import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { TeamProfileModel } from "../models/teamProfile.model.js";
import { upsertTeamProfileSchema } from "../validators/teamProfiles.validator.js";

const VALID_KEYS = ["chairman", "mukhya_trustee"];

/**
 * @openapi
 * /api/v1/team-profiles/{key}:
 *   get:
 *     tags: [Team Profiles]
 *     summary: Get a singleton profile (chairman or mukhya_trustee)
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string, enum: [chairman, mukhya_trustee] } }
 *     responses:
 *       200: { description: Profile found }
 *       400: { description: Invalid profile key }
 *       404: { description: Not created yet }
 *   patch:
 *     tags: [Team Profiles]
 *     summary: Create or update a singleton profile (admin, upserts)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: key, required: true, schema: { type: string, enum: [chairman, mukhya_trustee] } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, title]
 *             properties:
 *               name: { type: string }
 *               title: { type: string }
 *               photo: { type: string }
 *               quote: { type: string }
 *               bio: { type: string }
 *               milestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     title: { type: string }
 *                     year: { type: string }
 *                     desc: { type: string }
 *               credentials: { type: array, items: { type: string } }
 *               socialLinks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     platform: { type: string }
 *                     url: { type: string }
 *     responses:
 *       200: { description: Updated }
 *       201: { description: Created }
 *       400: { description: Invalid profile key or validation failed }
 */
/**
 * The two singleton bio pages (Chairman, Mukhya Trustee). Public GET,
 * admin-only PATCH which upserts (creates the profile the first time it's
 * edited). Mounted at /api/v1/team-profiles.
 */
export const teamProfilesRouter = Router();

teamProfilesRouter.get(
  "/:key",
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    if (!VALID_KEYS.includes(key)) throw ApiError.badRequest("Invalid profile key");
    const profile = await TeamProfileModel.findOne("key = $1", [key]);
    if (!profile) throw ApiError.notFound();
    sendSuccess(res, { data: profile });
  }),
);

teamProfilesRouter.patch(
  "/:key",
  ...requireAdmin,
  validate(upsertTeamProfileSchema),
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    if (!VALID_KEYS.includes(key)) throw ApiError.badRequest("Invalid profile key");

    const existing = await TeamProfileModel.findOne("key = $1", [key]);
    if (existing) {
      const updated = await TeamProfileModel.update(existing.id, req.validated);
      return sendSuccess(res, { message: "Saved.", data: updated });
    }
    const created = await TeamProfileModel.create({ ...req.validated, key });
    return sendSuccess(res, { status: 201, message: "Saved.", data: created });
  }),
);
