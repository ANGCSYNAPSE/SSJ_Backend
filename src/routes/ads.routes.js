import { buildCrudRouter } from "../utils/crudRouter.js";
import { AdModel } from "../models/ad.model.js";
import { createAdSchema, updateAdSchema } from "../validators/ads.validator.js";

/**
 * @openapi
 * components:
 *   schemas:
 *     Ad:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         placement: { type: string, enum: [leaderboard, banner, rectangle] }
 *         page: { type: string, nullable: true }
 *         imageUrl: { type: string }
 *         linkUrl: { type: string, nullable: true }
 *         ctaLabel: { type: string, nullable: true }
 *         isActive: { type: boolean }
 *         startsAt: { type: string, format: date-time, nullable: true }
 *         endsAt: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     AdInput:
 *       type: object
 *       required: [placement, imageUrl]
 *       properties:
 *         placement: { type: string, enum: [leaderboard, banner, rectangle] }
 *         page: { type: string }
 *         imageUrl: { type: string }
 *         linkUrl: { type: string }
 *         ctaLabel: { type: string }
 *         isActive: { type: boolean, default: true }
 *         startsAt: { type: string, format: date-time }
 *         endsAt: { type: string, format: date-time }
 * /api/v1/ads:
 *   get:
 *     tags: [Ads]
 *     summary: List ads
 *     description: Anonymous callers only see active ads within their date window; admins see everything.
 *     responses:
 *       200:
 *         description: List of ads
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { type: array, items: { $ref: '#/components/schemas/Ad' } }
 *   post:
 *     tags: [Ads]
 *     summary: Create an ad (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AdInput' }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 * /api/v1/ads/{id}:
 *   get:
 *     tags: [Ads]
 *     summary: Get an ad by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Ad found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Ads]
 *     summary: Update an ad (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AdInput' }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Ads]
 *     summary: Delete an ad (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
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
