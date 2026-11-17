import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { validate } from "../middleware/validate.js";
import { signupFlowLimiter as authLimiter } from "../middleware/rateLimiter.js";
import { signupSchema } from "../validators/auth.validator.js";
import { SignupService } from "../services/signup.service.js";
import { setRefreshCookie } from "../utils/tokens.js";

/**
 * Registration: details -> email code -> payment -> account. Mounted at /api/v1/auth/signup.
 * A person is only signed in (and an account only exists) at the end.
 */
export const signupFlowRouter = Router();

const pendingId = z.string().uuid("This registration is not valid. Please start again.");

const verifyOtpSchema = z.object({ pendingId, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code.") });
const resendSchema = z.object({ pendingId });
const channelSchema = z.enum(["email", "sms", "both"]).default("email");
const profileSchema = z.object({ pendingId, profile: z.record(z.unknown()) });
const orderSchema = z.object({
  pendingId,
  amount: z.number({ message: "Enter an amount in rupees." }).int("Enter a whole number of rupees.").positive(),
});
const payVerifySchema = z.object({
  pendingId,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

/** Ends the flow: the account exists, so hand back the session exactly like a login. */
function sendAccount(res, result) {
  setRefreshCookie(res, result.refreshToken);
  sendSuccess(res, {
    status: 201,
    message: "Account created successfully.",
    data: { user: result.user, accessToken: result.accessToken },
  });
}

/**
 * @openapi
 * /api/v1/auth/signup/start:
 *   post:
 *     tags: [Auth]
 *     summary: Step 1. Save the account details and send a 6-digit code (right after the first form step)
 *     description: Same body as the old signup, plus an optional channel (email, sms or both). For artists, temples and so on send the category and the account fields; the rest of the form follows after verification. Nothing is created yet. Returns { pendingId, email (masked), otpMinutes, resendAfterSeconds, fee }.
 *     responses:
 *       200: { description: Code sent }
 *       409: { description: Email or mobile already has an account }
 * /api/v1/auth/signup/resend:
 *   post:
 *     tags: [Auth]
 *     summary: Send a new code (45 seconds apart, at most 5 times)
 *     responses:
 *       200: { description: Sent }
 *       429: { description: Too soon or too many }
 * /api/v1/auth/signup/verify-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Step 2. Check the emailed code (5 tries per code, valid 10 minutes)
 *     responses:
 *       200: { description: "Verified, with the fee details for step 3" }
 *       400: { description: Wrong or expired code }
 * /api/v1/auth/signup/profile:
 *   post:
 *     tags: [Auth]
 *     summary: Step 3a. Save the artist / temple / ... details on a verified signup (after the form is finished)
 *     responses:
 *       200: { description: Saved }
 *       400: { description: Per-field validation errors }
 * /api/v1/auth/signup/pay/order:
 *   post:
 *     tags: [Auth]
 *     summary: Step 3. Create the payment order (at least Rs 501, at most the Rs 1100 fee)
 *     responses:
 *       201: { description: "{ orderId, amount, currency, keyId, prefill }" }
 * /api/v1/auth/signup/pay/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Step 4. Confirm the payment. Creates the account and signs the person in
 *     responses:
 *       201: { description: "{ user, accessToken } and the refresh cookie" }
 * /api/v1/auth/signup/complete:
 *   post:
 *     tags: [Auth]
 *     summary: Create the account for a verified signup that has already paid (someone who returned after paying)
 *     responses:
 *       201: { description: "{ user, accessToken }" }
 */
signupFlowRouter.post(
  "/start",
  authLimiter,
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const channel = channelSchema.parse(req.body?.channel);
    sendSuccess(res, { message: "We have sent you a code.", data: await SignupService.start(req.validated, channel) });
  }),
);

signupFlowRouter.post(
  "/resend",
  authLimiter,
  validate(resendSchema),
  asyncHandler(async (req, res) => {
    const channel = channelSchema.parse(req.body?.channel);
    sendSuccess(res, { message: "A new code is on its way.", data: await SignupService.resend(req.validated.pendingId, channel) });
  }),
);

signupFlowRouter.post(
  "/verify-otp",
  authLimiter,
  validate(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    const { pendingId: id, code } = req.validated;
    sendSuccess(res, { message: "Email verified.", data: await SignupService.verifyOtp(id, code) });
  }),
);

signupFlowRouter.post(
  "/profile",
  authLimiter,
  validate(profileSchema),
  asyncHandler(async (req, res) => {
    sendSuccess(res, { message: "Details saved.", data: await SignupService.setProfile(req.validated.pendingId, req.validated.profile) });
  }),
);

signupFlowRouter.post(
  "/pay/order",
  authLimiter,
  validate(orderSchema),
  asyncHandler(async (req, res) => {
    const { pendingId: id, amount } = req.validated;
    sendSuccess(res, { status: 201, message: "Order created.", data: await SignupService.createPaymentOrder(id, amount) });
  }),
);

signupFlowRouter.post(
  "/pay/verify",
  authLimiter,
  validate(payVerifySchema),
  asyncHandler(async (req, res) => {
    const { pendingId: id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.validated;
    sendAccount(
      res,
      await SignupService.verifyPayment(id, { orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature }),
    );
  }),
);

signupFlowRouter.post(
  "/complete",
  authLimiter,
  validate(resendSchema),
  asyncHandler(async (req, res) => {
    sendAccount(res, await SignupService.complete(req.validated.pendingId));
  }),
);
