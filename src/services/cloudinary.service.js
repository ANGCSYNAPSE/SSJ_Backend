import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
});

/** Cloudinary files images, audio/video and everything else (PDF, Word) under different resource types. */
function resourceTypeFor(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) return "video";
  return "raw";
}

/** Raw files keep whatever public_id they're given, so it must carry the extension to open correctly. */
const RAW_EXTENSIONS = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/**
 * Streams a buffer (from multer's memory storage) up to Cloudinary. Documents
 * are uploaded as `raw` resources since Cloudinary's `image` pipeline
 * (transforms, format conversion) doesn't apply to them.
 */
export function uploadBufferToCloudinary(buffer, { folder = "ssj", mimeType } = {}) {
  return new Promise((resolve, reject) => {
    const resourceType = resourceTypeFor(mimeType);
    const options = { folder, resource_type: resourceType };
    if (resourceType === "raw" && RAW_EXTENSIONS[mimeType]) {
      options.public_id = `${randomUUID()}.${RAW_EXTENSIONS[mimeType]}`;
    }
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
}
