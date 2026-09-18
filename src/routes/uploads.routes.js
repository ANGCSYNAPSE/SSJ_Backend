import { Router } from "express";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { publicUrlForUpload, upload } from "../middleware/upload.js";

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
    sendSuccess(res, {
      status: 201,
      message: "Uploaded.",
      data: {
        url: publicUrlForUpload(req.file.filename),
        filename: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
  }),
);
