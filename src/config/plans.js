import { sql } from "./database.js";

/**
 * The registration fee: one total, payable in parts. The first payment must be at least `minimum`;
 * whatever is left can be paid later (or all at once). Amounts are in rupees.
 *
 * The amounts live in the app_settings table, so an admin changes them in the admin panel with no
 * deploy. These defaults apply until someone does. The site reads the amounts from the API and never
 * hard-codes a price.
 */
export const DEFAULT_REGISTRATION_FEE = { total: 1100, minimum: 501 };

const SETTING_KEY = "registration_fee";
const CACHE_MS = 15_000;
let cache = { fee: DEFAULT_REGISTRATION_FEE, at: 0 };

const sane = (value) =>
  Number.isInteger(value?.total) && Number.isInteger(value?.minimum) && value.minimum > 0 && value.minimum <= value.total;

/** The current fee { total, minimum }. Cached for a few seconds so the database is not asked on every request. */
export async function getRegistrationFee() {
  if (Date.now() - cache.at < CACHE_MS) return cache.fee;
  let fee = DEFAULT_REGISTRATION_FEE;
  try {
    const [row] = await sql(`SELECT value FROM app_settings WHERE key = $1`, [SETTING_KEY]);
    if (row && sane(row.value)) fee = { total: row.value.total, minimum: row.value.minimum };
  } catch {
    // The settings table is not there yet (migration not run): the defaults keep the site working.
  }
  cache = { fee, at: Date.now() };
  return fee;
}

/** Saves a new fee (the caller has validated it) and makes it current right away. */
export async function saveRegistrationFee(fee, userId) {
  await sql(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [SETTING_KEY, JSON.stringify({ total: fee.total, minimum: fee.minimum }), userId ?? null],
  );
  cache = { fee: { total: fee.total, minimum: fee.minimum }, at: Date.now() };
  return cache.fee;
}

/** Who last changed the fee and when, for the admin settings screen. */
export async function registrationFeeHistory() {
  const [row] = await sql(
    `SELECT s.updated_at, u.full_name AS updated_by_name FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = $1`,
    [SETTING_KEY],
  );
  return row ? { updatedAt: row.updated_at, updatedBy: row.updated_by_name } : null;
}

/** Stamped on every Razorpay order so Shyam Jagat payments can always be told apart from other apps'. */
export const PAYMENT_APP = "shyam_jagat";
export const PAYMENT_PURPOSE = "registration_fee";

/** pending = nothing paid, partial = some paid and a balance is due, paid = the full fee is in. */
export function feeState(paid, fee) {
  if (paid <= 0) return "pending";
  return paid >= fee.total ? "paid" : "partial";
}

/**
 * What a new payment may be, given what has been paid so far. The first payment is at least the
 * minimum; if less than the minimum is left, the payment must clear exactly that remainder.
 */
export function allowedPayment(paidSoFar, fee) {
  const balance = Math.max(0, fee.total - paidSoFar);
  return { balance, min: Math.min(fee.minimum, balance), max: balance };
}
