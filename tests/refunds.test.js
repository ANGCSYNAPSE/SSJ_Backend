import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  cleanup,
  createUser,
  login,
  registerPayment,
  setRazorpayDown,
  setRefundsFail,
  signPayment,
  signWebhook,
  sql,
  startServer,
  stopServer,
} from "./helpers.js";

const TAG = "rfd";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const adminToken = async () => tokenOf(await createUser(TAG, { role: "admin" }));

/** A member who has paid `amount` through Razorpay. Returns { user, token, paymentId (ours), razorpayId }. */
async function paidMember(amount = 1100) {
  const user = await createUser(TAG);
  const token = await tokenOf(user);
  const order = await api("/payments/registration/order", { token, body: { amount } });
  const { orderId } = order.body.data;
  const razorpayId = `pay_rfd_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  registerPayment(razorpayId, { orderId, amount: order.body.data.amount });
  const verified = await api("/payments/registration/verify", {
    token,
    body: { razorpay_order_id: orderId, razorpay_payment_id: razorpayId, razorpay_signature: signPayment(orderId, razorpayId) },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const [row] = await sql(`SELECT id FROM registration_payments WHERE razorpay_order_id = $1`, [orderId]);
  return { user, token, id: row.id, razorpayId };
}

const refund = (token, id, body) => api(`/admin/payments/${id}/refund`, { token, body });
const feeOf = async (token) => (await api("/payments/me", { token })).body.data.fee;

describe("admin refunds", () => {
  it("is for administrators only", async () => {
    const { token, id } = await paidMember(501);
    assert.equal((await refund(token, id, { reason: "because" })).status, 403);
    assert.equal((await api(`/admin/payments/${id}/refund`, { body: { reason: "x" } })).status, 401);
    assert.equal((await api(`/admin/payments/${id}/refunds`, { token })).status, 403);
  });

  it("refunds a payment in full: Razorpay is asked, the fee drops, and the person is told", async () => {
    const { token, id, user } = await paidMember(501);
    assert.equal((await feeOf(token)).paid, 501);

    const res = await refund(await adminToken(), id, { reason: "Paid twice by mistake" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.refund.amount, 501);
    assert.match(res.body.data.refund.id, /^rfnd_/);
    assert.equal(res.body.data.payment.refunded, 501);
    assert.equal(res.body.data.fee.paid, 0, "what they have paid counts what is left after the refund");
    assert.equal(res.body.data.belowMinimum, true);

    assert.equal((await feeOf(token)).paid, 0);
    assert.equal((await feeOf(token)).status, "pending");

    const notes = (await api("/notifications/feed?category=payment", { token })).body.data.items;
    const note = notes.find((n) => n.title === "Refund initiated");
    assert.ok(note);
    assert.match(note.message, /₹501/);
    assert.ok(user.id);
  });

  it("refunds part of a payment, then the rest, and never more than was paid", async () => {
    const { token, id } = await paidMember(1100);
    const admin = await adminToken();

    assert.equal((await refund(admin, id, { amount: 200, reason: "Goodwill" })).status, 200);
    assert.equal((await feeOf(token)).paid, 900);
    assert.equal((await refund(admin, id, { amount: 901, reason: "Too much" })).status, 400);
    assert.equal((await feeOf(token)).paid, 900, "a refused refund changes nothing");

    const rest = await refund(admin, id, { reason: "Rest of it" });
    assert.equal(rest.body.data.refund.amount, 900, "leaving the amount out refunds what is left");
    assert.equal((await feeOf(token)).paid, 0);

    const again = await refund(admin, id, { reason: "Once more" });
    assert.equal(again.status, 400);
    assert.match(again.body.message, /already been fully refunded/);

    const history = (await api(`/admin/payments/${id}/refunds`, { token: admin })).body.data;
    assert.deepEqual(history.map((h) => h.amount).sort((a, b) => a - b), [200, 900]);
    assert.ok(history.every((h) => h.status === "processed" && h.source === "admin"));
  });

  it("a partial refund that leaves the minimum fee in place does not flag the person", async () => {
    const { id } = await paidMember(1100);
    const res = await refund(await adminToken(), id, { amount: 100, reason: "Small adjustment" });
    assert.equal(res.body.data.belowMinimum, false);
  });

  it("needs a reason and a sensible amount", async () => {
    const { id } = await paidMember(501);
    const admin = await adminToken();
    assert.equal((await refund(admin, id, {})).status, 400);
    assert.equal((await refund(admin, id, { reason: "ab" })).status, 400);
    assert.equal((await refund(admin, id, { amount: 0, reason: "Zero" })).status, 400);
    assert.equal((await refund(admin, id, { amount: -5, reason: "Negative" })).status, 400);
    assert.equal((await refund(admin, id, { amount: 10.123, reason: "Fractions" })).status, 400);
    assert.equal((await refund(admin, "not-a-uuid", { reason: "Nothing" })).status, 404);
  });

  it("only a payment that was received can be refunded", async () => {
    const user = await createUser(TAG);
    const order = await api("/payments/registration/order", { token: await tokenOf(user), body: { amount: 501 } });
    const [row] = await sql(`SELECT id FROM registration_payments WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
    const res = await refund(await adminToken(), row.id, { reason: "Never paid" });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /received/);
  });

  it("when Razorpay refuses, nothing changes and the reason is passed on", async () => {
    const { token, id } = await paidMember(501);
    setRefundsFail(true);
    try {
      const res = await refund(await adminToken(), id, { reason: "Test" });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /balance is not sufficient/i);
    } finally {
      setRefundsFail(false);
    }
    assert.equal((await feeOf(token)).paid, 501);
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM payment_refunds WHERE payment_id = $1`, [id]))[0].n, 0);
  });

  it("when Razorpay cannot be reached nothing changes (502)", async () => {
    const { token, id } = await paidMember(501);
    setRazorpayDown(true);
    try {
      assert.equal((await refund(await adminToken(), id, { reason: "Test" })).status, 502);
    } finally {
      setRazorpayDown(false);
    }
    assert.equal((await feeOf(token)).paid, 501);
  });

  it("a payment recorded by hand is refunded in the books only (no Razorpay call)", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    const made = await api("/admin/payments/manual", { token: admin, body: { userId: user.id, amount: 600, reference: "UPI-RFD" } });
    assert.equal(made.status, 201);
    setRazorpayDown(true); // would fail if a Razorpay call were made
    try {
      const res = await refund(admin, made.body.data.id, { amount: 600, reason: "Returned in cash" });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.refund.id, null);
    } finally {
      setRazorpayDown(false);
    }
    assert.equal((await feeOf(await tokenOf(user))).paid, 0);
    const [log] = await api(`/admin/payments/${made.body.data.id}/refunds`, { token: admin }).then((r) => r.body.data);
    assert.equal(log.source, "manual");
  });

  it("refunds show in the totals and the payments list", async () => {
    const { id } = await paidMember(501);
    const admin = await adminToken();
    const before = (await api("/admin/payments/summary", { token: admin })).body.data;
    await refund(admin, id, { amount: 101, reason: "Adjustment" });
    const after = (await api("/admin/payments/summary", { token: admin })).body.data;
    assert.equal(Math.round((before.collected.amount - after.collected.amount) * 100) / 100, 101);
    assert.ok(after.collected.refunded >= before.collected.refunded + 101);
    const list = (await api(`/admin/payments?status=paid&limit=100`, { token: admin })).body.data;
    assert.ok(list.items.every((p) => typeof p.refunded === "number" || p.refundedAmount !== undefined));
  });
});

describe("refunds made in the Razorpay dashboard", () => {
  const webhook = (event, refund) => {
    const raw = JSON.stringify({ event, payload: { refund: { entity: refund } } });
    return api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(raw) } });
  };

  it("are noticed, counted once, and the person is told", async () => {
    const { token, razorpayId } = await paidMember(1100);
    const entity = { id: `rfnd_dash_${Date.now()}`, payment_id: razorpayId, amount: 30000, status: "processed" };

    assert.equal((await webhook("refund.created", { ...entity, status: "pending" })).status, 200);
    assert.equal((await feeOf(token)).paid, 800);
    await webhook("refund.processed", entity);
    await webhook("refund.processed", entity); // Razorpay may repeat itself
    assert.equal((await feeOf(token)).paid, 800, "the same refund is never counted twice");

    const notes = (await api("/notifications/feed?category=payment", { token })).body.data.items;
    assert.equal(notes.filter((n) => n.title === "Refund initiated").length, 1);
    const [row] = await sql(`SELECT status, source FROM payment_refunds WHERE razorpay_refund_id = $1`, [entity.id]);
    assert.deepEqual([row.status, row.source], ["processed", "dashboard"]);
  });

  it("a refund that Razorpay could not complete is counted as not refunded", async () => {
    const { token, razorpayId } = await paidMember(1100);
    const entity = { id: `rfnd_fail_${Date.now()}`, payment_id: razorpayId, amount: 50000, status: "pending" };
    await webhook("refund.created", entity);
    assert.equal((await feeOf(token)).paid, 600);
    await webhook("refund.failed", { ...entity, status: "failed" });
    assert.equal((await feeOf(token)).paid, 1100);
  });

  it("the admin's own refund and Razorpay's report of it are one refund", async () => {
    const { token, id, razorpayId } = await paidMember(1100);
    const res = await refund(await adminToken(), id, { amount: 100, reason: "Overpaid" });
    await webhook("refund.created", { id: res.body.data.refund.id, payment_id: razorpayId, amount: 10000, status: "pending" });
    await webhook("refund.processed", { id: res.body.data.refund.id, payment_id: razorpayId, amount: 10000, status: "processed" });
    assert.equal((await feeOf(token)).paid, 1000);
  });

  it("a refund for a payment that is not ours is ignored", async () => {
    const res = await webhook("refund.processed", { id: "rfnd_stranger", payment_id: "pay_not_ours", amount: 10000, status: "processed" });
    assert.equal(res.status, 200);
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM payment_refunds WHERE razorpay_refund_id = 'rfnd_stranger'`))[0].n, 0);
  });
});
