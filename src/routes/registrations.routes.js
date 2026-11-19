import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { NotificationModel } from "../models/notification.model.js";
import { AuthService } from "../services/auth.service.js";
import {
  findProfileByUser,
  findProfileWithAccount,
  isCategory,
  listAllRegistrations,
  listProfilesForUser,
  listPublicProfiles,
  profileRepository,
  syncCompleteness,
} from "../models/profile.model.js";
import { PROFILE_SCHEMAS, profileUpdateSchema, registrationQuerySchema } from "../validators/profiles.validator.js";

/**
 * Profiles for the six signup categories (artist, dancer, musician, temple,
 * dharamshala, mandal), each stored in its own table. People register through
 * POST /auth/signup; the routes here let them manage their own profile and let
 * admins review everyone's. Mounted at /api/v1/registrations.
 */
export const registrationsRouter = Router();

/** The admin side of the same data. Mounted at /api/v1/admin/registrations, behind the admin guard. */
export const adminRegistrationsRouter = Router();

const checkType = (_req, _res, next, type) =>
  isCategory(type) ? next() : next(ApiError.notFound("Unknown registration category."));
registrationsRouter.param("type", checkType);
adminRegistrationsRouter.param("type", checkType);

/** Runs `schema` against the body, answering with the same error shape as `validate`. */
function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.badRequest(
      "Validation failed.",
      result.error.issues.map((issue) => ({ field: issue.path.join(".") || "form", message: issue.message })),
    );
  }
  return result.data;
}

/**
 * @openapi
 * /api/v1/registrations/public:
 *   get:
 *     tags: [Registrations]
 *     summary: List approved profiles of one category (public)
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] }
 *     responses:
 *       200: { description: Approved profiles, private fields removed }
 *       400: { description: type is missing or unknown }
 */
registrationsRouter.get(
  "/public",
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    if (!type || !isCategory(type)) throw ApiError.badRequest("A valid type is required.");
    sendSuccess(res, { data: await listPublicProfiles(type) });
  }),
);

/**
 * @openapi
 * /api/v1/registrations/me:
 *   get:
 *     tags: [Registrations]
 *     summary: The signed-in user's own category profiles, with full details
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of profiles, each tagged with its category }
 */
registrationsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const summaries = await listProfilesForUser(req.user.id);
    const profiles = await Promise.all(
      summaries.map(async ({ category }) => ({
        category,
        ...(await findProfileByUser(category, req.user.id)),
      })),
    );
    sendSuccess(res, { data: profiles });
  }),
);

/**
 * @openapi
 * /api/v1/registrations/me/{type}:
 *   patch:
 *     tags: [Registrations]
 *     summary: Edit your own profile in a category (e.g. attach an uploaded photo)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: type, required: true, schema: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: You have not registered in this category }
 */
registrationsRouter.patch(
  "/me/:type",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { type } = req.params;
    const existing = await findProfileByUser(type, req.user.id);
    if (!existing) throw ApiError.notFound("You have not registered in this category.");
    const patch = parseBody(profileUpdateSchema(type), req.body);
    const updated = await syncCompleteness(type, await profileRepository(type).update(existing.id, patch));
    sendSuccess(res, { message: "Updated.", data: updated });
  }),
);

/**
 * @openapi
 * /api/v1/admin/registrations:
 *   get:
 *     tags: [Registrations]
 *     summary: List and filter registrations across every category (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, blocked] }
 *       - in: query
 *         name: complete
 *         description: "true = only complete profiles, false = only ones with required details still missing"
 *         schema: { type: string, enum: ["true", "false"] }
 *     responses:
 *       200: { description: "Registrations, newest first, each with isComplete and the list of missing details" }
 */
adminRegistrationsRouter.get(
  "/",
  validateQuery(registrationQuerySchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await listAllRegistrations(req.validatedQuery) });
  }),
);

