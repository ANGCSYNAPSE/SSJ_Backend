import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { RegistrationModel } from "../models/registration.model.js";
import {
  createRegistrationSchema,
  registrationQuerySchema,
  updateRegistrationSchema,
} from "../validators/registrations.validator.js";

/**
 * Covers all 6 registration forms (artist, dancer, musician, temple,
 * dharamshala, mandal). Public: submit only. Everything else — list,
 * filter, view, edit, verify, reject, block, delete — is admin-only.
 * Mounted at /api/v1/registrations.
 */
export const registrationsRouter = Router();

registrationsRouter.get(
  "/public",
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    if (!type) throw ApiError.badRequest("type is required");
    const items = await RegistrationModel.list("type = $1 AND status = 'approved'", [type]);
    sendSuccess(res, { data: items.map(({ adminNote: _adminNote, ...publicItem }) => publicItem) });
  }),
);

registrationsRouter.post(
  "/",
  validate(createRegistrationSchema),
  asyncHandler(async (req, res) => {
    const created = await RegistrationModel.create({ ...req.validated, status: "pending" });
    sendSuccess(res, { status: 201, message: "Submitted, pending admin verification.", data: created });
  }),
);

registrationsRouter.get(
  "/",
  ...requireAdmin,
  validateQuery(registrationQuerySchema),
  asyncHandler(async (req, res) => {
    const { type, status } = req.validatedQuery;
    const conditions = [];
    const params = [];
    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const items = await RegistrationModel.list(conditions.join(" AND "), params);
    sendSuccess(res, { data: items });
  }),
);

registrationsRouter.get(
  "/:id",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const item = await RegistrationModel.findById(req.params.id);
    if (!item) throw ApiError.notFound();
    sendSuccess(res, { data: item });
  }),
);

registrationsRouter.patch(
  "/:id",
  ...requireAdmin,
  validate(updateRegistrationSchema),
  asyncHandler(async (req, res) => {
    const updated = await RegistrationModel.update(req.params.id, req.validated);
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Updated.", data: updated });
  }),
);

function statusAction(action, status) {
  registrationsRouter.patch(
    `/:id/${action}`,
    ...requireAdmin,
    asyncHandler(async (req, res) => {
      const updated = await RegistrationModel.update(req.params.id, {
        status,
        adminNote: typeof req.body?.adminNote === "string" ? req.body.adminNote : undefined,
      });
      if (!updated) throw ApiError.notFound();
      sendSuccess(res, { message: "Updated.", data: updated });
    }),
  );
}

statusAction("verify", "approved");
statusAction("reject", "rejected");
statusAction("block", "blocked");
statusAction("unblock", "approved");

registrationsRouter.delete(
  "/:id",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const removed = await RegistrationModel.remove(req.params.id);
    if (!removed) throw ApiError.notFound();
    res.status(204).send();
  }),
);
