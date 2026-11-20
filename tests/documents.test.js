import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, raw, registerPayment, signPayment, sql, startServer, stopServer } from "./helpers.js";

const TAG = "doc";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const adminToken = async () => tokenOf(await createUser(TAG, { role: "admin" }));

async function paidMember(amount = 501) {
  const user = await createUser(TAG);
  const token = await tokenOf(user);
  const order = await api("/payments/registration/order", { token, body: { amount } });
  const { orderId } = order.body.data;
  const paymentId = `pay_doc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  registerPayment(paymentId, { orderId, amount: order.body.data.amount });
  await api("/payments/registration/verify", { token, body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signPayment(orderId, paymentId) } });
  const [row] = await sql(`SELECT id, receipt FROM registration_payments WHERE razorpay_order_id = $1`, [orderId]);
  return { user, token, id: row.id, receipt: row.receipt, paymentId };
}
const text = (r) => r.buffer.toString("latin1");

describe("receipts and invoices as PDF", () => {
  it("a member previews their own receipt: a real PDF with the receipt number, the payment and the amount", async () => {
    const { token, id, receipt, paymentId } = await paidMember(501);
    const res = await raw(`/payments/documents/${id}?kind=receipt`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(res.headers.get("content-disposition"), /^inline; filename="Shyam-Jagat-Receipt-/);
    assert.equal(text(res).slice(0, 5), "%PDF-");
    assert.ok(text(res).trimEnd().endsWith("%%EOF"));
    for (const expected of [receipt, paymentId, "INR 501.00", "RECEIPT", "BILLED TO", "Balance due", "INR 599.00"]) assert.ok(text(res).includes(expected), expected);
  });

  it("download=1 makes it a download", async () => {
    const { token, id } = await paidMember(501);
    const res = await raw(`/payments/documents/${id}?download=1`, { token });
    assert.match(res.headers.get("content-disposition"), /^attachment; filename=".*\.pdf"$/);
  });

  it("the invoice shows the whole fee, what was paid and the balance due", async () => {
    const { token, id } = await paidMember(600);
    const res = await raw(`/payments/documents/${id}?kind=invoice`, { token });
    assert.equal(res.status, 200);
    for (const expected of ["INVOICE", "INVOICE NO", "INV-", "Registration fee", "INR 1,100.00", "INR 600.00", "INR 500.00", "PART PAID"]) assert.ok(text(res).includes(expected), expected);
  });

  it("an invoice for a fee paid in full says so", async () => {
    const { token, id } = await paidMember(1100);
    const json = await api(`/payments/documents/${id}?kind=invoice&format=json`, { token });
    assert.equal(json.status, 200);
    assert.equal(json.body.data.status, "PAID IN FULL");
    assert.equal(json.body.data.summary.at(-1).value, "INR 0.00");
  });

  it("a refund shows on the receipt and the invoice", async () => {
    const { token, id } = await paidMember(1100);
    const admin = await adminToken();
    assert.equal((await api(`/admin/payments/${id}/refund`, { token: admin, body: { amount: 200, reason: "Goodwill" } })).status, 200);
    const receipt = await raw(`/payments/documents/${id}`, { token });
    assert.ok(text(receipt).includes("Refund made to you"));
    assert.ok(text(receipt).includes("INR 900.00"), "paid so far is net of the refund");
    const invoice = await api(`/payments/documents/${id}?kind=invoice&format=json`, { token });
    assert.ok(invoice.body.data.lines.some((l) => l.description === "Refund made to you" && l.amount === 200));
  });

  it("people only see their own documents; admins see anyone's", async () => {
    const mine = await paidMember(501);
    const other = await createUser(TAG);
    assert.equal((await raw(`/payments/documents/${mine.id}`, { token: await tokenOf(other) })).status, 404);
    assert.equal((await raw(`/payments/documents/${mine.id}`)).status, 401);

    const asAdmin = await raw(`/admin/payments/${mine.id}/document?kind=invoice`, { token: await adminToken() });
    assert.equal(asAdmin.status, 200);
    assert.ok(text(asAdmin).includes("INVOICE"));
    assert.equal((await raw(`/admin/payments/${mine.id}/document`, { token: mine.token })).status, 403);
  });

  it("a payment that was not completed has no receipt, and a bad id is a 404", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    const [row] = await sql(`SELECT id FROM registration_payments WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
    const res = await api(`/payments/documents/${row.id}?format=json`, { token });
    assert.equal(res.status, 400);
    assert.equal((await raw(`/payments/documents/not-a-uuid`, { token })).status, 404);
    assert.equal((await raw(`/payments/documents/${row.id}?kind=bogus`, { token })).status, 400);
  });

  it("text outside Latin letters and special characters never break the file", async () => {
    const { token, id, user } = await paidMember(501);
    await sql(`UPDATE users SET full_name = $2 WHERE id = $1`, [user.id, "Gīta (Devī) \ श्याम"]);
    const res = await raw(`/payments/documents/${id}`, { token });
    assert.equal(res.status, 200);
    assert.ok(text(res).trimEnd().endsWith("%%EOF"));
  });
});
