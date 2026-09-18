import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { buildCrudRouter } from "../utils/crudRouter.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { EventModel, EventVolunteerModel } from "../models/event.model.js";
import { createEventSchema, createEventVolunteerSchema, updateEventSchema } from "../validators/events.validator.js";

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
