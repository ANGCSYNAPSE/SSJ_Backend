import { sql } from "../config/database.js";
import { getRegistrationFee } from "../config/plans.js";
import { RegistrationPaymentModel } from "../models/registrationPayment.model.js";
import { sendDonationReceiptEmail, sendPaymentReceiptEmail } from "./mail.service.js";

/**
 * Receipts and invoices by email. Each paid payment (and donation) is emailed exactly once: the row is claimed
 * first (receipt_emailed_at), so the browser, Razorpay's webhook and an admin's reconcile can all report the same
 * payment and the person still gets one receipt. Nothing here ever throws: a failed email must never undo a payment.
 */

/** Emails the receipt for one paid registration-fee payment that already belongs to an account. */
export async function emailRegistrationReceipt(paymentId) {
  try {
    const [claimed] = await sql(
      `UPDATE registration_payments SET receipt_emailed_at = NOW()
        WHERE id = $1 AND status = 'paid' AND user_id IS NOT NULL AND receipt_emailed_at IS NULL
        RETURNING id, user_id, amount_in_rupees, receipt, razorpay_payment_id, source, note, paid_at`,
      [paymentId],
    );
    if (!claimed) return;

    const [user] = await sql(`SELECT full_name, email FROM users WHERE id = $1 AND deleted_at IS NULL`, [claimed.user_id]);
    if (!user) return;

    const [{ total }, { paid }] = await Promise.all([getRegistrationFee(), RegistrationPaymentModel.paidSummary(claimed.user_id)]);
    await sendPaymentReceiptEmail({
      to: user.email,
      fullName: user.full_name,
      receiptNo: claimed.receipt,
      paidAt: claimed.paid_at,
      amount: Number(claimed.amount_in_rupees),
      paymentRef: claimed.razorpay_payment_id,
      offline: claimed.source === "manual",
      note: claimed.note,
      total,
      paid,
      balance: Math.max(total - paid, 0),
    });
  } catch (error) {
    console.error("[mail] payment receipt not sent:", error.message);
  }
}

/** The payments of a signup that has just become an account (the first payment is made before the account exists). */
export async function emailSignupReceipts(pendingId) {
  const rows = await sql(`SELECT id FROM registration_payments WHERE pending_signup_id = $1 AND status = 'paid' ORDER BY paid_at`, [pendingId]);
  for (const row of rows) await emailRegistrationReceipt(row.id);
}

/** Emails a donor their receipt, when they gave an email and asked for one. */
export async function emailDonationReceipt(donationId) {
  try {
    const [claimed] = await sql(
      `UPDATE donations SET receipt_emailed_at = NOW()
        WHERE id = $1 AND status = 'paid' AND receipt_emailed_at IS NULL AND email IS NOT NULL AND email <> '' AND want_receipt = TRUE
        RETURNING id, donor_name, email, amount_in_rupees, cause, razorpay_payment_id, updated_at`,
      [donationId],
    );
    if (!claimed) return;
    await sendDonationReceiptEmail({
      to: claimed.email,
      donorName: claimed.donor_name,
      receiptNo: `SJ-DON-${String(claimed.id).replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      paidAt: claimed.updated_at,
      amount: Number(claimed.amount_in_rupees),
      cause: claimed.cause,
      paymentRef: claimed.razorpay_payment_id,
    });
  } catch (error) {
    console.error("[mail] donation receipt not sent:", error.message);
  }
}
