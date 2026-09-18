import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { buildCrudRouter } from "../utils/crudRouter.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { EventModel, EventVolunteerModel } from "../models/event.model.js";
import { createEventSchema, createEventVolunteerSchema, updateEventSchema } from "../validators/events.validator.js";

/**
 * @openapi
 * /api/v1/events:
 *   get:
 *     tags: [Events]
 *     summary: List events
 *     description: Anonymous callers only see published events; admins see everything.
 *     responses:
 *       200: { description: List of events }
 *   post:
 *     tags: [Events]
 *     summary: Create an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description, location, startDate, type]
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *               location: { type: string }
 *               startDate: { type: string, format: date-time }
 *               endDate: { type: string, format: date-time }
 *               type: { type: string }
 *               isPublished: { type: boolean, default: false }
 *     responses:
 *       201: { description: Created }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/events/{id}:
 *   get:
 *     tags: [Events]
 *     summary: Get an event by id
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Events]
 *     summary: Update an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Events]
 *     summary: Delete an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 * /api/v1/events/{id}/publish:
 *   patch:
 *     tags: [Events]
 *     summary: Publish an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Published }
 * /api/v1/events/{id}/unpublish:
 *   patch:
 *     tags: [Events]
 *     summary: Unpublish an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Unpublished }
 */
/** Mounted at /api/v1/events. */
export const eventsRouter = buildCrudRouter({
  repository: EventModel,
  createSchema: createEventSchema,
  updateSchema: updateEventSchema,
  publicRead: () => ({
    where: "is_published = TRUE",
    params: [],
    isVisible: (event) => event.isPublished,
  }),
  statusActions: [
    { action: "publish", patch: { isPublished: true } },
    { action: "unpublish", patch: { isPublished: false } },
  ],
});

/**
 * @openapi
 * /api/v1/events/{eventId}/volunteers:
 *   post:
 *     tags: [Events]
 *     summary: Register/RSVP for an event
 *     parameters:
 *       - { in: path, name: eventId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, phone]
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               message: { type: string }
 *     responses:
 *       201: { description: Signed up }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       404: { description: Event not found }
 *   get:
 *     tags: [Events]
 *     summary: List registrants for an event (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: eventId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: List of volunteers }
 * /api/v1/events/{eventId}/volunteers/{volunteerId}:
 *   delete:
 *     tags: [Events]
 *     summary: Remove a registrant (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: eventId, required: true, schema: { type: string } }
 *       - { in: path, name: volunteerId, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Removed }
 *       404: { description: Not found }
 */
/**
 * Volunteer sign-ups for a specific event ("Register" button on the Events
 * page). Public: sign up. Admin: see who signed up for this event.
 * Mounted at /api/v1/events/:eventId/volunteers.
 */
export const eventVolunteersRouter = Router({ mergeParams: true });

eventVolunteersRouter.post(
  "/",
  validate(createEventVolunteerSchema),
  asyncHandler(async (req, res) => {
    const event = await EventModel.findById(req.params.eventId);
    if (!event) throw ApiError.notFound("Event not found");
    const created = await EventVolunteerModel.create({ ...req.validated, eventId: event.id });
    sendSuccess(res, { status: 201, message: "Signed up.", data: created });
  }),
);

eventVolunteersRouter.get(
  "/",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const volunteers = await EventVolunteerModel.list("event_id = $1", [req.params.eventId]);
    sendSuccess(res, { data: volunteers });
  }),
);

eventVolunteersRouter.delete(
  "/:volunteerId",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const removed = await EventVolunteerModel.remove(req.params.volunteerId);
    if (!removed) throw ApiError.notFound();
    res.status(204).send();
  }),
);
