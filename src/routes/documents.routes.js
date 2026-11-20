import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { buildDocument, documentPdf } from "../services/document.service.js";

/** A member's own receipts and invoice. Mounted at /api/v1/payments/documents. */
export const memberDocumentsRouter = Router();

/** Any member's (admin only). Mounted at /api/v1/admin/payments, before the other payment routes. */
export const adminDocumentsRouter = Router();

const querySchema = z.object({
  kind: z.enum(["receipt", "invoice"]).default("receipt"),
  format: z.enum(["pdf", "json"]).default("pdf"),
  download: z.enum(["1", "0"]).default("0"),
});

async function send(req, res, ownerId) {
  const { kind, format, download } = req.validatedQuery;
  if (!z.string().uuid().safeParse(req.params.id).success) throw ApiError.notFound("Payment not found.");
  const document = await buildDocument({ paymentId: req.params.id, kind, ownerId });
  if (format === "json") return sendSuccess(res, { data: document.data });

  const pdf = documentPdf(document);
  res
    .status(200)
    .set({
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `${download === "1" ? "attachment" : "inline"}; filename="${document.fileName}.pdf"`,
      "Cache-Control": "private, no-store",
    })
    .send(pdf);
}

/**
 * @openapi
 * /api/v1/payments/documents/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Your receipt for one paid payment, or your registration-fee invoice, as a PDF
 *     description: "Query: kind (receipt|invoice), format (pdf|json), download=1 to download instead of preview. Only your own payments."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The document }
 *       404: { description: Not your payment }
 * /api/v1/admin/payments/{id}/document:
 *   get:
 *     tags: [Payments]
 *     summary: The receipt or invoice for any member's paid payment (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The document }
 */
memberDocumentsRouter.get(
  "/:id",
  requireAuth,
  validateQuery(querySchema),
  asyncHandler((req, res) => send(req, res, req.user.id)),
);

adminDocumentsRouter.get(
  "/:id/document",
  validateQuery(querySchema),
  asyncHandler((req, res) => send(req, res, undefined)),
);
