import { buildCrudRouter } from "../utils/crudRouter.js";
import { DonationContentModel } from "../models/donationContent.model.js";
import {
  createDonationContentSchema,
  updateDonationContentSchema,
} from "../validators/donationContent.validator.js";

/**
 * Donation page content blocks (causes, testimonials, impact stats,
 * breakdown). Filter by ?type= client-side — the collection is small.
 * Mounted at /api/v1/donation-content.
 */
export const donationContentRouter = buildCrudRouter({
  repository: DonationContentModel,
  createSchema: createDonationContentSchema,
  updateSchema: updateDonationContentSchema,
  publicRead: () => ({ where: "", params: [] }),
});
