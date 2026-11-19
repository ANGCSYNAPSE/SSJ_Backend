import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  cleanup,
  createUser,
  login,
  readyToPay,
  registerOrderPayments,
  registerPayment,
  setOrdersFail,
  setRazorpayDown,
  signPayment,
  signWebhook,
  sql,
  startServer,
  stopServer,
} from "./helpers.js";

const TAG = "rzp";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const userCount = async (email) => (await sql(`SELECT COUNT(*)::int AS n FROM users WHERE email = $1`, [email]))[0].n;
const rowOf = async (orderId) => (await sql(`SELECT * FROM registration_payments WHERE razorpay_order_id = $1`, [orderId]))[0];

/** A member starts paying ₹501 and gets as far as the checkout window; returns what the browser would send to /verify. */
async function memberCheckout(token, amount = 501) {
  const order = await api("/payments/registration/order", { token, body: { amount } });
  assert.equal(order.status, 201);
  const { orderId } = order.body.data;
  const paymentId = `pay_rzp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return {
    orderId,
    paymentId,
    paise: order.body.data.amount,
    body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signPayment(orderId, paymentId) },
  };
}

/** The same for someone still signing up. */
async function signupCheckout(pendingId, amount = 501) {
  const order = await api("/auth/signup/pay/order", { body: { pendingId, amount } });
  assert.equal(order.status, 201);
  const { orderId } = order.body.data;
  const paymentId = `pay_rzp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  return { orderId, paymentId, paise: order.body.data.amount, signature: signPayment(orderId, paymentId) };
}
const verifySignup = (pendingId, c) =>
  api("/auth/signup/pay/verify", {
    body: { pendingId, razorpay_order_id: c.orderId, razorpay_payment_id: c.paymentId, razorpay_signature: c.signature },
  });

describe("a good signature is not enough: Razorpay must confirm the money moved (member paying)", () => {
  it("a captured payment is counted", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise, status: "captured" });
    const res = await api("/payments/registration/verify", { token, body: c.body });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.confirming, false);
    assert.equal(res.body.data.fee.paid, 501);
  });

  it("an authorised payment (auto-capture) is counted", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise, status: "authorized" });
    assert.equal((await api("/payments/registration/verify", { token, body: c.body })).body.data.fee.paid, 501);
  });

  for (const status of ["failed", "created", "refunded"]) {
    it(`a payment Razorpay reports as "${status}" is NOT counted and stays pending`, async () => {
      const token = await tokenOf(await createUser(TAG));
      const c = await memberCheckout(token);
      registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise, status });
      const res = await api("/payments/registration/verify", { token, body: c.body });
      assert.equal(res.status, 202);
      assert.equal(res.body.data.confirming, true);
      assert.equal(res.body.data.fee.paid, 0);
      assert.equal((await rowOf(c.orderId)).status, "created");
    });
  }

  it("a payment Razorpay has never heard of is not counted and stays pending", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token); // nothing registered
    const res = await api("/payments/registration/verify", { token, body: c.body });
    assert.equal(res.status, 202);
    assert.equal(res.body.data.fee.paid, 0);
    assert.equal((await rowOf(c.orderId)).status, "created");
  });

  it("when Razorpay cannot be reached the payment stays pending, not failed and not paid", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise });
    setRazorpayDown(true);
    try {
      const res = await api("/payments/registration/verify", { token, body: c.body });
      assert.equal(res.status, 202);
      assert.equal(res.body.data.confirming, true);
    } finally {
      setRazorpayDown(false);
    }
    assert.equal((await rowOf(c.orderId)).status, "created");
  });

  it("a payment for a different amount than the order is refused and marked failed", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token, 501);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: 100, status: "captured" }); // paid ₹1, not ₹501
    const res = await api("/payments/registration/verify", { token, body: c.body });
    assert.equal(res.status, 400);
    const row = await rowOf(c.orderId);
    assert.equal(row.status, "failed");
    assert.match(row.failure_reason, /did not match/i);
  });

  it("a payment that belongs to a different order is refused", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token);
    registerPayment(c.paymentId, { orderId: "order_someone_elses", amount: c.paise });
    assert.equal((await api("/payments/registration/verify", { token, body: c.body })).status, 400);
    assert.equal((await rowOf(c.orderId)).status, "failed");
  });

  it("the webhook later settles a payment that was pending, and only for the right amount", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token);
    await api("/payments/registration/verify", { token, body: c.body }); // not registered: stays pending
    const ours = { app: "shyam_jagat", purpose: "registration_fee" };
    const hook = (amount) => {
      const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: c.paymentId, order_id: c.orderId, amount, notes: ours } } } });
      return api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(raw) } });
    };
    await hook(100);
    assert.equal((await rowOf(c.orderId)).status, "created", "the wrong amount must not settle it");
    await hook(c.paise);
    assert.equal((await rowOf(c.orderId)).status, "paid");
  });
});

