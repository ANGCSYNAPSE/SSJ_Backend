import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  cleanup,
  createUser,
  lastMailTo,
  login,
  mailCountTo,
  payPending,
  readyToPay,
  registerPayment,
  signPayment,
  signWebhook,
  sql,
  startServer,
  stopServer,
} from "./helpers.js";

const TAG = "rct";

before(startServer);
after(async () => {
  await sql(`DELETE FROM donations WHERE email LIKE 'autotest+${TAG}-%'`);
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const adminToken = async () => tokenOf(await createUser(TAG, { role: "admin" }));
const receiptsTo = (email) => mailCountTo(email, "Payment receipt");

/** A signed-in member pays `amount` through Razorpay. */
async function pay(user, token, amount) {
  const order = await api("/payments/registration/order", { token, body: { amount } });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const { orderId } = order.body.data;
  const paymentId = `pay_rct_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  registerPayment(paymentId, { orderId, amount: order.body.data.amount });
  return { orderId, paymentId, amount: order.body.data.amount, signature: signPayment(orderId, paymentId) };
}

describe("receipts by email", () => {
  it("the first payment at signup is emailed a receipt once the account exists", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    assert.equal(receiptsTo(who.email), 0, "nothing yet: there is no account");
    const done = await payPending(pendingId, 501);
    assert.equal(done.done.status, 201);

    assert.equal(receiptsTo(who.email), 1);
    const mail = [...(await import("./helpers.js")).mailOutbox].reverse().find((m) => m.to === who.email && /Payment receipt/.test(m.subject));
    assert.match(mail.subject, /Payment receipt SJ-REG-.* - ₹501 received/);
    assert.match(mail.text, /Amount paid: ₹501/);
    assert.match(mail.text, /Registration fee: ₹1,100/);
    assert.match(mail.text, /Paid so far: ₹501/);
    assert.match(mail.text, /Balance still to pay: ₹599/);
    assert.match(mail.text, /Billed to: .* \(autotest\+/);
    assert.match(mail.html, /Pay the balance/);
    assert.match(mail.html, /computer-generated receipt/);
    assert.ok(!/reply to this/i.test(mail.text), "no reply instruction on an address nobody reads");
  });

  it("a later payment from the profile gets its own receipt, once, even when the webhook repeats it", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const p = await pay(user, token, 600);

    await api("/payments/registration/verify", { token, body: { razorpay_order_id: p.orderId, razorpay_payment_id: p.paymentId, razorpay_signature: p.signature } });
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: p.paymentId, order_id: p.orderId, amount: p.amount, notes: { app: "shyam_jagat", purpose: "registration_fee" } } } },
    });
    await api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(raw) } });
    await api("/payments/registration/verify", { token, body: { razorpay_order_id: p.orderId, razorpay_payment_id: p.paymentId, razorpay_signature: p.signature } });

    assert.equal(receiptsTo(user.email), 1, "one receipt however many times the payment is reported");
    assert.match(lastMailTo(user.email).text, /Amount paid: ₹600/);

    const p2 = await pay(user, token, 500);
    await api("/payments/registration/verify", { token, body: { razorpay_order_id: p2.orderId, razorpay_payment_id: p2.paymentId, razorpay_signature: p2.signature } });
    assert.equal(receiptsTo(user.email), 2);
    const last = lastMailTo(user.email);
    assert.match(last.text, /Paid so far: ₹1,100/);
    assert.match(last.text, /paid in full/i);
    assert.ok(!/Balance still to pay/.test(last.text));
    assert.ok(!/Pay the balance/.test(last.html));
  });

  it("a payment the admin records by hand is receipted too, marked as recorded by the team", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    const made = await api("/admin/payments/manual", { token: admin, body: { userId: user.id, amount: 700, reference: "UPI-RCT-1", note: "paid at the temple" } });
    assert.equal(made.status, 201);
    assert.equal(receiptsTo(user.email), 1);
    const mail = lastMailTo(user.email);
    assert.match(mail.text, /Recorded by the Shyam Jagat team \(paid at the temple\)/);
    assert.match(mail.text, /Amount paid: ₹700/);
  });

  it("an admin reconciling a stuck payment sends its receipt", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    const { orderId } = order.body.data;
    const [row] = await sql(`SELECT id FROM registration_payments WHERE razorpay_order_id = $1`, [orderId]);
    const { registerOrderPayments } = await import("./helpers.js");
    registerOrderPayments(orderId, [{ id: `pay_rct_found_${Date.now()}`, status: "captured", amount: order.body.data.amount }]);
    const res = await api(`/admin/payments/${row.id}/reconcile`, { method: "POST", token: await adminToken() });
    assert.equal(res.body.data.status, "paid");
    assert.equal(receiptsTo(user.email), 1);
  });

  it("a payment that was not completed sends nothing", async () => {
    const user = await createUser(TAG);
    await api("/payments/registration/order", { token: await tokenOf(user), body: { amount: 501 } });
    assert.equal(receiptsTo(user.email), 0);
  });

  it("an email problem never undoes the payment", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const p = await pay(user, token, 501);
    // An address the mail layer will choke on or ignore. It keeps the autotest+ prefix so cleanup still finds it.
    await sql(`UPDATE users SET email = $2 WHERE id = $1`, [user.id, `autotest+${TAG}-bad-address-${Date.now()}`]);
    const res = await api("/payments/registration/verify", { token, body: { razorpay_order_id: p.orderId, razorpay_payment_id: p.paymentId, razorpay_signature: p.signature } });
    assert.equal(res.status, 200);
    const [row] = await sql(`SELECT status FROM registration_payments WHERE razorpay_order_id = $1`, [p.orderId]);
    assert.equal(row.status, "paid");
  });
});

describe("donation receipts", () => {
  const email = () => `autotest+${TAG}-donor-${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
  async function donate({ wantReceipt = true, donorEmail = email() } = {}) {
    const order = await api("/donations/create-order", { body: { amount: 1500, cause: "Temple Renovation", donorName: "Gita Devi", email: donorEmail, phone: "9876543210", anonymous: false, wantReceipt } });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const { orderId } = order.body.data;
    const paymentId = `pay_rct_don_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    return { orderId, paymentId, donorEmail, signature: signPayment(orderId, paymentId) };
  }
  const verify = (d) => api("/donations/verify", { body: { razorpay_order_id: d.orderId, razorpay_payment_id: d.paymentId, razorpay_signature: d.signature } });

  it("a donor who asked for a receipt gets one, with the cause and the amount, once", async () => {
    const d = await donate();
    assert.equal((await verify(d)).status, 200);
    await verify(d);
    assert.equal(mailCountTo(d.donorEmail, "donation"), 1);
    const mail = lastMailTo(d.donorEmail);
    assert.match(mail.subject, /Thank you for your donation of ₹1,500 - receipt SJ-DON-/);
    assert.match(mail.text, /Cause: Temple Renovation/);
    assert.match(mail.text, /Amount: ₹1,500/);
  });

  it("no receipt when the donor did not ask for one", async () => {
    const d = await donate({ wantReceipt: false });
    await verify(d);
    assert.equal(mailCountTo(d.donorEmail, "donation"), 0);
  });
});
