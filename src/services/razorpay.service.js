/**
 * Server-only Razorpay client. keySecret/webhookSecret never leave this
 * module — only the order id/amount/currency/key id (all safe to expose)
 * are returned to the client.
 */
import crypto from "crypto";
import { randomBytes } from "crypto";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

function requireSecret(name) {
  const value = env.razorpay[name];
  if (!value) throw new Error(`Missing required env var for Razorpay ${name}`);
  return value;
}

function authHeader() {
  return "Basic " + Buffer.from(`${requireSecret("keyId")}:${requireSecret("keySecret")}`).toString("base64");
}

/** The dummy checkout's identifiers. Real Razorpay ids never start like this. */
export const MOCK_ORDER_PREFIX = "order_mock_";
export const MOCK_SIGNATURE = "mock_signature";

/**
 * True when the development "mock" checkout is in use: PAYMENTS_MODE=mock AND no complete Razorpay key
 * pair. The moment RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are both set, the dummy checkout switches
 * itself off and the real (test or live) Razorpay is used, even if PAYMENTS_MODE=mock is still there.
 */
export const isMockPayments = () => env.payments.mode === "mock" && !(env.razorpay.keyId && env.razorpay.keySecret);

/** PAYMENTS_MODE=mock is still set although real keys exist: harmless (the keys win), but worth removing. */
export const isMockSwitchLeftOn = () => env.payments.mode === "mock" && Boolean(env.razorpay.keyId && env.razorpay.keySecret);

/**
 * Creates an order. `amountInPaise` must be a positive integer. With `allowMock` (only the registration
 * fee passes it) and PAYMENTS_MODE=mock, no call is made: a dummy order comes back and the site shows a
 * dummy checkout. Without the keys, real mode refuses politely instead of failing deep inside.
 */
export async function createRazorpayOrder({ amountInPaise, currency = "INR", receipt, notes, allowMock = false }) {
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw new Error("amountInPaise must be a positive integer");
  }
  if (allowMock && isMockPayments()) {
    return { id: `${MOCK_ORDER_PREFIX}${randomBytes(8).toString("hex")}`, amount: amountInPaise, currency, mock: true };
  }
  if (!env.razorpay.keyId || !env.razorpay.keySecret) {
    console.error("[razorpay] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set, so no order can be created.");
    throw ApiError.serviceUnavailable("Online payments are not set up yet. Please try again later.");
  }

  const res = await fetch(`${env.razorpay.apiBase}/orders`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: amountInPaise, currency, receipt, notes }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error?.description ?? "Failed to create Razorpay order";
    throw new Error(message);
  }
  return payload;
}

function timingSafeEqualHex(expectedHex, actualHex) {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex ?? "", "hex");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Verifies the signature Razorpay Checkout returns after a successful payment. */
export function verifyPaymentSignature({ orderId, paymentId, signature, allowMock = false }) {
  // The dummy checkout: only in mock mode, only for registration payments, only for a dummy order.
  if (allowMock && isMockPayments() && String(orderId).startsWith(MOCK_ORDER_PREFIX)) {
    return signature === MOCK_SIGNATURE;
  }
  const expected = crypto
    .createHmac("sha256", requireSecret("keySecret"))
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

/** Verifies the `X-Razorpay-Signature` header on an incoming webhook request. */
export function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto.createHmac("sha256", requireSecret("webhookSecret")).update(rawBody).digest("hex");
  return timingSafeEqualHex(expected, signature);
}