describe("the same rule while signing up", () => {
  it("the account is NOT created for a payment Razorpay does not confirm, and says what to do", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const c = await signupCheckout(pendingId);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise, status: "failed" });
    const res = await verifySignup(pendingId, c);
    assert.equal(res.status, 409);
    assert.match(res.body.message, /being confirmed/i);
    assert.equal(await userCount(who.email), 0);
    assert.equal((await rowOf(c.orderId)).status, "created");
  });

  it("when Razorpay cannot be reached there is no account either, and nothing is lost", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const c = await signupCheckout(pendingId);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise });
    setRazorpayDown(true);
    try {
      assert.equal((await verifySignup(pendingId, c)).status, 409);
    } finally {
      setRazorpayDown(false);
    }
    assert.equal(await userCount(who.email), 0);
    // Razorpay comes back: trying again with the same payment creates the account
    const retry = await verifySignup(pendingId, c);
    assert.equal(retry.status, 201);
  });

  it("a wrong amount is refused and creates nothing", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const c = await signupCheckout(pendingId, 501);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: 100 });
    assert.equal((await verifySignup(pendingId, c)).status, 400);
    assert.equal(await userCount(who.email), 0);
  });

  it("a payment the webhook settled after the page was lost still finishes the registration, without paying again", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const c = await signupCheckout(pendingId);
    await verifySignup(pendingId, c); // not confirmed yet
    const ours = { app: "shyam_jagat", purpose: "registration_fee" };
    const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: c.paymentId, order_id: c.orderId, amount: c.paise, notes: ours } } } });
    await api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(raw) } });

    // they sign in with the same email and password: resumed at "complete", then the account is created
    const back = await api("/auth/login", { body: { email: who.email, password: who.password } });
    assert.equal(back.body.data.resume.stage, "complete");
    const done = await api("/auth/signup/complete", { body: { pendingId } });
    assert.equal(done.status, 201);
  });
});

describe("Razorpay errors are never shown raw", () => {
  it("when Razorpay refuses to create the order, the person sees a friendly sentence", async () => {
    const token = await tokenOf(await createUser(TAG));
    setOrdersFail(true);
    try {
      const res = await api("/payments/registration/order", { token, body: { amount: 501 } });
      assert.equal(res.status, 503);
      assert.match(res.body.message, /could not start the payment/i);
      assert.ok(!/maximum amount|BAD_REQUEST/i.test(JSON.stringify(res.body)), "no raw Razorpay text");
    } finally {
      setOrdersFail(false);
    }
    // and no half-made payment row was left behind
    const rows = await sql(`SELECT 1 FROM registration_payments WHERE status = 'created' AND receipt LIKE 'SJ-REG-%' AND user_id IS NOT NULL AND created_at > NOW() - INTERVAL '5 seconds' AND amount_in_rupees = 501 AND user_id IN (SELECT id FROM users WHERE email LIKE 'autotest+rzp-%')`);
    assert.equal(rows.length, 0);
  });

  it("when Razorpay cannot be reached at all, creating an order fails politely too", async () => {
    const token = await tokenOf(await createUser(TAG));
    setRazorpayDown(true);
    try {
      const res = await api("/payments/registration/order", { token, body: { amount: 501 } });
      assert.equal(res.status, 503);
      assert.match(res.body.message, /could not start the payment/i);
    } finally {
      setRazorpayDown(false);
    }
  });
});

