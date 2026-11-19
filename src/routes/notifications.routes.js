import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { NotificationModel } from "../models/notification.model.js";
import { audiencePreview, audienceUserIds } from "../services/audience.service.js";
import {
  audiencePreviewSchema,
  broadcastSchema,
  feedQuerySchema,
  markReadSchema,
  sendNotificationSchema,
} from "../validators/notifications.validator.js";

/** The signed-in user's own notifications. Mounted at /api/v1/notifications. */
export const notificationsRouter = Router();

/** What an admin sends and has sent. Mounted at /api/v1/admin/notifications. */
export const adminNotificationsRouter = Router();

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Your unread notifications (newest first)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ id, kind, category, title, message, link, createdAt }]" }
 * /api/v1/notifications/count:
 *   get:
 *     tags: [Notifications]
 *     summary: How many unread notifications you have (cheap; the bell polls this)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ unread }" }
 * /api/v1/notifications/feed:
 *   get:
 *     tags: [Notifications]
 *     summary: Your notifications, newest first, with paging
 *     description: "Query: limit (1-50), before (the createdAt of the last item you have), unread=true, category."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ items[], nextCursor, unread }" }
 * /api/v1/notifications/read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark notifications read (all unread ones when no ids are sent)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Marked read }
 */
notificationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await NotificationModel.listUnread(req.user.id) });
  }),
);

notificationsRouter.get(
  "/count",
  requireAuth,
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: { unread: await NotificationModel.countUnread(req.user.id) } });
  }),
);

notificationsRouter.get(
  "/feed",
  requireAuth,
  validateQuery(feedQuerySchema),
  asyncHandler(async (req, res) => {
    const { limit, before, unread, category } = req.validatedQuery;
    const [page, unreadCount] = await Promise.all([
      NotificationModel.feed(req.user.id, { limit, before, unreadOnly: unread === "true", category }),
      NotificationModel.countUnread(req.user.id),
    ]);
    sendSuccess(res, { data: { ...page, unread: unreadCount } });
  }),
);

notificationsRouter.post(
  "/read",
  requireAuth,
  validate(markReadSchema),
  asyncHandler(async (req, res) => {
    const count = await NotificationModel.markRead(req.user.id, req.validated.ids);
    sendSuccess(res, { message: "Marked read.", data: { count } });
  }),
);

/* ───────────────────────── Admin ───────────────────────── */

/**
 * @openapi
 * /api/v1/admin/notifications:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a message to chosen people (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Sent }
 * /api/v1/admin/notifications/audience:
 *   post:
 *     tags: [Notifications]
 *     summary: How many people an audience reaches, and a few names (admin)
 *     description: "Audience: { mode: all } | { mode: segment, segment: { fee: paid|partial|unpaid, categories[], profile: incomplete|complete, registration: none|any } } | { mode: users, userIds[] }."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ count, capped, sample[] }" }
 * /api/v1/admin/notifications/broadcast:
 *   post:
 *     tags: [Notifications]
 *     summary: Send one message to a whole audience (admin)
 *     description: "Body: { audience, title?, message, kind, category, link? }. Appears in each person's bell. The link must be a path inside the site."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ broadcastId, sent }" }
 *       400: { description: Nobody matches the audience }
 * /api/v1/admin/notifications/broadcasts:
 *   get:
 *     tags: [Notifications]
 *     summary: Past broadcasts with how many people received and read each (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "[{ id, title, message, category, audience, recipients, read, createdAt, createdBy }]" }
 */
adminNotificationsRouter.post(
  "/",
  validate(sendNotificationSchema),
  asyncHandler(async (req, res) => {
    const sent = await NotificationModel.createMany({ ...req.validated, createdBy: req.user.id });
    sendSuccess(res, { status: 201, message: sent === 1 ? "Message sent." : `Message sent to ${sent} people.`, data: { sent } });
  }),
);

adminNotificationsRouter.post(
  "/audience",
  validate(audiencePreviewSchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await audiencePreview(req.validated.audience) });
  }),
);

adminNotificationsRouter.post(
  "/broadcast",
  validate(broadcastSchema),
  asyncHandler(async (req, res) => {
    const { audience, ...message } = req.validated;
    const userIds = await audienceUserIds(audience);
    if (userIds.length === 0) throw ApiError.badRequest("Nobody matches this audience, so nothing was sent.");

    const [broadcast] = await sql(
      `INSERT INTO notification_broadcasts (title, message, kind, category, link, audience, recipient_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, $7) RETURNING id`,
      [message.title ?? null, message.message, message.kind, message.category, message.link ?? null, JSON.stringify(audience), req.user.id],
    );
    const sent = await NotificationModel.createMany({ ...message, userIds, createdBy: req.user.id, broadcastId: broadcast.id });
    await sql(`UPDATE notification_broadcasts SET recipient_count = $2 WHERE id = $1`, [broadcast.id, sent]);
    sendSuccess(res, {
      status: 201,
      message: sent === 1 ? "Message sent to 1 person." : `Message sent to ${sent} people.`,
      data: { broadcastId: broadcast.id, sent },
    });
  }),
);

adminNotificationsRouter.get(
  "/broadcasts",
  asyncHandler(async (_req, res) => {
    const rows = await sql(
      `SELECT b.id, b.title, b.message, b.kind, b.category, b.link, b.audience, b.created_at, u.full_name AS created_by,
              COUNT(n.id)::int AS recipients, COUNT(n.read_at)::int AS read
       FROM notification_broadcasts b
       LEFT JOIN notifications n ON n.broadcast_id = b.id
       LEFT JOIN users u ON u.id = b.created_by
       GROUP BY b.id, u.full_name
       ORDER BY b.created_at DESC LIMIT 50`,
    );
    sendSuccess(res, {
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        kind: row.kind,
        category: row.category,
        link: row.link,
        audience: row.audience,
        recipients: row.recipients,
        read: row.read,
        createdAt: row.created_at,
        createdBy: row.created_by,
      })),
    });
  }),
);

adminNotificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest("A valid userId is required.");
    sendSuccess(res, { data: await NotificationModel.listForUser(parsed.data.userId) });
  }),
);
