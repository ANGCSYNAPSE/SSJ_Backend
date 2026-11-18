import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  cleanup,
  createUser,
  login,
  signPayment,
  signWebhook,
  sql,
  startServer,
  stopServer,
} from "./helpers.js";

const TAG = "pay";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;

/** Orders and pays `amount` the way the dashboard does (Razorpay itself is stubbed). */
async function payAsMember(token, amount) {
  const order = await api("/payments/registration/order", { token, body: { amount } });
  if (order.status !== 201) return { order };
  const { orderId } = order.body.data;
  const paymentId = `pay_autotest_${Date.now()}`;
  const verify = await api("/payments/registration/verify", {
    token,
    body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signPayment(orderId, paymentId) },
  });
  return { order, orderId, paymentId, verify };
}

const feeOf = async (token) => (await api("/payments/me", { token })).body.data.fee;

describe("the registration fee: one ₹1100 fee, payable in parts, at least ₹501 first", () => {
  it("the rules are public: total 1100, minimum 501", async () => {
    const res = await api("/payments/fee");
    assert.deepEqual(res.body.data, { total: 1100, minimum: 501 });
  });

  it("a member who has paid nothing is 'pending' and may pay between 501 and 1100", async () => {
    const token = await tokenOf(await createUser(TAG));
    const fee = await feeOf(token);
    assert.equal(fee.status, "pending");
    assert.equal(fee.paid, 0);
    assert.equal(fee.balance, 1100);
    assert.equal(fee.nextMin, 501);
    assert.equal(fee.nextMax, 1100);
  });

  it("amounts outside the rules are refused, with a reason", async () => {
    const token = await tokenOf(await createUser(TAG));
    const below = await api("/payments/registration/order", { token, body: { amount: 500 } });
    assert.equal(below.status, 400);
    assert.match(below.body.message, /minimum payment is ₹501/);
    const above = await api("/payments/registration/order", { token, body: { amount: 1101 } });
    assert.equal(above.status, 400);
    assert.match(above.body.message, /1100/);
    assert.equal((await api("/payments/registration/order", { token, body: { amount: 50.5 } })).status, 400);
    assert.equal((await api("/payments/registration/order", { token, body: { amount: -10 } })).status, 400);
  });

  it("paying ₹501 makes the member 'partial' with a ₹599 balance; the rest can be paid later", async () => {
    const token = await tokenOf(await createUser(TAG));
    const first = await payAsMember(token, 501);
    assert.equal(first.verify.status, 200);
    assert.equal(first.verify.body.data.fee.status, "partial");

    const fee = await feeOf(token);
    assert.equal(fee.paid, 501);
    assert.equal(fee.balance, 599);
    assert.equal(fee.nextMax, 599);

    const second = await payAsMember(token, 599);
    assert.equal(second.verify.status, 200);
    assert.equal((await feeOf(token)).status, "paid");
  });

  it("while ₹599 is due, a payment of 100 or 600 is refused", async () => {
    const token = await tokenOf(await createUser(TAG));
    await payAsMember(token, 501);
    assert.equal((await api("/payments/registration/order", { token, body: { amount: 100 } })).status, 400);
    const over = await api("/payments/registration/order", { token, body: { amount: 600 } });
    assert.equal(over.status, 400);
    assert.match(over.body.message, /599/);
  });

  it("when the fee is paid in full, another order is refused", async () => {
    const token = await tokenOf(await createUser(TAG));
    await payAsMember(token, 1100);
    const again = await api("/payments/registration/order", { token, body: { amount: 501 } });
    assert.equal(again.status, 409);
  });

  it("orders are stamped as Shyam Jagat registration fees and stored", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const { order } = await payAsMember(token, 600);
    assert.equal(order.body.data.amount, 60_000, "amounts go to Razorpay in paise");
    const [row] = await sql(`SELECT receipt, plan, status, user_id FROM registration_payments WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
    assert.match(row.receipt, /^SJ-REG-/);
    assert.equal(row.plan, "part");
    assert.equal(row.user_id, user.id);
  });

  it("a wrong signature does not mark anything paid", async () => {
    const token = await tokenOf(await createUser(TAG));
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    const res = await api("/payments/registration/verify", {
      token,
      body: { razorpay_order_id: order.body.data.orderId, razorpay_payment_id: "pay_z", razorpay_signature: "00" },
    });
    assert.equal(res.status, 400);
    assert.equal((await feeOf(token)).paid, 0);
  });

  it("nobody can claim another member's order", async () => {
    const a = await tokenOf(await createUser(TAG));
    const b = await tokenOf(await createUser(TAG));
    const order = await api("/payments/registration/order", { token: a, body: { amount: 501 } });
    const res = await api("/payments/registration/verify", {
      token: b,
      body: {
        razorpay_order_id: order.body.data.orderId,
        razorpay_payment_id: "pay_q",
        razorpay_signature: signPayment(order.body.data.orderId, "pay_q"),
      },
    });
    assert.equal(res.status, 404);
  });

  it("the payment routes need a signed-in member", async () => {
    assert.equal((await api("/payments/me")).status, 401);
    assert.equal((await api("/payments/registration/order", { body: { amount: 501 } })).status, 401);
  });
});

describe("the Razorpay webhook", () => {
  const send = (event, signature) => {
    const raw = JSON.stringify(event);
    return api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signature ?? signWebhook(raw) } });
  };
  const ours = { app: "shyam_jagat", purpose: "registration_fee" };

  it("a bad signature is refused", async () => {
    assert.equal((await send({ event: "payment.captured" }, "not-the-signature")).status, 400);
  });

  it("a captured payment marks our order paid (the browser may never come back)", async () => {
    const token = await tokenOf(await createUser(TAG));
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    const orderId = order.body.data.orderId;
    const res = await send({ event: "payment.captured", payload: { payment: { entity: { id: "pay_wh1", order_id: orderId, notes: ours } } } });
    assert.equal(res.status, 200);
    assert.equal((await feeOf(token)).paid, 501);
  });

  it("a payment tagged for another app is ignored", async () => {
    const token = await tokenOf(await createUser(TAG));
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    await send({ event: "payment.captured", payload: { payment: { entity: { id: "pay_wh2", order_id: order.body.data.orderId, notes: { app: "other_app" } } } } });
    assert.equal((await feeOf(token)).paid, 0);
  });

  it("a failed event records the failure, but cannot undo a payment that succeeded", async () => {
    const token = await tokenOf(await createUser(TAG));
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    const orderId = order.body.data.orderId;
    await send({ event: "payment.failed", payload: { payment: { entity: { id: "pay_wh3", order_id: orderId, error_description: "card declined", notes: ours } } } });
    const [failed] = await sql(`SELECT status, failure_reason FROM registration_payments WHERE razorpay_order_id = $1`, [orderId]);
    assert.equal(failed.status, "failed");
    assert.equal(failed.failure_reason, "card declined");

    await send({ event: "payment.captured", payload: { payment: { entity: { id: "pay_wh4", order_id: orderId, notes: ours } } } });
    await send({ event: "payment.failed", payload: { payment: { entity: { id: "pay_wh5", order_id: orderId, notes: ours } } } });
    const [still] = await sql(`SELECT status FROM registration_payments WHERE razorpay_order_id = $1`, [orderId]);
    assert.equal(still.status, "paid");
  });

  it("a webhook for an unknown order does no harm", async () => {
    const res = await send({ event: "payment.captured", payload: { payment: { entity: { id: "pay_wh6", order_id: "order_does_not_exist", notes: ours } } } });
    assert.equal(res.status, 200);
  });
});

describe("what the admin sees", () => {
  it("members cannot open the admin payment reports; admins can", async () => {
    const member = await tokenOf(await createUser(TAG));
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    for (const path of ["/admin/payments", "/admin/payments/summary", "/admin/payments/pending"]) {
      assert.equal((await api(path, { token: member })).status, 403, `${path} must be closed to members`);
      assert.equal((await api(path, { token: admin })).status, 200, `${path} must be open to admins`);
      assert.equal((await api(path)).status, 401, `${path} must need sign-in`);
    }
  });

  it("the summary adds up: collected, fully paid, part paid, unpaid and the outstanding balance", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const before = (await api("/admin/payments/summary", { token: admin })).body.data;

    const partial = await tokenOf(await createUser(TAG));
    const full = await tokenOf(await createUser(TAG));
    await createUser(TAG); // pays nothing
    await payAsMember(partial, 501);
    await payAsMember(full, 1100);

    const after = (await api("/admin/payments/summary", { token: admin })).body.data;
    assert.deepEqual(after.fee, { total: 1100, minimum: 501 });
    assert.equal(after.collected.amount - before.collected.amount, 1601);
    assert.equal(after.members.fullyPaid - before.members.fullyPaid, 1);
    assert.equal(after.members.partial - before.members.partial, 1);
    assert.equal(after.members.unpaid - before.members.unpaid, 1);
    assert.equal(after.outstanding.amount - before.outstanding.amount, 599 + 1100);
  });

  it("the pending list shows who owes what, filterable by state", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const partialUser = await createUser(TAG);
    await payAsMember(await tokenOf(partialUser), 501);
    const unpaidUser = await createUser(TAG);

    const partial = (await api(`/admin/payments/pending?state=partial&q=${encodeURIComponent(partialUser.email)}`, { token: admin })).body.data;
    assert.equal(partial.total, 1);
    assert.equal(partial.items[0].state, "partial");
    assert.equal(partial.items[0].paid, 501);
    assert.equal(partial.items[0].balance, 599);

    const unpaid = (await api(`/admin/payments/pending?state=pending&q=${encodeURIComponent(unpaidUser.email)}`, { token: admin })).body.data;
    assert.equal(unpaid.items[0].balance, 1100);

    // a fully paid member is not on the list
    const paidUser = await createUser(TAG);
    await payAsMember(await tokenOf(paidUser), 1100);
    const none = (await api(`/admin/payments/pending?q=${encodeURIComponent(paidUser.email)}`, { token: admin })).body.data;
    assert.equal(none.total, 0);
  });

  it("the payment list filters by status, type and person; bad filters are refused", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const user = await createUser(TAG);
    await payAsMember(await tokenOf(user), 501);

    const mine = (await api(`/admin/payments?userId=${user.id}`, { token: admin })).body.data;
    assert.equal(mine.total, 1);
    assert.equal(mine.items[0].amount, 501);
    assert.equal(mine.items[0].status, "paid");
    assert.equal(mine.items[0].plan, "part");

    assert.equal((await api(`/admin/payments?userId=${user.id}&status=failed`, { token: admin })).body.data.total, 0);
    assert.equal((await api("/admin/payments?status=bogus", { token: admin })).status, 400);
    assert.equal((await api("/admin/payments?plan=basic", { token: admin })).status, 400);
  });

  it("an admin can record an offline payment, but never more than what is due", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const user = await createUser(TAG);
    const over = await api("/admin/payments/manual", { token: admin, body: { userId: user.id, amount: 2000, reference: "UPI-1" } });
    assert.equal(over.status, 400);

    const ok = await api("/admin/payments/manual", { token: admin, body: { userId: user.id, amount: 1100, reference: "UPI-2", note: "paid at the temple" } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.status, "paid");
    assert.equal(ok.body.data.plan, "manual");
    assert.equal((await feeOf(await tokenOf(user))).status, "paid");

    const again = await api("/admin/payments/manual", { token: admin, body: { userId: user.id, amount: 100, reference: "UPI-3" } });
    assert.equal(again.status, 409);
  });
});

describe("the fee is changed by an admin, not in code", () => {
  it("only admins can read or change it", async () => {
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await api("/admin/payments/settings", { token: member })).status, 403);
    assert.equal((await api("/admin/payments/settings", { method: "PUT", token: member, body: { total: 1200, minimum: 600 } })).status, 403);
    assert.equal((await api("/admin/payments/settings")).status, 401);
  });

  it("refuses fees that make no sense, and changes nothing", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const before = (await api("/admin/payments/settings", { token: admin })).body.data.fee;
    const bad = [
      { total: 1000, minimum: 1500 }, // minimum above the total
      { total: 50, minimum: 10 }, // total too small
      { total: 1000.5, minimum: 500 }, // not whole rupees
      { total: "1000", minimum: 500 }, // not a number
      { total: 1000 }, // minimum missing
      { total: 5_000_000, minimum: 500 }, // absurdly large
      { total: 1000, minimum: 0 },
    ];
    for (const body of bad) {
      const res = await api("/admin/payments/settings", { method: "PUT", token: admin, body });
      assert.equal(res.status, 400, `should refuse ${JSON.stringify(body)}`);
    }
    assert.deepEqual((await api("/admin/payments/settings", { token: admin })).body.data.fee, before);
  });

  it("a new fee takes effect straight away for payments, then is put back", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const original = (await api("/admin/payments/settings", { token: admin })).body.data.fee;
    try {
      const saved = await api("/admin/payments/settings", { method: "PUT", token: admin, body: { total: 1200, minimum: 600 } });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.body.data.fee, { total: 1200, minimum: 600 });

      assert.deepEqual((await api("/payments/fee")).body.data, { total: 1200, minimum: 600 });
      const member = await tokenOf(await createUser(TAG));
      const fee = await feeOf(member);
      assert.equal(fee.total, 1200);
      assert.equal(fee.nextMin, 600);
      assert.equal((await api("/payments/registration/order", { token: member, body: { amount: 599 } })).status, 400, "below the new minimum");
      assert.equal((await api("/payments/registration/order", { token: member, body: { amount: 1201 } })).status, 400, "above the new total");
      const paid = await payAsMember(member, 600);
      assert.equal(paid.verify.status, 200);
      assert.equal((await feeOf(member)).balance, 600);

      const settings = (await api("/admin/payments/settings", { token: admin })).body.data;
      assert.ok(settings.updatedAt);
      assert.deepEqual(settings.defaults, { total: 1100, minimum: 501 });
    } finally {
      await api("/admin/payments/settings", { method: "PUT", token: admin, body: original });
    }
    assert.deepEqual((await api("/payments/fee")).body.data, original, "the fee is back to what it was");
  });
});

describe("Razorpay diagnostics", () => {
  it("shows what is configured without ever revealing the secret", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const res = await api("/admin/payments/diagnostics", { token: admin });
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.keys.keyIdSet, true);
    assert.equal(d.keys.keySecretSet, true);
    assert.equal(d.keys.keySecretLength, "autotest_key_secret".length);
    assert.equal(d.mode, "test");
    assert.equal(typeof d.apiCheck.ok, "boolean");
    assert.deepEqual(Object.keys(d.keys).sort(), ["keyId", "keyIdSet", "keySecretLength", "keySecretSet", "webhookSecretLength", "webhookSecretSet"]);

    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("autotest_key_secret"), "the secret must never be in the response");
    assert.ok(!raw.includes("autotest_webhook_secret"), "the webhook secret must never be in the response");
    assert.ok(!raw.includes("rzp_test_autotest"), "only the start of the key id is shown");
  });

  it("is closed to members and visitors", async () => {
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await api("/admin/payments/diagnostics", { token: member })).status, 403);
    assert.equal((await api("/admin/payments/diagnostics")).status, 401);
  });
});
