import multer from "multer";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "application/pdf",
]);

// Buffered in memory rather than written to disk — the route handler streams
// the buffer straight to Cloudinary, since local disk storage doesn't
// survive between requests on serverless hosts like Vercel.
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: env.uploads.maxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
    }
    return cb(null, true);
  },
});
