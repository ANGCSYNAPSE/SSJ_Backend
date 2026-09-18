/**
 * Server-only Razorpay client. keySecret/webhookSecret never leave this
 * module — only the order id/amount/currency/key id (all safe to expose)
 * are returned to the client.
 */
import crypto from "crypto";
import { env } from "../config/env.js";

function requireSecret(name) {
  const value = env.razorpay[name];
  if (!value) throw new Error(`Missing required env var for Razorpay ${name}`);
  return value;
}

function authHeader() {
  return "Basic " + Buffer.from(`${requireSecret("keyId")}:${requireSecret("keySecret")}`).toString("base64");
}

/** Creates an order. `amountInPaise` must be a positive integer. */
export async function createRazorpayOrder({ amountInPaise, currency = "INR", receipt, notes }) {
  if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
    throw new Error("amountInPaise must be a positive integer");
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
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
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
