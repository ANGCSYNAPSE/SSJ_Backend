import { Router } from "express";
import { contactLimiter } from "../middleware/rateLimiter.js";
import { sendContactMessageEmail } from "../services/mail.service.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { validate } from "../middleware/validate.js";
import { ContactSubmissionModel } from "../models/contactSubmission.model.js";
import { createContactSubmissionSchema } from "../validators/contact.validator.js";

/**
 * @openapi
 * /api/v1/contact:
 *   post:
 *     tags: [Contact]
 *     summary: Submit a contact form
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, message]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               subject: { type: string }
 *               message: { type: string }
 *     responses:
 *       201: { description: Submitted }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/admin/contact:
 *   get:
 *     tags: [Contact]
 *     summary: List contact submissions (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of submissions }
 * /api/v1/admin/contact/{id}/handle:
 *   patch:
 *     tags: [Contact]
 *     summary: Mark a submission handled (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Marked handled }
 *       404: { description: Not found }
 * /api/v1/admin/contact/{id}:
 *   delete:
 *     tags: [Contact]
 *     summary: Delete a submission (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       204: { description: Deleted }
 *       404: { description: Not found }
 */
/** Public submit form. Mounted at /api/v1/contact. */
export const contactRouter = Router();

/** Reading and managing submissions. Mounted at /api/v1/admin/contact. */
export const adminContactRouter = Router();

contactRouter.post(
  "/",
  contactLimiter,
  validate(createContactSubmissionSchema),
  asyncHandler(async (req, res) => {
    const created = await ContactSubmissionModel.create({ ...req.validated, isHandled: false });
    // The message is saved first (it shows in the admin's Contact inquiries), so a problem with email never loses it.
    try {
      await sendContactMessageEmail({ ...req.validated, receivedAt: created.createdAt });
    } catch (error) {
      console.error("[contact] message saved but the email to the team failed:", error.message);
    }
    sendSuccess(res, { status: 201, message: "Thank you! We have received your message.", data: { id: created.id } });
  }),
);

adminContactRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const items = await ContactSubmissionModel.list();
    sendSuccess(res, { data: items });
  }),
);

adminContactRouter.patch(
  "/:id/handle",
  asyncHandler(async (req, res) => {
    const updated = await ContactSubmissionModel.update(req.params.id, { isHandled: true });
    if (!updated) throw ApiError.notFound();
    sendSuccess(res, { message: "Marked handled.", data: updated });
  }),
);

adminContactRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const removed = await ContactSubmissionModel.remove(req.params.id);
    if (!removed) throw ApiError.notFound();
    res.status(204).send();
  }),
);
