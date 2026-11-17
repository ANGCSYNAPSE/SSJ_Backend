import crypto from "node:crypto";
import express, { Router } from "express";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import { RegistrationPaymentModel } from "../models/registrationPayment.model.js";
import { PAYMENT_APP, PAYMENT_PURPOSE, REGISTRATION_PLANS, planById } from "../config/plans.js";
import {
  adminPaymentsQuerySchema,
  adminPendingQuerySchema,
  manualPaymentSchema,
  registrationOrderSchema,
  verifyRegistrationPaymentSchema,
} from "../validators/payments.validator.js";
import { createRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature } from "../services/razorpay.service.js";

/** The member's own registration fee. Mounted at /api/v1/payments. */
export const paymentsRouter = Router();

/** What the admin sees: who paid, how much, who has not. Mounted at /api/v1/admin/payments. */
export const adminPaymentsRouter = Router();

/** Razorpay's callback for registration payments (raw body, mounted before the JSON parser). */
export const registrationWebhookRouter = Router();

const money = (row) => ({
  id: row.id,
  plan: row.plan,
  amount: Number(row.amountInRupees),
  status: row.status,
  source: row.source,
  receipt: row.receipt,
  orderId: row.razorpayOrderId,
  paymentId: row.razorpayPaymentId,
  failureReason: row.failureReason,
  paidAt: row.paidAt,
  createdAt: row.createdAt,
});

/** "Paid" or "pending", with the details of the successful payment when there is one. */
export async function feeStatusFor(userId) {
  const paid = await RegistrationPaymentModel.findPaid(userId);
  return paid
    ? { status: "paid", plan: paid.plan, amount: Number(paid.amountInRupees), paidAt: paid.paidAt, receipt: paid.receipt }
    : { status: "pending", plan: null, amount: null, paidAt: null, receipt: null };
}

/**
 * @openapi
 * /api/v1/payments/plans:
 *   get:
 *     tags: [Payments]
 *     summary: The registration fee options (Rs 501 or Rs 1100)
 *     responses:
 *       200: { description: "[{ id, label, amount, description }]" }
 * /api/v1/payments/me:
 *   get:
 *     tags: [Payments]
 *     summary: Has the signed-in user paid the registration fee? Their attempts, newest first
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ fee: { status: paid|pending, plan, amount, paidAt }, plans, history[] }" }
 * /api/v1/payments/registration/order:
 *   post:
 *     tags: [Payments]
 *     summary: Start paying the registration fee (creates a Razorpay order)
 *     description: "Send { plan: basic|premium }. Pass the result to Razorpay Checkout, then call /verify."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ orderId, amount (paise), currency, keyId, plan, prefill }" }
 *       409: { description: Already paid }
 * /api/v1/payments/registration/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Confirm a payment Razorpay Checkout reports as done (signature is checked on the server)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ fee }" }
 *       400: { description: Signature mismatch }
 */
paymentsRouter.get("/plans", (_req, res) => {
  sendSuccess(res, { data: REGISTRATION_PLANS });
});

paymentsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [fee, history] = await Promise.all([feeStatusFor(req.user.id), RegistrationPaymentModel.listForUser(req.user.id)]);
    sendSuccess(res, { data: { fee, plans: REGISTRATION_PLANS, history: history.map(money) } });
  }),
);

paymentsRouter.post(
  "/registration/order",
  requireAuth,
  validate(registrationOrderSchema),
  asyncHandler(async (req, res) => {
    const plan = planById(req.validated.plan);
    if (await RegistrationPaymentModel.hasPaid(req.user.id)) {
      throw ApiError.conflict("You have already paid the registration fee.");
    }
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");

    // The receipt and notes mark this as a Shyam Jagat registration fee in the Razorpay dashboard,
    // and are what the webhook checks before it touches anything.
    const receipt = `SJ-REG-${req.user.id.slice(0, 8)}-${Date.now()}`;
    const order = await createRazorpayOrder({
      amountInPaise: plan.amount * 100,
      receipt,
      notes: { app: PAYMENT_APP, purpose: PAYMENT_PURPOSE, user_id: user.id, plan: plan.id, name: user.fullName },
    });

    await RegistrationPaymentModel.create({
      userId: user.id,
      plan: plan.id,
      amountInRupees: plan.amount,
      status: "created",
      receipt,
      razorpayOrderId: order.id,
      source: "razorpay",
    });

    sendSuccess(res, {
      status: 201,
      message: "Order created.",
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: env.razorpay.keyId,
        plan: plan.id,
        label: plan.label,
        prefill: { name: user.fullName, email: user.email, contact: user.mobile },
      },
    });
  }),
);

