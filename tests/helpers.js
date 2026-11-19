/**
 * Shared setup for the API tests. They run the real app against the real database, with:
 *  - NODE_ENV=test: email is collected in `mailOutbox` (nothing is ever sent), rate limits are off;
 *  - fake Razorpay keys and a stubbed Razorpay "create order" call (no money, no network);
 *  - every row a test creates carries an `autotest+<tag>` email and is deleted afterwards.
 *
 * Set the environment BEFORE the app is imported: the app reads it once, at load.
 */
process.env.NODE_ENV = "test";
process.env.SMTP_HOST = "";
process.env.SMS_PROVIDER = "";
process.env.RAZORPAY_KEY_ID = "rzp_test_autotest";
process.env.RAZORPAY_KEY_SECRET = "autotest_key_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "autotest_webhook_secret";
process.env.JWT_ACCESS_TTL = "1d";
process.env.JWT_REFRESH_TTL = "7d";
process.env.ALLOW_DIRECT_SIGNUP = "false";
// A cheap password hash keeps the suite fast; the production default (12) is untouched.
process.env.BCRYPT_ROUNDS = "4";

import crypto from "node:crypto";

import { once } from "node:events";
import bcrypt from "bcryptjs";

const { default: app } = await import("../src/app.js");
const { sql } = await import("../src/config/database.js");
const { mailOutbox } = await import("../src/services/mail.service.js");

export { sql, mailOutbox };

export const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
export const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
export const PASSWORD = "Test@12345";

const hmac = (secret, text) => crypto.createHmac("sha256", secret).update(text).digest("hex");
export const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/* ---------- server ---------- */
let server;
let base;
let orderSeq = 0;
const realFetch = globalThis.fetch;

/* ---------- a stand-in for Razorpay ---------- */
// Payments Razorpay "knows": paymentId -> { orderId, amount (paise), status }. A test registers the payment its
// checkout window would have made; a payment that is not registered is one Razorpay has never heard of.
const knownPayments = new Map();
// Payments held for an order, for the reconcile call: orderId -> [{ id, amount, status }]
const orderPayments = new Map();
let razorpayDown = false;
let ordersFail = false;

export function registerPayment(paymentId, { orderId, amount, status = "captured" }) {
  knownPayments.set(paymentId, { id: paymentId, order_id: orderId, amount, status });
}
export function registerOrderPayments(orderId, items) {
  orderPayments.set(orderId, items);
}
/** Makes every Razorpay call fail as if the network were down. */
export function setRazorpayDown(value) {
  razorpayDown = value;
}
/** Makes "create order" answer with Razorpay's raw 400, like an amount above the account's limit. */
export function setOrdersFail(value) {
  ordersFail = value;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function startServer() {
  server = app.listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  // Razorpay's API is answered here; everything else (including calls to our own server) is real.
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes("api.razorpay.com")) return realFetch(url, init);
    if (razorpayDown) throw new TypeError("fetch failed");

    if (u.endsWith("/orders")) {
      if (ordersFail) return json({ error: { code: "BAD_REQUEST_ERROR", description: "Amount exceeds maximum amount allowed." } }, 400);
      const body = JSON.parse(init.body);
      orderSeq += 1;
      return json({ id: `order_autotest_${Date.now()}_${orderSeq}`, amount: body.amount, currency: body.currency ?? "INR" });
    }
    const one = /\/payments\/([^/?]+)$/.exec(u);
    if (one) {
      const payment = knownPayments.get(decodeURIComponent(one[1]));
      return payment ? json(payment) : json({ error: { description: "The id provided does not exist" } }, 400);
    }
    const forOrder = /\/orders\/([^/]+)\/payments$/.exec(u);
    if (forOrder) return json({ items: orderPayments.get(decodeURIComponent(forOrder[1])) ?? [] });
    if (u.includes("/payments?")) return json({ items: [] });
    return json({ error: { description: "not stubbed" } }, 404);
  };
}

export async function stopServer() {
  globalThis.fetch = realFetch;
  razorpayDown = false;
  ordersFail = false;
  await new Promise((resolve) => server.close(resolve));
}

