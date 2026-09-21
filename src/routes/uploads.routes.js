import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { uploadBufferToCloudinary } from "../services/cloudinary.service.js";

/**
 * @openapi
 * /api/v1/uploads:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload a file (admin)
 *     description: >
 *       Shared by every module that needs an image or document — registration
 *       attachments, team member photos, ad creatives, blog cover images,
 *       event images. Returns a `url` to store on the owning resource.
 *       Allowed types: jpeg, png, webp, svg, gif, pdf.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 *                 publicId: { type: string }
 *                 mimeType: { type: string }
 *                 size: { type: integer }
 *       400: { description: No file received, or unsupported type }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * One shared upload endpoint used by every module that needs an image or
 * document — registration attachments, team member photos, ad creatives,
 * blog cover images, event images. Returns a `url` to store on the owning
 * resource (e.g. Ad.imageUrl, TeamMember.photo).
 * Mounted at /api/v1/uploads.
 */
export const uploadsRouter = Router();

uploadsRouter.post(
  "/",
  ...requireAdmin,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("No file received (expected field name 'file')");
    const result = await uploadBufferToCloudinary(req.file.buffer, { mimeType: req.file.mimetype });
    sendSuccess(res, {
      status: 201,
      message: "Uploaded.",
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
  }),
);