describe("admin: reconcile a stuck payment", () => {
  /** A member's checkout that never came back: a "created" row older than 30 minutes. */
  async function stuck() {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const c = await memberCheckout(token);
    await sql(`UPDATE registration_payments SET created_at = NOW() - INTERVAL '2 hours' WHERE razorpay_order_id = $1`, [c.orderId]);
    const row = await rowOf(c.orderId);
    return { user, token, c, id: row.id };
  }
  const adminToken = async () => tokenOf(await createUser(TAG, { role: "admin" }));
  const reconcile = (token, id) => api(`/admin/payments/${id}/reconcile`, { method: "POST", token });

  it("finds a captured payment for the order and marks it paid", async () => {
    const { token, c, id } = await stuck();
    registerOrderPayments(c.orderId, [{ id: "pay_found_1", status: "captured", amount: c.paise }]);
    const res = await reconcile(await adminToken(), id);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "paid");
    assert.equal(res.body.data.paymentId, "pay_found_1");
    assert.equal((await api("/payments/me", { token })).body.data.fee.paid, 501);
  });

  it("finding no payment marks the attempt as abandoned (failed)", async () => {
    const { c, id } = await stuck();
    registerOrderPayments(c.orderId, []);
    const res = await reconcile(await adminToken(), id);
    assert.equal(res.body.data.status, "failed");
    assert.match(res.body.data.failureReason, /abandoned/i);
  });

  it("a captured payment for the wrong amount does not count", async () => {
    const { c, id } = await stuck();
    registerOrderPayments(c.orderId, [{ id: "pay_found_2", status: "captured", amount: 100 }]);
    assert.equal((await reconcile(await adminToken(), id)).body.data.status, "failed");
  });

  it("when Razorpay cannot be reached nothing changes (502)", async () => {
    const { c, id } = await stuck();
    registerOrderPayments(c.orderId, [{ id: "pay_found_3", status: "captured", amount: c.paise }]);
    const token = await adminToken();
    setRazorpayDown(true);
    try {
      assert.equal((await reconcile(token, id)).status, 502);
    } finally {
      setRazorpayDown(false);
    }
    assert.equal((await rowOf(c.orderId)).status, "created");
  });

  it("a payment that is already paid is left alone", async () => {
    const { token, c } = await stuck();
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise });
    await api("/payments/registration/verify", { token, body: c.body });
    const row = await rowOf(c.orderId);
    const res = await reconcile(await adminToken(), row.id);
    assert.equal(res.body.data.status, "paid");
    assert.match(res.body.message, /nothing to reconcile/i);
  });

  it("is for administrators only, and an unknown payment is a 404", async () => {
    const { id } = await stuck();
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await reconcile(member, id)).status, 403);
    assert.equal((await api(`/admin/payments/${id}/reconcile`, { method: "POST" })).status, 401);
    assert.equal((await reconcile(await adminToken(), "11111111-1111-4111-8111-111111111111")).status, 404);
  });
});

describe("a Razorpay fee paid by the customer makes the payment a little MORE than the order", () => {
  const FEE_PAISE = 1298; // ₹12.98 on top of ₹1,100, as in the real dashboard

  it("a member's payment that covers the order plus the fee is counted for the fee amount, not the extra", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token, 1100);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise + FEE_PAISE, status: "captured" });
    const res = await api("/payments/registration/verify", { token, body: c.body });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.fee.paid, 1100, "the fee counts the order amount, not Razorpay's extra");
    assert.equal(res.body.data.fee.status, "paid");
    assert.equal((await rowOf(c.orderId)).status, "paid");
  });

  it("a signup payment that includes the fee creates the account", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const c = await signupCheckout(pendingId, 1100);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise + FEE_PAISE });
    const res = await verifySignup(pendingId, c);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, who.email);
    assert.equal(res.body.data.user.registrationFee, "paid");
  });

  it("the webhook accepts it too", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token, 1100);
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: c.paymentId, order_id: c.orderId, amount: c.paise + FEE_PAISE, notes: { app: "shyam_jagat", purpose: "registration_fee" } } } },
    });
    await api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(raw) } });
    assert.equal((await rowOf(c.orderId)).status, "paid");
  });

  it("paying LESS than the order is still refused", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token, 1100);
    registerPayment(c.paymentId, { orderId: c.orderId, amount: c.paise - 1 });
    assert.equal((await api("/payments/registration/verify", { token, body: c.body })).status, 400);
    assert.equal((await rowOf(c.orderId)).status, "failed");
  });

  it("an admin can recover a genuine payment that was wrongly marked failed", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const c = await memberCheckout(token, 1100);
    await sql(`UPDATE registration_payments SET status = 'failed', failure_reason = 'Payment did not match the order' WHERE razorpay_order_id = $1`, [c.orderId]);
    registerOrderPayments(c.orderId, [{ id: "pay_recovered", status: "captured", amount: c.paise + FEE_PAISE }]);
    const row = await rowOf(c.orderId);
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));

    const res = await api(`/admin/payments/${row.id}/reconcile`, { method: "POST", token: admin });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "paid");
    assert.equal((await api("/payments/me", { token })).body.data.fee.status, "paid");
  });

  it("a failed payment with nothing captured at Razorpay stays failed", async () => {
    const token = await tokenOf(await createUser(TAG));
    const c = await memberCheckout(token, 501);
    await sql(`UPDATE registration_payments SET status = 'failed' WHERE razorpay_order_id = $1`, [c.orderId]);
    registerOrderPayments(c.orderId, []);
    const row = await rowOf(c.orderId);
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const res = await api(`/admin/payments/${row.id}/reconcile`, { method: "POST", token: admin });
    assert.equal(res.body.data.status, "failed");
    assert.match(res.body.message, /left as failed/i);
  });
});
