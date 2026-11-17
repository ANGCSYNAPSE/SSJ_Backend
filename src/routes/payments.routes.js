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
import { PAYMENT_APP, PAYMENT_PURPOSE, REGISTRATION_FEE, allowedPayment, feeState } from "../config/plans.js";
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

/**
 * Where a person stands on the registration fee: how much is paid, what is left, and what they
 * may pay next. `status` is pending (nothing paid), partial (part paid) or paid (all of it).
 */
export async function feeStatusFor(userId) {
  const { paid, lastPaidAt, lastReceipt } = await RegistrationPaymentModel.paidSummary(userId);
  const next = allowedPayment(paid);
  return {
    status: feeState(paid),
    total: REGISTRATION_FEE.total,
    minimum: REGISTRATION_FEE.minimum,
    paid,
    balance: next.balance,
    nextMin: next.min,
    nextMax: next.max,
    lastPaidAt,
    receipt: lastReceipt,
  };
}

/**
 * @openapi
 * /api/v1/payments/fee:
 *   get:
 *     tags: [Payments]
 *     summary: The registration fee rules (total Rs 1100, first payment at least Rs 501)
 *     responses:
 *       200: { description: "{ total, minimum }" }
 * /api/v1/payments/me:
 *   get:
 *     tags: [Payments]
 *     summary: Where the signed-in user stands on the registration fee, and their payment attempts
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ fee: { status: pending|partial|paid, total, paid, balance, nextMin, nextMax }, history[] }" }
 * /api/v1/payments/registration/order:
 *   post:
 *     tags: [Payments]
 *     summary: Pay towards the registration fee (creates a Razorpay order)
 *     description: "Send { amount } in rupees: at least nextMin and at most nextMax from /payments/me (the first payment is at least Rs 501; the balance can be paid later). Pass the result to Razorpay Checkout, then call /verify."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ orderId, amount (paise), currency, keyId, prefill }" }
 *       400: { description: Amount outside what is allowed }
 *       409: { description: Fee already paid in full }
 * /api/v1/payments/registration/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Confirm a payment Razorpay Checkout reports as done (signature is checked on the server)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ fee }" }
 *       400: { description: Signature mismatch }
 */
paymentsRouter.get("/fee", (_req, res) => {
  sendSuccess(res, { data: REGISTRATION_FEE });
});

paymentsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [fee, history] = await Promise.all([feeStatusFor(req.user.id), RegistrationPaymentModel.listForUser(req.user.id)]);
    sendSuccess(res, { data: { fee, history: history.map(money) } });
  }),
);

paymentsRouter.post(
  "/registration/order",
  requireAuth,
  validate(registrationOrderSchema),
  asyncHandler(async (req, res) => {
    const { amount } = req.validated;
    const user = await UserModel.findById(req.user.id);
    if (!user) throw ApiError.notFound("Account not found.");

    const { paid } = await RegistrationPaymentModel.paidSummary(user.id);
    const next = allowedPayment(paid);
    if (next.balance <= 0) throw ApiError.conflict("The registration fee is already paid in full.");
    if (amount > next.max) throw ApiError.badRequest(`Only ₹${next.max} is still due.`);
    if (amount < next.min) {
      throw ApiError.badRequest(
        next.min === next.balance
          ? `Please pay the remaining ₹${next.balance}.`
          : `The minimum payment is ₹${next.min}.`,
      );
    }
    const kind = amount === next.balance ? "full" : "part";

    // The receipt and notes mark this as a Shyam Jagat registration fee in the Razorpay dashboard,
    // and are what the webhook checks before it touches anything.
    const receipt = `SJ-REG-${user.id.slice(0, 8)}-${Date.now()}`;
    const order = await createRazorpayOrder({
      amountInPaise: amount * 100,
      receipt,
      notes: { app: PAYMENT_APP, purpose: PAYMENT_PURPOSE, user_id: user.id, kind, name: user.fullName },
    });

    await RegistrationPaymentModel.create({
      userId: user.id,
      plan: kind,
      amountInRupees: amount,
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
        kind,
        label: kind === "full" ? "Registration fee" : "Registration fee (part payment)",
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
 *     summary: "Registration fee totals - collected, members fully paid / part paid / unpaid, outstanding balance (admin)"
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ fee, collected: { amount, payments, today }, members: { total, fullyPaid, partial, unpaid }, outstanding: { amount, failedAttempts, abandonedCheckouts }, collectionRate }" }
 * /api/v1/admin/payments:
 *   get:
 *     tags: [Payments]
 *     summary: Every payment attempt with the payer (admin)
 *     description: "Filters: status (created|paid|failed), plan (part|full|manual), userId, q (name, email or mobile), from, to, page, limit."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ items[], total, page, limit }" }
 * /api/v1/admin/payments/pending:
 *   get:
 *     tags: [Payments]
 *     summary: People who still owe something on the registration fee (admin)
 *     description: "Each with paid so far, balance, their registrations and last payment attempt. Filters: state (pending = nothing paid, partial = part paid), q, page, limit."
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
    const { q, state, page, limit } = req.validatedQuery;
    const { items, total } = await RegistrationPaymentModel.listOwingUsers({ q, state, limit, offset: (page - 1) * limit });
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
    const { paid } = await RegistrationPaymentModel.paidSummary(userId);
    const { balance } = allowedPayment(paid);
    if (balance <= 0) throw ApiError.conflict("This person has already paid in full.");
    if (amount > balance) throw ApiError.badRequest(`Only ₹${balance} is still due.`);

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
