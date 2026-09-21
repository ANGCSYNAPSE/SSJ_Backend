import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
});

/**
 * Streams a buffer (from multer's memory storage) up to Cloudinary. PDFs are
 * uploaded as `raw` resources since Cloudinary's `image` pipeline (transforms,
 * format conversion) doesn't apply to them.
 */
export function uploadBufferToCloudinary(buffer, { folder = "ssj", mimeType } = {}) {
  return new Promise((resolve, reject) => {
    const resourceType = mimeType === "application/pdf" ? "raw" : "image";
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
}
