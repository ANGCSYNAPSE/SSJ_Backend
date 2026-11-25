import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const GALLERIES = ["initiatives", "own-wish"];

const shareSchema = z.object({
  gallery: z.enum(GALLERIES),
  folder: z.string().trim().min(1).max(60),
  kind: z.enum(["photo", "video"]),
  url: z.string().trim().url().max(500),
  caption: z.string().trim().max(200).optional(),
});

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected", "pending"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * @openapi
 * /api/v1/gallery:
 *   get:
 *     tags: [Gallery]
 *     summary: The approved photographs and videos of a gallery (public)
 *     description: Only items an admin has approved are ever returned.
 *     parameters:
 *       - { in: query, name: gallery, required: true, schema: { type: string, enum: [initiatives, own-wish] } }
 *     responses:
 *       200: { description: "Approved items: id, folder, kind, url, caption" }
 *       400: { description: Unknown gallery }
 * /api/v1/gallery/mine:
 *   get:
 *     tags: [Gallery]
 *     summary: What the signed-in member has shared, and its status
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The member's own items, newest first }
 *   post:
 *     tags: [Gallery]
 *     summary: A member shares a photograph or video (it waits for an admin's approval)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Received, waiting for approval }
 * /api/v1/admin/gallery:
 *   get:
 *     tags: [Gallery]
 *     summary: Shared photographs and videos, by status (default pending) (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Items with who shared them, and the count of each status }
 * /api/v1/admin/gallery/{id}:
 *   patch:
 *     tags: [Gallery]
 *     summary: Approve or reject a shared item (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Reviewed }
 */
/** Public gallery and member sharing. Mounted at /api/v1/gallery. */
export const galleryRouter = Router();
/** Admin review. Mounted at /api/v1/admin/gallery. */
export const adminGalleryRouter = Router();

galleryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const gallery = String(req.query.gallery ?? "");
    if (!GALLERIES.includes(gallery)) throw ApiError.badRequest("Unknown gallery.");
    const rows = await sql(
      `SELECT id, folder, kind, url, caption, created_at AS "createdAt"
         FROM gallery_items
        WHERE status = 'approved' AND gallery = $1
        ORDER BY created_at DESC
        LIMIT 500`,
      [gallery],
    );
    sendSuccess(res, { data: rows });
  }),
);

/** What the signed-in member has shared, with where each one stands (waiting, shown, or not shown). */
galleryRouter.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await sql(
      `SELECT id, gallery, folder, kind, url, caption, status, created_at AS "createdAt"
         FROM gallery_items
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.user.id],
    );
    sendSuccess(res, { data: rows });
  }),
);

galleryRouter.post(
  "/",
  requireAuth,
  validate(shareSchema),
  asyncHandler(async (req, res) => {
    const { gallery, folder, kind, url, caption } = req.validated;
    const [row] = await sql(
      `INSERT INTO gallery_items (user_id, gallery, folder, kind, url, caption)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, status`,
      [req.user.id, gallery, folder, kind, url, caption ?? null],
    );
    sendSuccess(res, { status: 201, message: "Thank you! It will appear after our team has looked at it.", data: row });
  }),
);

adminGalleryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = ["pending", "approved", "rejected"].includes(String(req.query.status)) ? String(req.query.status) : "pending";
    const [items, counts] = await Promise.all([
      sql(
        `SELECT g.id, g.gallery, g.folder, g.kind, g.url, g.caption, g.status, g.admin_note AS "adminNote",
                g.created_at AS "createdAt", g.reviewed_at AS "reviewedAt",
                u.full_name AS "fullName", u.email
           FROM gallery_items g JOIN users u ON u.id = g.user_id
          WHERE g.status = $1
          ORDER BY g.created_at DESC
          LIMIT 200`,
        [status],
      ),
      sql(`SELECT status, COUNT(*)::int AS n FROM gallery_items GROUP BY status`),
    ]);
    sendSuccess(res, { data: { items, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) } });
  }),
);

adminGalleryRouter.patch(
  "/:id",
  validate(reviewSchema),
  asyncHandler(async (req, res) => {
    const { status, note } = req.validated;
    const rows = await sql(
      `UPDATE gallery_items
          SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = NOW()
        WHERE id = $1
        RETURNING id, status`,
      [req.params.id, status, note ?? null, req.user.id],
    );
    if (rows.length === 0) throw ApiError.notFound();
    sendSuccess(res, { message: status === "approved" ? "Approved. It is now in the gallery." : "Saved.", data: rows[0] });
  }),
);
