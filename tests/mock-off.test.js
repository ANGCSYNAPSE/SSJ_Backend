// The dummy checkout must switch itself off when real Razorpay keys are present, even if PAYMENTS_MODE=mock is
// still set: that is how "the mock goes away when the real keys arrive" is guaranteed.
process.env.PAYMENTS_MODE_TEST = "mock-with-keys";
const { after, before, describe, it } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { api, cleanup, createUser, login, readyToPay, sql, startServer, stopServer, payPending } = await import("./helpers.js");

const TAG = "mof";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

describe("PAYMENTS_MODE=mock with real keys present", () => {
  it("the orders are real orders, not dummy ones", async () => {
    const { pendingId } = await readyToPay(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    assert.equal(order.status, 201);
    assert.equal(order.body.data.mock, false);
    assert.equal(order.body.data.keyId, "rzp_test_autotest");
    assert.ok(!order.body.data.orderId.startsWith("order_mock_"));
  });

  it("the dummy signature no longer works, so nothing can bypass the real payment", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    const res = await api("/auth/signup/pay/verify", {
      body: { pendingId, razorpay_order_id: order.body.data.orderId, razorpay_payment_id: "pay_mock_x", razorpay_signature: "mock_signature" },
    });
    assert.equal(res.status, 400);
    assert.equal((await sql(`SELECT 1 FROM users WHERE email = $1`, [who.email])).length, 0);
  });

  it("a real, correctly signed payment still creates the account", async () => {
    const { pendingId } = await readyToPay(TAG);
    const paid = await payPending(pendingId, 501);
    assert.equal(paid.done.status, 201);
  });

  it("the admin check says the leftover switch can be removed", async () => {
    const admin = (await login(await createUser(TAG, { role: "admin" }))).body.data.accessToken;
    const res = await api("/admin/payments/diagnostics", { token: admin });
    assert.equal(res.body.data.paymentsMode, "razorpay");
    assert.ok(res.body.data.warnings.some((w) => /PAYMENTS_MODE=mock is still set/.test(w)));
    assert.ok(!res.body.data.warnings.some((w) => /MOCK PAYMENTS are on/.test(w)));
  });
});