/**
 * @openapi
 * /api/v1/registrations/{type}:
 *   post:
 *     tags: [Registrations]
 *     summary: Add a category profile to your existing account
 *     description: For someone who already has an account (for example a member) and now wants to list a temple, register as an artist, and so on. New accounts do this through POST /auth/signup.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: type, required: true, schema: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, description: The category's own fields }
 *     responses:
 *       201: { description: Submitted, pending admin verification }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       409: { description: Already registered in this category }
 */
registrationsRouter.post(
  "/:type",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { type } = req.params;
    const profile = parseBody(PROFILE_SCHEMAS[type], req.body);
    const created = await AuthService.addProfile(req.user.id, type, profile);
    sendSuccess(res, { status: 201, message: "Submitted, pending admin verification.", data: created });
  }),
);

/**
 * @openapi
 * /api/v1/admin/registrations/{type}/{id}:
 *   get:
 *     tags: [Registrations]
 *     summary: Full profile plus the owner's account details (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: type, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Registrations]
 *     summary: Edit a profile or leave an admin note (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: type, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Registrations]
 *     summary: Delete a profile; the user's account stays (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: type, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
adminRegistrationsRouter.get(
  "/:type/:id",
  asyncHandler(async (req, res) => {
    const item = await findProfileWithAccount(req.params.type, req.params.id);
    if (!item) throw ApiError.notFound();
    sendSuccess(res, { data: item });
  }),
);

adminRegistrationsRouter.patch(
  "/:type/:id",
  asyncHandler(async (req, res) => {
    const { type, id } = req.params;
    const schema = profileUpdateSchema(type).extend({ adminNote: z.string().max(1000).optional() });
    const patch = parseBody(schema, req.body);
    const updated = await syncCompleteness(type, await profileRepository(type).update(id, patch));
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Updated.", data: updated });
  }),
);

/**
 * @openapi
 * /api/v1/admin/registrations/{type}/{id}/{action}:
 *   patch:
 *     tags: [Registrations]
 *     summary: Verify, reject, block or unblock a profile (admin)
 *     description: "`action` is one of verify (approved), reject (rejected), block (blocked), unblock (back to approved). Optionally send { adminNote }."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: type, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: action, required: true, schema: { type: string, enum: [verify, reject, block, unblock] } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { adminNote: { type: string } } }
 *     responses:
 *       200: { description: Status updated }
 *       404: { description: Not found }
 */
const STATUS_ACTIONS = { verify: "approved", reject: "rejected", block: "blocked", unblock: "approved" };

for (const [action, status] of Object.entries(STATUS_ACTIONS)) {
  adminRegistrationsRouter.patch(
    `/:type/:id/${action}`,
    asyncHandler(async (req, res) => {
      const updated = await profileRepository(req.params.type).update(req.params.id, {
        status,
        adminNote: typeof req.body?.adminNote === "string" ? req.body.adminNote : undefined,
      });
      if (!updated) throw ApiError.notFound();

      // Tell the person what the team decided, in their bell.
      const label = { artist: "artist", dancer: "dancer", musician: "musician", temple: "temple", dharamshala: "dharamshala", mandal: "mandal" }[req.params.type] ?? "";
      const note = typeof req.body?.adminNote === "string" && req.body.adminNote.trim() ? ` Note from the team: ${req.body.adminNote.trim().slice(0, 200)}` : "";
      const text = {
        approved: { kind: "success", title: "Registration approved", message: `Your ${label} registration has been approved. Thank you for joining the Shyam Jagat family!${note}` },
        rejected: { kind: "warning", title: "Registration not approved", message: `Your ${label} registration could not be approved yet.${note || " Please check your details."}` },
        blocked: { kind: "warning", title: "Registration on hold", message: `Your ${label} registration has been put on hold.${note}` },
      }[status];
      if (updated.userId && text) {
        await NotificationModel.notify(updated.userId, { ...text, category: "registration", link: "/profile" });
      }
      sendSuccess(res, { message: "Updated.", data: updated });
    }),
  );
}

adminRegistrationsRouter.delete(
  "/:type/:id",
  asyncHandler(async (req, res) => {
    const removed = await profileRepository(req.params.type).remove(req.params.id);
    if (!removed) throw ApiError.notFound();
    res.status(204).send();
  }),
);