paymentsRouter.post(
  "/registration/verify",
  requireAuth,
  validate(verifyRegistrationPaymentSchema),
  asyncHandler(async (req, res) => {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.validated;

    // The order must be this user's own, so nobody can claim someone else's payment.
    const row = await RegistrationPaymentModel.findByOrderId(orderId);
    if (!row || row.userId !== req.user.id) throw ApiError.notFound("Payment not found.");

    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
      await RegistrationPaymentModel.markFailed(orderId, paymentId, "Signature mismatch");
      throw ApiError.badRequest("Payment could not be verified.");
    }

    await RegistrationPaymentModel.markPaid(orderId, paymentId);
    sendSuccess(res, { message: "Payment received. Thank you!", data: { fee: await feeStatusFor(req.user.id) } });
  }),
);

/**
 * Razorpay calls this whether or not the browser got back to us (closed tab, lost network), so
 * a paid registration is never lost. Only orders carrying our app + purpose notes and known to
 * our table are touched; anything else on the same Razorpay account is ignored.
 */
registrationWebhookRouter.post(
  "/payments/webhook",
  express.raw({ type: "*/*" }),
  asyncHandler(async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body.toString("utf-8");
    if (typeof signature !== "string" || !verifyWebhookSignature(rawBody, signature)) {
      throw ApiError.badRequest("Invalid webhook signature");
    }

    const event = JSON.parse(rawBody);
    const payment = event?.payload?.payment?.entity;
    const order = event?.payload?.order?.entity;
    const notes = payment?.notes ?? order?.notes ?? {};
    const orderId = payment?.order_id ?? order?.id;

    const isOurs = notes.app === PAYMENT_APP && notes.purpose === PAYMENT_PURPOSE;
    if (isOurs && orderId) {
      if (event.event === "payment.captured" || event.event === "order.paid") {
        await RegistrationPaymentModel.markPaid(orderId, payment?.id);
      } else if (event.event === "payment.failed") {
        await RegistrationPaymentModel.markFailed(orderId, payment?.id, payment?.error_description);
      }
    }
    sendSuccess(res, { message: "Received.", data: { received: true, event: event.event } });
  }),
);

/* ───────────────────────── Admin ───────────────────────── */

/**
 * @openapi
 * /api/v1/admin/payments/summary:
 *   get:
 *     tags: [Payments]
 *     summary: Registration fee totals (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ collected: { amount, payers, today }, byPlan[], pending: { users, failedAttempts, abandonedCheckouts }, collectionRate }" }
 * /api/v1/admin/payments:
 *   get:
 *     tags: [Payments]
 *     summary: Every payment attempt with the payer (admin)
 *     description: "Filters: status (created|paid|failed), plan (basic|premium|manual), userId, q (name, email or mobile), from, to, page, limit."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ items[], total, page, limit }" }
 * /api/v1/admin/payments/pending:
 *   get:
 *     tags: [Payments]
 *     summary: People who have not paid the registration fee yet (admin)
 *     description: Each with their registrations and last payment attempt. Filters q, page, limit.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ items[], total, page, limit }" }
 * /api/v1/admin/payments/manual:
 *   post:
 *     tags: [Payments]
 *     summary: Record a payment received outside Razorpay (UPI, cash, bank transfer) (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: The recorded payment }
 */
adminPaymentsRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await RegistrationPaymentModel.summary() });
  }),
);

adminPaymentsRouter.get(
  "/pending",
  validateQuery(adminPendingQuerySchema),
  asyncHandler(async (req, res) => {
    const { q, page, limit } = req.validatedQuery;
    const { items, total } = await RegistrationPaymentModel.listPendingUsers({ q, limit, offset: (page - 1) * limit });
    sendSuccess(res, { data: { items, total, page, limit } });
  }),
);

adminPaymentsRouter.get(
  "/",
  validateQuery(adminPaymentsQuerySchema),
  asyncHandler(async (req, res) => {
    const { page, limit, ...filters } = req.validatedQuery;
    const { items, total } = await RegistrationPaymentModel.listForAdmin({ ...filters, limit, offset: (page - 1) * limit });
    sendSuccess(res, { data: { items, total, page, limit } });
  }),
);

adminPaymentsRouter.post(
  "/manual",
  validate(manualPaymentSchema),
  asyncHandler(async (req, res) => {
    const { userId, amount, reference, note } = req.validated;
    const user = await UserModel.findById(userId);
    if (!user) throw ApiError.notFound("Account not found.");
    if (await RegistrationPaymentModel.hasPaid(userId)) throw ApiError.conflict("This person has already paid.");

    const row = await RegistrationPaymentModel.create({
      userId,
      plan: "manual",
      amountInRupees: amount,
      status: "paid",
      receipt: `SJ-MAN-${userId.slice(0, 8)}-${Date.now()}`,
      razorpayOrderId: `manual_${crypto.randomUUID()}`,
      razorpayPaymentId: reference,
      source: "manual",
      note: note ?? null,
      recordedBy: req.user.id,
      paidAt: new Date().toISOString(),
    });
    sendSuccess(res, { status: 201, message: "Payment recorded.", data: money(row) });
  }),
);
