import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { SettingsModel } from "../models/settings.model.js";
import { updateSettingsSchema } from "../validators/settings.validator.js";

const DEFAULTS = {
  contactEmail: "contact@shreeshyamjagat.org",
  contactPhone: "+91 1234 567 890",
  address: "123 Temple Road, Ramsagar, Bharat",
  socialLinks: [],
};

async function getOrCreateSettings() {
  const [existing] = await SettingsModel.list();
  if (existing) return existing;
  return SettingsModel.create(DEFAULTS);
}

/** Singleton site settings (contact info, social links). Mounted at /api/v1/settings. */
export const settingsRouter = Router();

settingsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await getOrCreateSettings() });
  }),
);

settingsRouter.patch(
  "/",
  ...requireAdmin,
  validate(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    const current = await getOrCreateSettings();
    const updated = await SettingsModel.update(current.id, req.validated);
    sendSuccess(res, { message: "Updated.", data: updated });
  }),
);
