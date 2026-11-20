import { sql } from "../config/database.js";
import { env } from "../config/env.js";
import { getRegistrationFee } from "../config/plans.js";
import { ApiError } from "../utils/ApiError.js";
import { inr, renderDocumentPdf } from "./pdf.service.js";

const day = (value) =>
  new Date(value ?? Date.now()).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

/**
 * The receipt for one payment, or the invoice for a person's registration fee. `ownerId` (a member asking for their
 * own) makes someone else's payment look like it does not exist.
 */
export async function buildDocument({ paymentId, kind = "receipt", ownerId }) {
  const [payment] = await sql(
    `SELECT p.*, u.full_name, u.email, u.mobile FROM registration_payments p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
    [paymentId],
  );
  if (!payment || (ownerId && payment.user_id !== ownerId)) throw ApiError.notFound("Payment not found.");
  if (payment.status !== "paid") throw ApiError.badRequest("Only a payment that was received has a receipt or invoice.");

  const [{ total }, all] = await Promise.all([
    getRegistrationFee(),
    sql(`SELECT * FROM registration_payments WHERE user_id = $1 AND status = 'paid' ORDER BY paid_at, created_at`, [payment.user_id]),
  ]);
  const refunded = all.reduce((sum, p) => sum + Number(p.refunded_amount), 0);
  const paidNet = all.reduce((sum, p) => sum + Number(p.net_amount_in_rupees), 0);
  const balance = Math.max(total - paidNet, 0);
  const reference = (p) => (p.source === "manual" ? `Recorded by the team${p.note ? ` (${p.note})` : ""}` : p.razorpay_payment_id ?? "Razorpay");
  const billedTo = { name: payment.full_name, email: payment.email, mobile: payment.mobile };

  const base = {
    billedTo,
    supportEmail: env.supportEmail,
    siteUrl: env.siteUrl.replace(/^https?:\/\//, ""),
  };

  if (kind === "invoice") {
    const lines = [{ description: "Registration fee", reference: "One-time, payable in parts", amount: total }];
    for (const p of all) {
      lines.push({ description: `Payment received on ${day(p.paid_at)}`, reference: `${p.receipt}\n${reference(p)}`.replace("\n", " | "), amount: -Number(p.amount_in_rupees) });
      if (Number(p.refunded_amount) > 0) lines.push({ description: "Refund made to you", reference: p.receipt, amount: Number(p.refunded_amount) });
    }
    const status = balance === 0 ? "PAID IN FULL" : paidNet > 0 ? "PART PAID" : "UNPAID";
    return {
      kind,
      fileName: `Shyam-Jagat-Invoice-${String(payment.user_id).slice(0, 8).toUpperCase()}`,
      data: {
        ...base,
        title: "INVOICE",
        numberLabel: "Invoice no",
        number: `INV-${String(payment.user_id).replace(/-/g, "").slice(0, 8).toUpperCase()}`,
        date: day(all.at(-1)?.paid_at ?? payment.paid_at),
        status,
        statusTone: balance === 0 ? "good" : "warn",
        lines,
        summary: [
          { label: "Registration fee", value: inr(total) },
          { label: "Paid so far", value: inr(paidNet), tone: "good" },
          ...(refunded > 0 ? [{ label: "Refunded", value: inr(refunded) }] : []),
          { label: "Balance due", value: inr(balance), strong: true, tone: balance > 0 ? "bad" : "good" },
        ],
        notes: [balance > 0 ? `A balance of ${inr(balance)} is still pending. You can pay it any time from your profile on ${base.siteUrl}.` : "Your registration fee is paid in full. Thank you for being part of Shyam Jagat."],
      },
    };
  }

  const amount = Number(payment.amount_in_rupees);
  const lines = [{ description: "Registration fee - payment received", reference: reference(payment), amount }];
  if (Number(payment.refunded_amount) > 0) lines.push({ description: "Refund made to you", reference: "See the refund policy", amount: -Number(payment.refunded_amount) });
  return {
    kind: "receipt",
    fileName: `Shyam-Jagat-Receipt-${payment.receipt}`,
    data: {
      ...base,
      title: "RECEIPT",
      numberLabel: "Receipt no",
      number: payment.receipt,
      date: day(payment.paid_at),
      status: "PAID",
      statusTone: "good",
      lines,
      summary: [
        { label: "Amount received", value: inr(amount), strong: true, tone: "good" },
        { label: "Registration fee", value: inr(total) },
        { label: "Paid so far", value: inr(paidNet) },
        { label: "Balance due", value: inr(balance), tone: balance > 0 ? "bad" : "good" },
      ],
      notes: ["Thank you. Refunds, if any, are handled as described in our Refund Policy on " + base.siteUrl + "/refund-policy."],
    },
  };
}

export const documentPdf = (document) => renderDocumentPdf(document.data);
