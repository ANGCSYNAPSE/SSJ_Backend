import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { ContactSubmissionModel } from "../models/contactSubmission.model.js";
import { createContactSubmissionSchema } from "../validators/contact.validator.js";

/** Mounted at /api/v1/contact. */
export const contactRouter = Router();

contactRouter.post(
  "/",
  validate(createContactSubmissionSchema),
  asyncHandler(async (req, res) => {
    const created = await ContactSubmissionModel.create({ ...req.validated, isHandled: false });
    sendSuccess(res, { status: 201, message: "Submitted.", data: created });
  }),
);

contactRouter.get(
  "/",
  ...requireAdmin,
  asyncHandler(async (_req, res) => {
    const items = await ContactSubmissionModel.list();
    sendSuccess(res, { data: items });
  }),
);

contactRouter.patch(
  "/:id/handle",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const updated = await ContactSubmissionModel.update(req.params.id, { isHandled: true });
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Marked handled.", data: updated });
  }),
);

contactRouter.delete(
  "/:id",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const removed = await ContactSubmissionModel.remove(req.params.id);
    if (!removed) throw ApiError.notFound();
    res.status(204).send();
  }),
);
