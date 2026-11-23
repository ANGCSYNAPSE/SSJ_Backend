import crypto from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { UserModel } from "../models/user.model.js";
import { VolunteerModel } from "../models/volunteer.model.js";
import { RegistrationPaymentModel } from "../models/registrationPayment.model.js";
import { NotificationModel } from "../models/notification.model.js";
import {
  DEFAULT_REGISTRATION_FEE,
  PAYMENT_APP,
  PAYMENT_PURPOSE,
  allowedPayment,
  feeState,
  getRegistrationFee,
  registrationFeeHistory,
  saveRegistrationFee,
} from "../config/plans.js";
import { env, isProduction } from "../config/env.js";
import { sendRefundEmail } from "../services/mail.service.js";
import { emailRegistrationReceipt } from "../services/receipt.service.js";
import {
  feeSettingsSchema,
  adminPaymentsQuerySchema,
  adminPendingQuerySchema,
  manualPaymentSchema,
  refundSchema,
  refundFeeSchema,
  registrationOrderSchema,
  verifyRegistrationPaymentSchema,
} from "../validators/payments.validator.js";
import {
  confirmPayment,
  createRazorpayOrder,
  fetchOrderPayments,
  razorpayConfigured,
  refundRazorpayPayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "../services/razorpay.service.js";

/** The member's own registration fee. Mounted at /api/v1/payments. */
export const paymentsRouter = Router();

/** What the admin sees: who paid, how much, who has not. Mounted at /api/v1/admin/payments. */
export const adminPaymentsRouter = Router();

/** Razorpay's callback for registration payments (raw body, mounted before the JSON parser). */
export const registrationWebhookRouter = Router();

/** "Payment received" in the person's bell, once per order (the browser and the webhook may both report it). */
async function notifyPaid(row) {
  if (!row?.userId) return;
  await NotificationModel.notify(row.userId, {
    kind: "success",
    category: "payment",
    title: "Payment received",
    message: `We received ₹${Number(row.amountInRupees).toLocaleString("en-IN")} towards your registration fee. Thank you!`,
    link: "/profile",
    dedupeKey: `payment:${row.razorpayOrderId}`,
  });
  // And the receipt by email, once per payment (the browser, the webhook and a reconcile may all report it).
  await emailRegistrationReceipt(row.id);
}

/** "Refund on its way": a note in the person's bell and an email, once per refund. */
async function notifyRefund(row, amount, refundId, { manual = false } = {}) {
  if (!row?.userId) return;
  await NotificationModel.notify(row.userId, {
    kind: "info",
    category: "payment",
    title: "Refund initiated",
    message: `A refund of ₹${Number(amount).toLocaleString("en-IN")} has been started to your original payment method. It usually reaches you in 5 to 7 working days.`,
    link: "/profile",
    dedupeKey: `refund:${refundId ?? `${row.id}:${amount}:${Date.now()}`}`,
  });

  // The email never undoes a refund that has already been made.
  try {
    const user = await UserModel.findById(row.userId);
    if (!user) return;
    const fee = await feeStatusFor(row.userId);
    await sendRefundEmail({ to: user.email, fullName: user.fullName, amount, refundId, paid: fee.paid, balance: fee.balance, manual });
  } catch (error) {
    console.error("[mail] refund email not sent:", error.message);
  }
}

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
  refunded: Number(row.refundedAmount ?? 0),
});

/**
 * Where a person stands on the registration fee: how much is paid, what is left, and what they
 * may pay next. `status` is pending (nothing paid), partial (part paid) or paid (all of it).
 */
