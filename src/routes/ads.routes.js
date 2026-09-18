import { buildCrudRouter } from "../utils/crudRouter.js";
import { AdModel } from "../models/ad.model.js";
import { createAdSchema, updateAdSchema } from "../validators/ads.validator.js";

/**
 * Every AdSlot on the site reads from here, filtered by placement
 * (leaderboard/banner/rectangle) client-side. Public GET only returns ads
 * that are active and within their date window; admin sees everything and
 * can add/edit/remove. Mounted at /api/v1/ads.
 */
export const adsRouter = buildCrudRouter({
  repository: AdModel,
  createSchema: createAdSchema,
  updateSchema: updateAdSchema,
  publicRead: () => ({
    where: `is_active = TRUE AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())`,
    params: [],
    isVisible: (ad) => {
      if (!ad.isActive) return false;
      const now = Date.now();
      if (ad.startsAt && now < Date.parse(ad.startsAt)) return false;
      if (ad.endsAt && now > Date.parse(ad.endsAt)) return false;
      return true;
    },
  }),
});
