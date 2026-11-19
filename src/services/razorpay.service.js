/**
 * Server-only Razorpay client. keySecret/webhookSecret never leave this module: only the order
 * id/amount/currency/key id (all safe to expose) are returned to the client.
 *
 * Plain HTTPS calls, no SDK. Amounts are in paise (rupees x 100). Every non-200 answer is logged with its
 * HTTP code and Razorpay's error (never a secret); callers get a friendly sentence, never raw JSON.
 */
import crypto from "crypto";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

const CREATE_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 20_000;

function requireSecret(name) {
  const value = env.razorpay[name];
  if (!value) throw new Error(`Missing required env var for Razorpay ${name}`);
  return value;
}

export const razorpayConfigured = () => Boolean(env.razorpay.keyId && env.razorpay.keySecret);

function authHeader() {
  return "Basic " + Buffer.from(`${requireSecret("keyId")}:${requireSecret("keySecret")}`).toString("base64");
}

/** One Razorpay call. Never throws: returns { ok, status, payload } (status null when Razorpay could not be reached). */
async function call(path, { method = "GET", body, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    const res = await fetch(`${env.razorpay.apiBase}${path}`, {
      method,
      headers: { Authorization: authHeader(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      console.error(`[razorpay] ${method} ${path} -> ${res.status}`, JSON.stringify(payload?.error ?? payload));
    }
    return { ok: res.ok, status: res.status, payload };
  } catch (error) {
    console.error(`[razorpay] ${method} ${path} -> could not reach Razorpay: ${error.message}`);
    return { ok: false, status: null, payload: null };
  }
}

/**
 * Creates an order. `amountInPaise` must be a positive whole number; the server decides it, never the
 * browser. Amounts above RAZORPAY_MAX_ORDER_AMOUNT are refused here with a plain message, because Razorpay
 * would otherwise answer with a raw 400.
 */
export async function createRazorpayOrder({ amountInPaise, currency = "INR", receipt, notes }) {
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw new Error("amountInPaise must be a positive integer");
  }
  const maxRupees = env.razorpay.maxOrderAmount;
  if (amountInPaise > maxRupees * 100) {
    throw ApiError.badRequest(`The largest single payment allowed is ₹${maxRupees.toLocaleString("en-IN")}.`);
  }
  if (!razorpayConfigured()) {
    console.error("[razorpay] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set, so no order can be created.");
    throw ApiError.serviceUnavailable("Online payments are not set up yet. Please try again later.");
  }

  const { ok, payload } = await call("/orders", {
    method: "POST",
    timeoutMs: CREATE_TIMEOUT_MS,
    // payment_capture: the money is taken as soon as the payment is authorised, no manual capture step.
    body: { amount: amountInPaise, currency, receipt: String(receipt).slice(0, 40), payment_capture: 1, notes },
  });
  if (!ok || !payload?.id) {
    throw ApiError.serviceUnavailable("We could not start the payment right now. Please try again in a moment.");
  }
  return payload;
}

/**
 * Asks Razorpay whether a payment really went through. A valid signature proves the order and payment ids
 * belong together; only the payment's own status proves money moved. Returns:
 *  - "captured":     paid (status captured, or authorised with auto-capture on), for this order and amount;
 *  - "mismatch":     Razorpay knows the payment but for a different order, or for less than the order: refuse it;
 *  - "not_captured": the payment exists but did not succeed (failed, created, refunded...);
 *  - "unreachable":  Razorpay could not be asked (or does not know the payment yet): leave it pending, the
 *                    webhook or a reconcile will settle it.
 */
export async function confirmPayment({ orderId, paymentId, amountInPaise }) {
  const { ok, payload } = await call(`/payments/${encodeURIComponent(paymentId)}`);
  if (!ok || !payload) return { state: "unreachable", status: null };
  // The payment must be for this order and cover it. It may be MORE than the order: when the Razorpay account has the
  // customer bear the fee, the payment amount includes Razorpay's fee on top of the order amount (₹1,100 + ₹12.98).
  if (payload.order_id !== orderId || Number(payload.amount) < amountInPaise) return { state: "mismatch", status: payload.status };
  if (payload.status === "captured" || payload.status === "authorized") return { state: "captured", status: payload.status };
  return { state: "not_captured", status: payload.status };
}

/** Every payment Razorpay holds for an order, or null when Razorpay could not be asked. Used to reconcile stuck payments. */
export async function fetchOrderPayments(orderId) {
  const { ok, payload } = await call(`/orders/${encodeURIComponent(orderId)}/payments`);
  if (!ok || !Array.isArray(payload?.items)) return null;
  return payload.items;
}

function timingSafeEqualHex(expectedHex, actualHex) {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex ?? "", "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Verifies the signature Razorpay Checkout returns after a successful payment. */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = crypto.createHmac("sha256", requireSecret("keySecret")).update(`${orderId}|${paymentId}`).digest("hex");
  return timingSafeEqualHex(expected, signature);
}

/** Verifies the `X-Razorpay-Signature` header on an incoming webhook request. */
export function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto.createHmac("sha256", requireSecret("webhookSecret")).update(rawBody).digest("hex");
  return timingSafeEqualHex(expected, signature);
}
