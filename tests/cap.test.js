// The largest single payment the Razorpay account allows (RAZORPAY_MAX_ORDER_AMOUNT) is read once at load,
// so this file sets a small cap before the app is imported.
process.env.RAZORPAY_MAX_ORDER_AMOUNT = "600";
const { after, before, describe, it } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { api, cleanup, createUser, login, readyToPay, startServer, stopServer, sql } = await import("./helpers.js");

const TAG = "cap";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

describe("the single-payment cap", () => {
  it("a payment above the cap is refused with a plain message, before Razorpay is asked", async () => {
    const token = (await login(await createUser(TAG))).body.data.accessToken;
    const res = await api("/payments/registration/order", { token, body: { amount: 1100 } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /largest single payment allowed is ₹600/);
    const rows = await sql(`SELECT 1 FROM registration_payments WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'autotest+cap-%')`);
    assert.equal(rows.length, 0, "no payment row may be left behind");
  });

  it("a payment within the cap goes through", async () => {
    const token = (await login(await createUser(TAG))).body.data.accessToken;
    assert.equal((await api("/payments/registration/order", { token, body: { amount: 501 } })).status, 201);
    assert.equal((await api("/payments/registration/order", { token, body: { amount: 600 } })).status, 201);
  });

  it("the signup payment obeys the same cap", async () => {
    const { pendingId } = await readyToPay(TAG);
    const res = await api("/auth/signup/pay/order", { body: { pendingId, amount: 1100 } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /largest single payment/);
  });
});
