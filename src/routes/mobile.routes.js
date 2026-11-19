import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { sql } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { validate } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import { NotificationModel } from "../models/notification.model.js";
import { sendOtpSms, smsAvailable } from "../services/sms.service.js";

/** Phone verification for the signed-in person. Mounted at /api/v1/me/mobile. */
export const mobileRouter = Router();

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_SECONDS = 45;
const MAX_SENDS_PER_HOUR = 5;

const verifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });

const hash = (userId, mobile, code) => createHmac("sha256", env.jwt.refreshSecret).update(`mobile:${userId}:${mobile}:${code}`).digest("hex");
const same = (a, b) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};
const mask = (mobile) => `${"•".repeat(Math.max(0, String(mobile).length - 3))}${String(mobile).slice(-3)}`;

/**
 * @openapi
 * /api/v1/me/mobile/send-otp:
 *   post:
 *     tags: [Account]
 *     summary: Text a 6-digit code to the signed-in person's mobile number
 *     description: "One code every 45 seconds, five an hour. The code is valid for 10 minutes. 503 when SMS is not switched on."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ sent, mobile (masked), minutes, resendAfterSeconds } or { alreadyVerified }" }
 *       429: { description: Too many requests }
 *       503: { description: SMS is not available }
 * /api/v1/me/mobile/verify-otp:
 *   post:
 *     tags: [Account]
 *     summary: Confirm the code that was texted; marks the phone verified
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ verified: true }" }
 *       400: { description: Wrong or expired code }
 */
mobileRouter.post(
  "/send-otp",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");
    if (user.mobileVerified) return sendSuccess(res, { message: "Your phone is already verified.", data: { alreadyVerified: true } });
    if (!smsAvailable()) throw ApiError.serviceUnavailable("Phone verification is not switched on yet. Please try again later.");

    const [row] = await sql(`SELECT *, EXTRACT(EPOCH FROM (NOW() - sent_at)) AS since_sent FROM mobile_otps WHERE user_id = $1`, [user.id]);
    if (row && Number(row.since_sent) < RESEND_AFTER_SECONDS) {
      const wait = Math.ceil(RESEND_AFTER_SECONDS - Number(row.since_sent));
      throw ApiError.tooManyRequests(`Please wait ${wait} seconds before asking for another code.`);
    }
    const [{ in_window }] = row
      ? await sql(`SELECT (NOW() - $1::timestamptz) < INTERVAL '1 hour' AS in_window`, [row.window_started_at])
      : [{ in_window: false }];
    if (row && in_window && row.send_count >= MAX_SENDS_PER_HOUR) {
      throw ApiError.tooManyRequests("Too many codes were requested. Please try again in an hour.");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await sendOtpSms({ to: user.mobile, code, minutes: OTP_MINUTES }); // nothing is stored if the text could not be sent

    await sql(
      `INSERT INTO mobile_otps (user_id, mobile, code_hash, expires_at, sent_at, send_count, window_started_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval, NOW(), 1, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         mobile = EXCLUDED.mobile, code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, sent_at = NOW(),
         send_count = CASE WHEN $5::boolean THEN mobile_otps.send_count + 1 ELSE 1 END,
         window_started_at = CASE WHEN $5::boolean THEN mobile_otps.window_started_at ELSE NOW() END`,
      [user.id, user.mobile, hash(user.id, user.mobile, code), String(OTP_MINUTES), Boolean(row && in_window)],
    );

    sendSuccess(res, {
      message: "We sent a code to your phone.",
      data: { sent: true, mobile: mask(user.mobile), minutes: OTP_MINUTES, resendAfterSeconds: RESEND_AFTER_SECONDS },
    });
  }),
);

mobileRouter.post(
  "/verify-otp",
  requireAuth,
  authLimiter,
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");
    if (user.mobileVerified) return sendSuccess(res, { message: "Your phone is already verified.", data: { verified: true } });

    const [otp] = await sql(`SELECT * FROM mobile_otps WHERE user_id = $1`, [user.id]);
    // A code sent to an earlier number is useless once the number has changed.
    if (!otp || otp.mobile !== user.mobile || new Date(otp.expires_at) < new Date()) {
      throw ApiError.badRequest("This code has expired. Please ask for a new one.");
    }
    if (otp.attempts >= MAX_ATTEMPTS) throw ApiError.tooManyRequests("Too many wrong codes. Please ask for a new one.");

    if (!same(hash(user.id, user.mobile, req.validated.code), otp.code_hash)) {
      await sql(`UPDATE mobile_otps SET attempts = attempts + 1 WHERE user_id = $1`, [user.id]);
      const left = MAX_ATTEMPTS - otp.attempts - 1;
      throw ApiError.badRequest(left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code is not right. Please ask for a new one.");
    }

    await sql(`UPDATE users SET mobile_verified_at = NOW() WHERE id = $1`, [user.id]);
    await sql(`DELETE FROM mobile_otps WHERE user_id = $1`, [user.id]);
    await NotificationModel.notify(user.id, {
      kind: "success",
      category: "registration",
      title: "Phone verified",
      message: "Your mobile number is verified. Thank you!",
      link: "/profile",
      dedupeKey: "mobile-verified",
    });
    sendSuccess(res, { message: "Phone verified.", data: { verified: true } });
  }),
);
