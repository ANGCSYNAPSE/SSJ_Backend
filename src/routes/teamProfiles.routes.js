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
