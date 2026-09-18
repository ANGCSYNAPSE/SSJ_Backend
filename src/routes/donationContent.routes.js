import { buildCrudRouter } from "../utils/crudRouter.js";
import { DonationContentModel } from "../models/donationContent.model.js";
import {
  createDonationContentSchema,
  updateDonationContentSchema,
} from "../validators/donationContent.validator.js";

/**
 * @openapi
 * /api/v1/donation-content:
 *   get:
 *     tags: [Donation Content]
 *     summary: List donation page content blocks
 *     description: Covers causes, testimonials, impact stats and breakdown slices. Filter by ?type= client-side.
 *     responses:
 *       200: { description: List of content blocks }
 *   post:
 *     tags: [Donation Content]
 *     summary: Create a content block (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type: { type: string, enum: [cause, testimonial, impact_stat, breakdown_slice] }
 *               order: { type: integer, default: 0 }
 *               data: { type: object, description: Free-form fields specific to the content type }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/donation-content/{id}:
 *   get:
 *     tags: [Donation Content]
 *     summary: Get a content block by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Donation Content]
 *     summary: Update a content block (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Donation Content]
 *     summary: Delete a content block (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
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
