/**
 * The registration fee: one total, payable in parts. The first payment must be at least
 * `minimum`; whatever is left can be paid later (or all at once). Amounts are in rupees; the site
 * reads them from GET /payments/me, so it never hard-codes a price.
 */
export const REGISTRATION_FEE = { total: 1100, minimum: 501 };

/** Stamped on every Razorpay order so Shyam Jagat payments can always be told apart from other apps'. */
export const PAYMENT_APP = "shyam_jagat";
export const PAYMENT_PURPOSE = "registration_fee";

/** pending = nothing paid, partial = some paid and a balance is due, paid = the full fee is in. */
export function feeState(paid) {
  if (paid <= 0) return "pending";
  return paid >= REGISTRATION_FEE.total ? "paid" : "partial";
}

/**
 * What a new payment may be, given what has been paid so far. The first payment is at least the
 * minimum; if less than the minimum is left, the payment must clear exactly that remainder.
 */
export function allowedPayment(paidSoFar) {
  const balance = Math.max(0, REGISTRATION_FEE.total - paidSoFar);
  return { balance, min: Math.min(REGISTRATION_FEE.minimum, balance), max: balance };
}
