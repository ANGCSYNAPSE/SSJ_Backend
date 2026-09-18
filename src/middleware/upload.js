import { randomUUID } from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const UPLOAD_ROOT = path.join(process.cwd(), env.uploads.dir);

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "application/pdf",
]);

function ensureUploadRoot() {
  if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadRoot();
    cb(null, UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

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

/** URL the frontend can use to fetch an uploaded file, e.g. as Ad.imageUrl. */
export function publicUrlForUpload(filename) {
  return `/uploads/${filename}`;
}

export const uploadRoot = UPLOAD_ROOT;
