import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { NotificationModel } from "../models/notification.model.js";
import { markReadSchema, sendNotificationSchema } from "../validators/notifications.validator.js";

/** The signed-in user's own messages. Mounted at /api/v1/notifications. */
export const notificationsRouter = Router();

/** What an admin sends and has sent. Mounted at /api/v1/admin/notifications. */
export const adminNotificationsRouter = Router();

/**
 * @openapi
 * /api/v1/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Your unread messages from the Shyam Jagat team
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "Unread notifications, newest first: { id, kind, title, message, link, createdAt }" }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 * /api/v1/notifications/read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark messages as read (all unread ones when no ids are sent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string, format: uuid } }
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

notificationsRouter.post(
  "/read",
  requireAuth,
  validate(markReadSchema),
  asyncHandler(async (req, res) => {
    const count = await NotificationModel.markRead(req.user.id, req.validated.ids);
    sendSuccess(res, { message: "Marked read.", data: { count } });
  }),
);

/**
 * @openapi
 * /api/v1/admin/notifications:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a message to one or more users (admin)
 *     description: Each recipient sees it as a toast the next time they are signed in on the site.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds, message]
 *             properties:
 *               userIds: { type: array, items: { type: string, format: uuid }, maxItems: 200 }
 *               message: { type: string, maxLength: 500 }
 *               title: { type: string, maxLength: 100 }
 *               kind: { type: string, enum: [info, success, warning], default: info }
 *               link: { type: string, description: "A path inside the site, e.g. /complete-profile" }
 *     responses:
 *       201: { description: "Sent; data.sent is how many people received it" }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *   get:
 *     tags: [Notifications]
 *     summary: Messages already sent to one user (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: userId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Sent messages, newest first, with read state }
 */
adminNotificationsRouter.post(
  "/",
  validate(sendNotificationSchema),
  asyncHandler(async (req, res) => {
    const sent = await NotificationModel.createMany({ ...req.validated, createdBy: req.user.id });
    sendSuccess(res, { status: 201, message: sent === 1 ? "Message sent." : `Message sent to ${sent} people.`, data: { sent } });
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