export async function feeStatusFor(userId) {
  const { paid, lastPaidAt, lastReceipt } = await RegistrationPaymentModel.paidSummary(userId);
  const rules = await getRegistrationFee();
  const next = allowedPayment(paid, rules);
  // A volunteer who has paid nothing owes nothing: their account is free, and paying is their choice.
  const free = paid <= 0 && Boolean(await VolunteerModel.findByUser(userId));
  return {
    status: free ? "free" : feeState(paid, rules),
    total: rules.total,
    minimum: rules.minimum,
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
paymentsRouter.get(
  "/fee",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { data: await getRegistrationFee() });
  }),
);

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
    const next = allowedPayment(paid, await getRegistrationFee());
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

    // A valid signature proves the ids belong together; only Razorpay's own payment status proves the money moved.
    const check = await confirmPayment({ orderId, paymentId, amountInPaise: Math.round(Number(row.amountInRupees) * 100) });
    if (check.state === "mismatch") {
      await RegistrationPaymentModel.markFailed(orderId, paymentId, "Payment did not match the order");
      throw ApiError.badRequest("Payment could not be verified.");
    }
    if (check.state !== "captured") {
      // Not confirmed yet (or Razorpay could not be asked): leave it pending. The webhook, or the admin's
      // Reconcile button, finishes it, so a paid member is never lost and an unpaid one is never counted.
      return sendSuccess(res, {
        status: 202,
        message: "Your payment is being confirmed. It will appear on your profile shortly.",
        data: { fee: await feeStatusFor(req.user.id), confirming: true },
      });
    }

    await notifyPaid(await RegistrationPaymentModel.markPaid(orderId, paymentId));
    sendSuccess(res, { message: "Payment received. Thank you!", data: { fee: await feeStatusFor(req.user.id), confirming: false } });
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
        // Only an order we created, paid for at least the amount we asked for (a customer-borne Razorpay fee makes it a little more).
        const row = await RegistrationPaymentModel.findByOrderId(orderId);
        const paidPaise = Number(payment?.amount ?? order?.amount_paid);
        if (row && paidPaise >= Math.round(Number(row.amountInRupees) * 100)) {
          await notifyPaid(await RegistrationPaymentModel.markPaid(orderId, payment?.id));
        }
      } else if (event.event === "payment.failed") {
        await RegistrationPaymentModel.markFailed(orderId, payment?.id, payment?.error_description);
      }
    }
    if (["refund.created", "refund.processed", "refund.failed"].includes(event.event)) {
      const refund = event?.payload?.refund?.entity;
      const row = refund?.payment_id ? await RegistrationPaymentModel.findByRazorpayPaymentId(refund.payment_id) : null;
      // Only payments in our own table: anything else on the shared Razorpay account is not ours to touch.
      if (row && refund?.id) {
        const amount = Number(refund.amount) / 100;
        const status = event.event === "refund.failed" ? "failed" : event.event === "refund.processed" ? "processed" : "pending";
        const { inserted } = await RegistrationPaymentModel.recordRefund({
          paymentId: row.id,
          refundId: refund.id,
          amount,
          status,
          source: "dashboard",
        });
        if (inserted && status !== "failed") await notifyRefund(row, amount, refund.id);
        if (!inserted && status !== "pending") await RegistrationPaymentModel.settleRefund(refund.id, status);
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
/**
 * @openapi
 * /api/v1/admin/payments/{id}/refund:
 *   post:
 *     tags: [Payments]
 *     summary: Refund some or all of a paid registration fee (admin)
 *     description: "Body: { amount?, reason }. Leave amount out to refund what is left. Razorpay payments are refunded through Razorpay (5-7 working days to the customer; Razorpay does not return its own fee). Manual payments are only recorded here: the money is returned by the admin outside Razorpay."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ payment, refund, fee, belowMinimum }" }
 *       400: { description: Not refundable, or Razorpay refused }
 *       404: { description: Unknown payment }
 *       502: { description: Razorpay could not be reached; nothing changed }
 * /api/v1/admin/payments/{id}/refunds:
 *   get:
 *     tags: [Payments]
 *     summary: Every refund made against one payment (admin)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "[{ id, refundId, amount, status, source, reason, createdAt, by }]" }
 */
/**
 * Refunds `amount` of one paid payment: through Razorpay for a real online payment, or only in the records for an
 * offline one or a leftover test payment. Returns what happened; the person is told once, unless `notify` is false
 * (a refund across several payments sends one combined message instead).
 */
async function refundOnePayment(row, amount, reason, adminId, { notify = true } = {}) {
  // Leftovers of the old dummy checkout (pay_mock_... / order_mock_...) never existed at Razorpay, so there is
  // nothing to refund there: the refund is only recorded here.
  const isMock = /^pay_mock_/.test(row.razorpayPaymentId ?? "") || /^order_mock_/.test(row.razorpayOrderId ?? "");

  let refundId = null;
  let status = "processed";
  if (row.source === "razorpay" && !isMock) {
    if (!row.razorpayPaymentId) throw ApiError.badRequest("This payment has no Razorpay payment id, so it cannot be refunded through Razorpay.");
    const refund = await refundRazorpayPayment({
      paymentId: row.razorpayPaymentId,
      amountInPaise: Math.round(amount * 100),
      notes: { app: PAYMENT_APP, purpose: "registration_fee_refund", reason: reason.slice(0, 200) },
      receipt: `SJ-RFD-${Date.now().toString(36)}`,
    });
    refundId = refund.id;
    status = refund.status;
  }

  const { inserted } = await RegistrationPaymentModel.recordRefund({
    paymentId: row.id,
    refundId,
    amount,
    status,
    source: row.source === "razorpay" && !isMock ? "admin" : "manual",
    reason,
    createdBy: adminId,
  });
  if (inserted && notify) await notifyRefund(row, amount, refundId, { manual: row.source !== "razorpay" });
  else if (!inserted && refundId && status !== "pending") await RegistrationPaymentModel.settleRefund(refundId, status);

  return { refundId, status, isMock };
}

const leftOf = (row) => Math.round((Number(row.amountInRupees) - Number(row.refundedAmount ?? 0)) * 100) / 100;

adminPaymentsRouter.post(
  "/:id/refund",
  validate(refundSchema),
  asyncHandler(async (req, res) => {
    const row = z.string().uuid().safeParse(req.params.id).success ? await RegistrationPaymentModel.findById(req.params.id) : null;
    if (!row) throw ApiError.notFound("Payment not found.");
    if (row.status !== "paid") throw ApiError.badRequest("Only a payment that was received can be refunded.");

    const left = leftOf(row);
    if (left <= 0) throw ApiError.badRequest("This payment has already been fully refunded.");
    const amount = req.validated.amount ?? left;
    if (amount > left) throw ApiError.badRequest(`At most ₹${left.toLocaleString("en-IN")} can still be refunded on this payment.`);

    const { refundId, status, isMock } = await refundOnePayment(row, amount, req.validated.reason, req.user.id);

    const updated = await RegistrationPaymentModel.findById(row.id);
    const fee = await feeStatusFor(row.userId);
    sendSuccess(res, {
      message: isMock
        ? `Refund of ₹${amount.toLocaleString("en-IN")} recorded. This was a test payment from the old dummy checkout, so nothing was sent to Razorpay; the member was notified.`
        : row.source === "razorpay" ? `Refund of ₹${amount.toLocaleString("en-IN")} started. The customer receives it in 5 to 7 working days.` : `Refund of ₹${amount.toLocaleString("en-IN")} recorded.`,
      data: {
        payment: money(updated),
        refund: { id: refundId, amount, status },
        fee,
        // The person has fallen below the minimum fee: the admin may want to un-verify or message them.
        belowMinimum: fee.paid < fee.minimum,
      },
    });
  }),
);

/**
 * @openapi
 * /api/v1/admin/payments/refund-fee:
 *   post:
 *     tags: [Payments]
 *     summary: Refund some or all of everything one person has paid, across their payments (admin)
 *     description: "Body: { userId, amount?, reason }. Leave amount out to refund everything still refundable. The refund is taken from their newest payments first, each refunded the same way a single payment is. The person gets one combined message."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ refunds[], total, fee, belowMinimum }" }
 *       400: { description: Nothing to refund, too much asked, or Razorpay refused part-way (what was done stays done) }
 */
adminPaymentsRouter.post(
  "/refund-fee",
  validate(refundFeeSchema),
  asyncHandler(async (req, res) => {
    const { userId, reason } = req.validated;
    const payments = (await RegistrationPaymentModel.listForUser(userId))
      .filter((p) => p.status === "paid" && leftOf(p) > 0)
      .sort((x, y) => new Date(y.paidAt ?? y.createdAt) - new Date(x.paidAt ?? x.createdAt));
    const totalLeft = Math.round(payments.reduce((sum, p) => sum + leftOf(p), 0) * 100) / 100;
    if (totalLeft <= 0) throw ApiError.badRequest("There is nothing left to refund for this person.");
    const amount = req.validated.amount ?? totalLeft;
    if (amount > totalLeft) throw ApiError.badRequest(`At most ₹${totalLeft.toLocaleString("en-IN")} can still be refunded for this person.`);

    // Newest payments first: each gives back what it can until the amount is covered.
    const done = [];
    let remaining = amount;
    let stopped = null;
    for (const payment of payments) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, leftOf(payment));
      try {
        const result = await refundOnePayment(payment, take, reason, req.user.id, { notify: false });
        done.push({ paymentId: payment.id, amount: take, id: result.refundId, status: result.status, source: payment.source });
        remaining = Math.round((remaining - take) * 100) / 100;
      } catch (error) {
        stopped = error;
        break;
      }
    }

    const refundedTotal = Math.round(done.reduce((sum, d) => sum + d.amount, 0) * 100) / 100;
    if (refundedTotal > 0) {
      // One message for the whole refund, not one per payment.
      await notifyRefund({ id: done[0].paymentId, userId }, refundedTotal, `fee:${done[0].id ?? done[0].paymentId}:${done.length}`, { manual: done.every((d) => d.source !== "razorpay") });
    }
    if (stopped) {
      if (done.length === 0) throw stopped;
      throw ApiError.badRequest(`₹${refundedTotal.toLocaleString("en-IN")} was refunded on ${done.length} payment${done.length === 1 ? "" : "s"}, then it stopped: ${stopped.message} What was refunded stays refunded; you can try the rest again.`);
    }

    const fee = await feeStatusFor(userId);
    sendSuccess(res, {
      message: `Refund of ₹${refundedTotal.toLocaleString("en-IN")} started across ${done.length} payment${done.length === 1 ? "" : "s"}.`,
      data: { refunds: done, total: refundedTotal, fee, belowMinimum: fee.paid < fee.minimum },
    });
  }),
);

