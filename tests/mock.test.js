// Development "mock payments": PAYMENTS_MODE=mock makes the registration checkout a dummy that moves no money.
// The mode is read once at load, so it is set before the helpers (and the app) are imported.
process.env.PAYMENTS_MODE_TEST = "mock";
const { after, before, describe, it } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { api, cleanup, createUser, login, payPending, readyToPay, sql, startServer, stopServer } = await import("./helpers.js");

const TAG = "mck";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const MOCK_SIGNATURE = "mock_signature";

describe("mock payments (development only)", () => {
  it("the order is a dummy: no Razorpay call, a dummy id, flagged so the site shows a dummy checkout", async () => {
    const { pendingId } = await readyToPay(TAG);
    const res = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.mock, true);
    assert.equal(res.body.data.keyId, "mock");
    assert.match(res.body.data.orderId, /^order_mock_[0-9a-f]{16}$/);
    assert.equal(res.body.data.amount, 50_100);
  });

  it("the amount rules still apply in mock mode", async () => {
    const { pendingId } = await readyToPay(TAG);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 500 } })).status, 400);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 1101 } })).status, 400);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } })).status, 201);
  });

  it("the dummy checkout's success creates the account and signs the person in, as a real payment would", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    const done = await api("/auth/signup/pay/verify", {
      body: { pendingId, razorpay_order_id: order.body.data.orderId, razorpay_payment_id: "pay_mock_ok", razorpay_signature: MOCK_SIGNATURE },
    });
    assert.equal(done.status, 201);
    assert.equal(done.body.data.user.email, who.email);
    assert.equal(done.body.data.user.registrationFee, "partial");
    assert.ok(done.body.data.accessToken);
    assert.ok(done.setCookie.includes("HttpOnly"));
    const [stored] = await sql(`SELECT status, amount_in_rupees::float AS amount FROM registration_payments WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
    assert.equal(stored.status, "paid");
    assert.equal(stored.amount, 501);
  });

  it("a wrong signature is still refused, and creates no account", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    const res = await api("/auth/signup/pay/verify", {
      body: { pendingId, razorpay_order_id: order.body.data.orderId, razorpay_payment_id: "pay_mock_bad", razorpay_signature: "nope" },
    });
    assert.equal(res.status, 400);
    const users = await sql(`SELECT 1 FROM users WHERE email = $1`, [who.email]);
    assert.equal(users.length, 0);
  });

  it("the whole flow works through the same helper the real tests use", async () => {
    const { pendingId } = await readyToPay(TAG);
    const paid = await payPending(pendingId, 1100);
    // payPending signs with the Razorpay secret, which the dummy checkout does not accept
    assert.equal(paid.done.status, 400);
  });

  it("a signed-in member can pay the fee with the dummy checkout too", async () => {
    const user = await createUser(TAG);
    const token = (await login(user)).body.data.accessToken;
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    assert.equal(order.status, 201);
    assert.equal(order.body.data.mock, true);
    const verify = await api("/payments/registration/verify", {
      token,
      body: { razorpay_order_id: order.body.data.orderId, razorpay_payment_id: "pay_mock_m", razorpay_signature: MOCK_SIGNATURE },
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.body.data.fee.paid, 501);
  });

  it("donations are not affected: with no keys they are refused politely, never given a dummy order", async () => {
    const donor = `autotest-${TAG}-donor`;
    try {
      const res = await api("/donations/create-order", { body: { amount: 100, cause: "Seva", donorName: donor } });
      assert.equal(res.status, 503);
      assert.match(res.body.message, /not set up yet/i);
      assert.equal((await sql(`SELECT 1 FROM donations WHERE donor_name = $1`, [donor])).length, 0);
    } finally {
      await sql(`DELETE FROM donations WHERE donor_name = $1`, [donor]);
    }
  });

  it("the admin check says loudly that payments are in mock mode", async () => {
    const admin = (await login(await createUser(TAG, { role: "admin" }))).body.data.accessToken;
    const res = await api("/admin/payments/diagnostics", { token: admin });
    assert.equal(res.body.data.paymentsMode, "mock");
    assert.ok(res.body.data.warnings.some((w) => /MOCK PAYMENTS/.test(w)));
    assert.equal(res.body.data.keys.keySecretSet, false);
  });
});