/* ---------- http ---------- */
/** Calls the API. Returns { status, body, setCookie } where setCookie is the refresh cookie header, if any. */
export async function api(path, { method, body, token, cookie, headers = {} } = {}) {
  const verb = method ?? (body === undefined ? "GET" : "POST");
  const res = await realFetch(base + path, {
    method: verb,
    headers: {
      ...(body !== undefined && typeof body !== "string" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, body: await res.json().catch(() => null), setCookie };
}

/** "ssj_refresh=<token>" from a Set-Cookie header, ready to send back as a Cookie header. */
export const cookieFrom = (setCookie) => setCookie?.split(";")[0] ?? null;
export const tokenFrom = (setCookie) => cookieFrom(setCookie)?.split("=")[1] ?? null;

/* ---------- test people ---------- */
let counter = 0;
export function makeIdentity(tag, over = {}) {
  counter += 1;
  const unique = `${Date.now()}${counter}${Math.floor(Math.random() * 1000)}`;
  return {
    fullName: "Auto Test",
    email: `autotest+${tag}-${unique}@example.com`,
    mobile: `7${unique.slice(-9).padStart(9, "0")}`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptTerms: true,
    becomeMember: true,
    ...over,
  };
}

/** The newest email sent to an address, with its 6-digit code if it has one. */
export function lastMailTo(email) {
  const mails = mailOutbox.filter((m) => m.to === email);
  const mail = mails.at(-1);
  return mail ? { ...mail, code: /\b(\d{6})\b/.exec(mail.subject)?.[1] ?? null } : null;
}
export const mailCountTo = (email, subjectPart) => mailOutbox.filter((m) => m.to === email && (!subjectPart || m.subject.includes(subjectPart))).length;

/** Makes a real account straight in the database (for tests about signing in, not about signing up). */
export async function createUser(tag, over = {}) {
  const who = makeIdentity(tag);
  const passwordHash = await bcrypt.hash(who.password, 4);
  const [row] = await sql(
    `INSERT INTO users (full_name, email, mobile, password_hash, role, is_verified, is_blocked)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id, role`,
    [who.fullName, who.email, who.mobile, passwordHash, over.role ?? "member", over.blocked ?? false],
  );
  return { ...who, id: row.id, role: row.role };
}

export async function login(user, remember = true) {
  return api("/auth/login", { body: { email: user.email, password: user.password, remember } });
}

/* ---------- the signup steps ---------- */
export const startSignup = (who, extra = {}) => api("/auth/signup/start", { body: { ...who, ...extra } });

/** start -> read the emailed code -> verify. Returns { pendingId, who }. */
export async function startAndVerify(tag, over = {}) {
  const who = makeIdentity(tag, over);
  const started = await startSignup(who);
  const pendingId = started.body.data.pendingId;
  const { code } = lastMailTo(who.email);
  const verified = await api("/auth/signup/verify-otp", { body: { pendingId, code } });
  return { who, pendingId, started, verified };
}

/** start -> verify -> details. Returns { pendingId, who }. */
export async function readyToPay(tag, over = {}, profile = { city: "Jaipur", state: "Rajasthan" }) {
  const done = await startAndVerify(tag, over);
  const saved = await api("/auth/signup/profile", { body: { pendingId: done.pendingId, profile } });
  return { ...done, saved };
}

/** Pays `amount` rupees on a pending signup the way the site does, and returns the final response. */
export async function payPending(pendingId, amount) {
  const order = await api("/auth/signup/pay/order", { body: { pendingId, amount } });
  if (order.status !== 201) return { order };
  const { orderId } = order.body.data;
  const paymentId = `pay_autotest_${Date.now()}`;
  registerPayment(paymentId, { orderId, amount: order.body.data.amount });
  const done = await api("/auth/signup/pay/verify", {
    body: { pendingId, razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`) },
  });
  return { order, orderId, paymentId, done };
}

/** Razorpay's own signature for a payment, as the checkout window would return it. */
export const signPayment = (orderId, paymentId) => hmac(KEY_SECRET, `${orderId}|${paymentId}`);
export const signWebhook = (raw) => hmac(WEBHOOK_SECRET, raw);

/* ---------- cleanup ---------- */
/** Deletes everything a test file created (rows whose email starts with autotest+<tag>-). */
export async function cleanup(tag) {
  const like = `autotest+${tag}-%`;
  await sql(
    `DELETE FROM registration_payments WHERE pending_signup_id IN (SELECT id FROM pending_signups WHERE email LIKE $1)
       OR user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [like],
  );
  await sql(`DELETE FROM pending_signups WHERE email LIKE $1`, [like]);
  await sql(`DELETE FROM users WHERE email LIKE $1`, [like]);
}

export const futureDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
export const pastMinutes = (n) => new Date(Date.now() - n * 60_000).toISOString();
