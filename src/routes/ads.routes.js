import { Router } from "express";
import { buildCrudRouter } from "../utils/crudRouter.js";
import { AdModel } from "../models/ad.model.js";
import { createAdSchema, updateAdSchema, adRotationSchema } from "../validators/ads.validator.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { sql } from "../config/database.js";

const ROTATION_KEY = "ad_rotation";
export const DEFAULT_ROTATION = { seconds: 6, transition: "tiles", pauseOnHover: true };

/** The site-wide rotation rules; the defaults until an admin changes them. */
async function getRotation() {
  try {
    const [row] = await sql(`SELECT value FROM app_settings WHERE key = $1`, [ROTATION_KEY]);
    const parsed = adRotationSchema.safeParse(row?.value);
    if (parsed.success) return parsed.data;
  } catch {
    // The settings table is not there yet: the defaults keep the site working.
  }
  return DEFAULT_ROTATION;
}

/**
 * @openapi
 * /api/v1/ads/rotation:
 *   get:
 *     tags: [Ads]
 *     summary: How the ad slots rotate (seconds per ad, tiles or fade, pause on hover)
 *     responses:
 *       200: { description: Rotation rules }
 * /api/v1/ads/{id}/click:
 *   post:
 *     tags: [Ads]
 *     summary: Count a click on an ad
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Counted }
 * /api/v1/admin/ads/rotation:
 *   put:
 *     tags: [Ads]
 *     summary: Change how the ad slots rotate (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Saved }
 */
/** Public: the rotation rules and click counting. Mounted at /api/v1/ads, before the ads list so "rotation" is not read as an id. */
export const adsPublicExtrasRouter = Router();

adsPublicExtrasRouter.get(
  "/rotation",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await getRotation() });
  }),
);

adsPublicExtrasRouter.post(
  "/:id/click",
  asyncHandler(async (req, res) => {
    // Only a live ad counts; anything else (a made-up id, a paused ad) is ignored quietly.
    if (/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      await sql(`UPDATE ads SET clicks = clicks + 1 WHERE id = $1 AND is_active = TRUE AND is_draft = FALSE`, [req.params.id]);
    }
    res.status(204).send();
  }),
);

/** Admin: change the rotation rules. Mounted at /api/v1/admin/ads, before the ads CRUD. */
export const adsAdminExtrasRouter = Router();

adsAdminExtrasRouter.get(
  "/rotation",
  ...requireAdmin,
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await getRotation() });
  }),
);

adsAdminExtrasRouter.put(
  "/rotation",
  ...requireAdmin,
  validate(adRotationSchema),
  asyncHandler(async (req, res) => {
    const saved = req.validated;
    await sql(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [ROTATION_KEY, JSON.stringify(saved), req.user?.id ?? null],
    );
    sendSuccess(res, { message: "Saved.", data: saved });
  }),
);

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
 *         imageUrl: { type: string, nullable: true }
 *         linkUrl: { type: string, nullable: true }
 *         ctaLabel: { type: string, nullable: true }
 *         template: { type: string, enum: [image, split], description: "image = the picture is the whole ad; split = coloured panel with headline, text and button beside a picture" }
 *         headline: { type: string, nullable: true }
 *         subline: { type: string, nullable: true }
 *         theme: { type: string, enum: [maroon, navy, charcoal, forest, royal, teal, custom] }
 *         bgFrom: { type: string, nullable: true }
 *         bgTo: { type: string, nullable: true }
 *         ctaColor: { type: string, nullable: true, description: "Button colour (#rrggbb); empty = the colour scheme's default" }
 *         slotPosition: { type: integer, nullable: true, minimum: 1, maximum: 9, description: "The 1st, 2nd... spot of its size on the page, top to bottom; empty = any spot" }
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
