import { Router } from "express";
import express from "express";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { DonationModel } from "../models/donation.model.js";
import { createDonationOrderSchema, verifyDonationSchema } from "../validators/donations.validator.js";
import { createRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature } from "../services/razorpay.service.js";

/**
 * @openapi
 * /api/v1/donations/create-order:
 *   post:
 *     tags: [Donations]
 *     summary: Create a Razorpay order for a donation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, cause, donorName]
 *             properties:
 *               amount: { type: number, description: Amount in rupees }
 *               cause: { type: string }
 *               donorName: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               anonymous: { type: boolean, default: false }
 *               wantReceipt: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string }
 *                 amount: { type: integer }
 *                 currency: { type: string }
 *                 keyId: { type: string }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 * /api/v1/donations/verify:
 *   post:
 *     tags: [Donations]
 *     summary: Verify a Razorpay payment signature
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpay_order_id, razorpay_payment_id, razorpay_signature]
 *             properties:
 *               razorpay_order_id: { type: string }
 *               razorpay_payment_id: { type: string }
 *               razorpay_signature: { type: string }
 *     responses:
 *       200: { description: Verified }
 *       400: { description: Signature mismatch or validation failed }
 * /api/v1/donations/feed:
 *   get:
 *     tags: [Donations]
 *     summary: Public live feed of recent paid donations (latest 20)
 *     responses:
 *       200: { description: Donation feed }
 * /api/v1/donations:
 *   get:
 *     tags: [Donations]
 *     summary: List donations (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [created, paid, failed] }
 *     responses:
 *       200: { description: List of donations }
 * /api/v1/donations/{id}/receipt:
 *   get:
 *     tags: [Donations]
 *     summary: Get an 80G-style receipt for a paid donation (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Receipt }
 *       404: { description: Not found, or not paid yet }
 * /api/v1/donations/webhook:
 *   post:
 *     tags: [Donations]
 *     summary: Razorpay webhook (payment.captured / payment.failed)
 *     description: Verified via the `x-razorpay-signature` header against the raw request body.
 *     responses:
 *       200: { description: Received }
 *       400: { description: Invalid webhook signature }
 */
/**
 * Real money flow. Order creation and signature verification talk to
 * Razorpay; a Donation record is persisted at every step.
 * Mounted at /api/v1/donations.
 */
export const donationsRouter = Router();

donationsRouter.post(
  "/create-order",
  validate(createDonationOrderSchema),
  asyncHandler(async (req, res) => {
    const { amount, cause, donorName, email, phone, anonymous, wantReceipt } = req.validated;

    const order = await createRazorpayOrder({
      amountInPaise: Math.round(amount * 100),
      receipt: `donation_${Date.now()}`,
      notes: { cause, donor_name: donorName, anonymous: String(anonymous) },
    });

    await DonationModel.create({
      amountInRupees: amount,
      cause,
      donorName,
      email,
      phone,
      anonymous,
      wantReceipt,
      razorpayOrderId: order.id,
      status: "created",
    });

    sendSuccess(res, {
      status: 201,
      message: "Order created.",
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: env.razorpay.keyId,
      },
    });
  }),
);

donationsRouter.post(
  "/verify",
  validate(verifyDonationSchema),
  asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.validated;

    const verified = verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!verified) {
      return res.status(400).json({ verified: false, message: "Signature mismatch" });
    }

    const donation = await DonationModel.findOne("razorpay_order_id = $1", [razorpay_order_id]);
    if (donation) {
      await DonationModel.update(donation.id, {
        status: "paid",
        razorpayPaymentId: razorpay_payment_id,
      });
    }

    sendSuccess(res, { message: "Verified.", data: { verified: true } });
  }),
);

donationsRouter.get(
  "/feed",
  asyncHandler(async (_req, res) => {
    const paid = await DonationModel.list("status = 'paid'");
    const feed = paid.slice(0, 20).map((d) => ({
      name: d.anonymous ? "Anonymous" : d.donorName,
      amount: d.amountInRupees,
      cause: d.cause,
      time: d.createdAt,
    }));
    sendSuccess(res, { data: feed });
  }),
);

donationsRouter.get(
  "/",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const items = status ? await DonationModel.list("status = $1", [status]) : await DonationModel.list();
    sendSuccess(res, { data: items });
  }),
);

donationsRouter.get(
  "/:id/receipt",
  ...requireAdmin,
  asyncHandler(async (req, res) => {
    const donation = await DonationModel.findById(req.params.id);
    if (!donation || donation.status !== "paid") throw ApiError.notFound();
    sendSuccess(res, {
      data: {
        receiptNo: `SSJ-${donation.id.slice(0, 8).toUpperCase()}`,
        donorName: donation.anonymous ? "Anonymous" : donation.donorName,
        amountInRupees: donation.amountInRupees,
        cause: donation.cause,
        paidAt: donation.updatedAt,
        paymentId: donation.razorpayPaymentId,
      },
    });
  }),
);

/**
 * Razorpay's webhook needs the RAW request body to verify its HMAC
 * signature, so this route must be mounted with `express.raw()` BEFORE the
 * app's global `express.json()` middleware — see app.js. Exported
 * separately from `donationsRouter` for that reason.
 */
export const donationsWebhookRouter = Router();

donationsWebhookRouter.post(
  "/donations/webhook",
  express.raw({ type: "*/*" }),
  asyncHandler(async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body.toString("utf-8");

    if (typeof signature !== "string" || !verifyWebhookSignature(rawBody, signature)) {
      throw ApiError.badRequest("Invalid webhook signature");
    }

    const event = JSON.parse(rawBody);
    const orderId = event?.payload?.payment?.entity?.order_id;
    const paymentId = event?.payload?.payment?.entity?.id;

    if (orderId) {
      const donation = await DonationModel.findOne("razorpay_order_id = $1", [orderId]);
      if (donation) {
        const status =
          event.event === "payment.captured" ? "paid" : event.event === "payment.failed" ? "failed" : donation.status;
        await DonationModel.update(donation.id, {
          status,
          razorpayPaymentId: paymentId ?? donation.razorpayPaymentId,
        });
      }
    }

    sendSuccess(res, { message: "Received.", data: { received: true, event: event.event } });
  }),
);