adminPaymentsRouter.get(
  "/:id/refunds",
  asyncHandler(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) throw ApiError.notFound("Payment not found.");
    sendSuccess(res, { data: await RegistrationPaymentModel.listRefunds(req.params.id) });
  }),
);

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
    const { balance } = allowedPayment(paid, await getRegistrationFee());
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
    await notifyPaid(row);
    sendSuccess(res, { status: 201, message: "Payment recorded.", data: money(row) });
  }),
);

/* ───────── Admin: the fee and the Razorpay connection ───────── */

/**
 * @openapi
 * /api/v1/admin/payments/settings:
 *   get:
 *     tags: [Payments]
 *     summary: The current registration fee and who last changed it (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ fee: { total, minimum }, defaults, updatedAt, updatedBy }" }
 *   put:
 *     tags: [Payments]
 *     summary: Change the registration fee (admin). Takes effect straight away.
 *     description: "Send { total, minimum } in whole rupees. People who have already paid keep what they paid; a lower total can make part-paid members fully paid."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The new fee }
 *       400: { description: Invalid amounts }
 * /api/v1/admin/payments/diagnostics:
 *   get:
 *     tags: [Payments]
 *     summary: Is Razorpay connected? Keys set, test or live mode, and a harmless call to Razorpay (admin)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ keys, mode, warnings[], apiCheck }" }
 */
adminPaymentsRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const [fee, history] = await Promise.all([getRegistrationFee(), registrationFeeHistory()]);
    sendSuccess(res, { data: { fee, defaults: DEFAULT_REGISTRATION_FEE, updatedAt: history?.updatedAt ?? null, updatedBy: history?.updatedBy ?? null } });
  }),
);

adminPaymentsRouter.put(
  "/settings",
  validate(feeSettingsSchema),
  asyncHandler(async (req, res) => {
    const fee = await saveRegistrationFee(req.validated, req.user.id);
    sendSuccess(res, { message: "Registration fee updated.", data: { fee } });
  }),
);

adminPaymentsRouter.get(
  "/diagnostics",
  asyncHandler(async (_req, res) => {
    const { keyId, keySecret, webhookSecret, apiBase } = env.razorpay;
    const mode = !keyId ? "unknown" : keyId.startsWith("rzp_live_") ? "live" : keyId.startsWith("rzp_test_") ? "test" : "unknown";
    const warnings = [];
    if (!keyId || !keySecret) warnings.push("The Razorpay key id or secret is not set, so payments cannot start.");
    if (mode === "unknown" && keyId) warnings.push("The key id does not start with rzp_test_ or rzp_live_. Check it was copied completely.");
    if (mode === "live" && !isProduction) warnings.push("Live keys are in use outside production: real money would move.");
    if (mode === "test" && isProduction) warnings.push("Test keys are in use in production: customers cannot really pay.");
    if (!webhookSecret || webhookSecret === "YOUR_WEBHOOK_SECRET" || webhookSecret.length < 16) {
      warnings.push("The webhook secret is missing, a placeholder, or too short. Use a long random string, the same one set on the Razorpay webhook.");
    }

    // One harmless read call: it proves the key pair is accepted, and creates nothing.
    let apiCheck = { ok: false, status: null, message: "Not checked: the keys are missing." };
    if (razorpayConfigured()) {
      try {
        const response = await fetch(`${apiBase}/payments?count=1`, {
          headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64") },
          signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json().catch(() => null);
        apiCheck = {
          ok: response.ok,
          status: response.status,
          message: response.ok ? "Razorpay accepted the keys." : (body?.error?.description ?? "Razorpay refused the request."),
        };
      } catch (error) {
        apiCheck = { ok: false, status: null, message: `Could not reach Razorpay: ${error.message}` };
      }
    }
    if (apiCheck.status === 401) warnings.push("Razorpay refused the key id and secret. They do not match, or the key was regenerated.");

    sendSuccess(res, {
      data: {
        // Never the secret itself: only whether it is there and how long it is.
        keys: {
          keyId: keyId ? `${keyId.slice(0, 12)}…` : null,
          keyIdSet: Boolean(keyId),
          keySecretSet: Boolean(keySecret),
          keySecretLength: keySecret?.length ?? 0,
          webhookSecretSet: Boolean(webhookSecret),
          webhookSecretLength: webhookSecret?.length ?? 0,
        },
        mode,
        maxOrderAmount: env.razorpay.maxOrderAmount,
        environment: env.nodeEnv,
        webhookUrl: "/api/v1/payments/webhook",
        warnings,
        apiCheck,
      },
    });
  }),
);

/**
 * @openapi
 * /api/v1/admin/payments/{id}/reconcile:
 *   post:
 *     tags: [Payments]
 *     summary: Settle a payment stuck as "not finished" (or wrongly failed) by asking Razorpay what happened to its order (admin)
 *     description: "If Razorpay holds a captured payment for the order and the amount matches, the payment is marked paid. If it holds none, the attempt is marked failed (abandoned). If Razorpay cannot be reached, nothing changes (502)."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The payment after reconciling }
 *       404: { description: Payment not found }
 *       502: { description: Razorpay could not be reached }
 */
adminPaymentsRouter.post(
  "/:id/reconcile",
  asyncHandler(async (req, res) => {
    const row = await RegistrationPaymentModel.findById(req.params.id);
    if (!row) throw ApiError.notFound("Payment not found.");
    if (!(["created", "failed"].includes(row.status)) || row.source !== "razorpay") {
      return sendSuccess(res, { message: "Nothing to reconcile.", data: money(row) });
    }

    const payments = await fetchOrderPayments(row.razorpayOrderId);
    if (payments === null) throw new ApiError(502, "Razorpay could not be reached. Please try again in a moment.");

    const expected = Math.round(Number(row.amountInRupees) * 100);
    const captured = payments.find((p) => (p.status === "captured" || p.status === "authorized") && Number(p.amount) >= expected);
    const updated = captured
      ? await RegistrationPaymentModel.markPaid(row.razorpayOrderId, captured.id)
      : row.status === "created"
        ? await RegistrationPaymentModel.markFailed(row.razorpayOrderId, null, "Abandoned: no payment was made for this order")
        : row;
    if (captured) await notifyPaid(updated);
    sendSuccess(res, {
      message: captured ? "Found a captured payment. Marked as paid." : row.status === "created" ? "No payment was made. Marked as abandoned." : "Razorpay holds no captured payment for this order. Left as failed.",
      data: money(updated ?? row),
    });
  }),
);
