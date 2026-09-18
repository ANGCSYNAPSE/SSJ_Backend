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
 * @openapi
 * /api/v1/registrations/public:
 *   get:
 *     tags: [Registrations]
 *     summary: List approved registrations of a given type (public)
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] }
 *     responses:
 *       200: { description: List of approved registrations }
 *       400: { description: type is required }
 * /api/v1/registrations:
 *   post:
 *     tags: [Registrations]
 *     summary: Submit a registration (public)
 *     description: Covers all 6 registration forms. New submissions start as `pending`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, fullName, email, phone]
 *             properties:
 *               type: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] }
 *               fullName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               details: { type: object, description: Type-specific fields }
 *               attachments: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Submitted, pending admin verification }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *   get:
 *     tags: [Registrations]
 *     summary: List/filter registrations (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [artist, dancer, musician, temple, dharamshala, mandal] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, blocked] }
 *     responses:
 *       200: { description: List of registrations }
 * /api/v1/registrations/{id}:
 *   get:
 *     tags: [Registrations]
 *     summary: Get a registration by id (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Found }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Registrations]
 *     summary: Edit a registration (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *   delete:
 *     tags: [Registrations]
 *     summary: Delete a registration (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 * /api/v1/registrations/{id}/verify:
 *   patch:
 *     tags: [Registrations]
 *     summary: Approve a registration (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { adminNote: { type: string } } }
 *     responses:
 *       200: { description: Approved }
 *       404: { description: Not found }
 * /api/v1/registrations/{id}/reject:
 *   patch:
 *     tags: [Registrations]
 *     summary: Reject a registration (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Rejected }
 *       404: { description: Not found }
 * /api/v1/registrations/{id}/block:
 *   patch:
 *     tags: [Registrations]
 *     summary: Block a previously approved registration (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Blocked }
 *       404: { description: Not found }
 * /api/v1/registrations/{id}/unblock:
 *   patch:
 *     tags: [Registrations]
 *     summary: Unblock a registration, restoring it to approved (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Unblocked }
 *       404: { description: Not found }
 */
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
