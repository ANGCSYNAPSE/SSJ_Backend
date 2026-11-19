import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  cleanup,
  createUser,
  login,
  payPending,
  readyToPay,
  registerPayment,
  signPayment,
  signWebhook,
  sql,
  startServer,
  stopServer,
} from "./helpers.js";

const { audienceUserIds, audiencePreview } = await import("../src/services/audience.service.js");

const TAG = "ntf";

before(startServer);
after(async () => {
  // broadcasts made by the tests (they only ever go to test users) are removed with their notifications
  await sql(`DELETE FROM notification_broadcasts WHERE created_by IN (SELECT id FROM users WHERE email LIKE 'autotest+ntf-%')`);
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const adminToken = async () => tokenOf(await createUser(TAG, { role: "admin" }));
const sendTo = (token, userIds, over = {}) =>
  api("/admin/notifications/broadcast", {
    token,
    body: { audience: { mode: "users", userIds }, message: "Satsang this Sunday at 6 pm.", title: "Weekly satsang", category: "event", link: "/events", ...over },
  });

describe("the bell: a person's own notifications", () => {
  it("a new account has none, and the count is zero", async () => {
    const token = await tokenOf(await createUser(TAG));
    assert.equal((await api("/notifications/count", { token })).body.data.unread, 0);
    const feed = (await api("/notifications/feed", { token })).body.data;
    assert.deepEqual(feed.items, []);
    assert.equal(feed.nextCursor, null);
  });

  it("a broadcast shows up with its category, link and an unread count", async () => {
    const user = await createUser(TAG);
    const sent = await sendTo(await adminToken(), [user.id]);
    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.sent, 1);

    const token = await tokenOf(user);
    assert.equal((await api("/notifications/count", { token })).body.data.unread, 1);
    const [item] = (await api("/notifications/feed", { token })).body.data.items;
    assert.equal(item.title, "Weekly satsang");
    assert.equal(item.category, "event");
    assert.equal(item.link, "/events");
    assert.equal(item.readAt, null);
  });

  it("reading one lowers the count; reading all clears it; the unread filter follows", async () => {
    const user = await createUser(TAG);
    const admin = await adminToken();
    await sendTo(admin, [user.id], { message: "First" });
    await sendTo(admin, [user.id], { message: "Second" });
    await sendTo(admin, [user.id], { message: "Third" });
    const token = await tokenOf(user);

    const items = (await api("/notifications/feed", { token })).body.data.items;
    assert.equal(items.length, 3);
    assert.equal((await api("/notifications/read", { token, body: { ids: [items[0].id] } })).body.data.count, 1);
    assert.equal((await api("/notifications/count", { token })).body.data.unread, 2);
    assert.equal((await api("/notifications/feed?unread=true", { token })).body.data.items.length, 2);

    assert.equal((await api("/notifications/read", { token, body: {} })).body.data.count, 2);
    assert.equal((await api("/notifications/count", { token })).body.data.unread, 0);
    assert.equal((await api("/notifications/feed", { token })).body.data.items.length, 3, "read ones stay in the list");
  });

  it("pages through a long list newest first with a cursor", async () => {
    const user = await createUser(TAG);
    const admin = await adminToken();
    for (let i = 1; i <= 5; i += 1) {
      await sendTo(admin, [user.id], { message: `Message ${i}` });
      await new Promise((r) => setTimeout(r, 15));
    }
    const token = await tokenOf(user);
    const first = (await api("/notifications/feed?limit=2", { token })).body.data;
    assert.deepEqual(first.items.map((i) => i.message), ["Message 5", "Message 4"]);
    assert.ok(first.nextCursor);
    const second = (await api(`/notifications/feed?limit=2&before=${encodeURIComponent(first.nextCursor)}`, { token })).body.data;
    assert.deepEqual(second.items.map((i) => i.message), ["Message 3", "Message 2"]);
    const last = (await api(`/notifications/feed?limit=2&before=${encodeURIComponent(second.nextCursor)}`, { token })).body.data;
    assert.deepEqual(last.items.map((i) => i.message), ["Message 1"]);
    assert.equal(last.nextCursor, null);
  });

  it("filters by category", async () => {
    const user = await createUser(TAG);
    const admin = await adminToken();
    await sendTo(admin, [user.id], { category: "event", message: "An event" });
    await sendTo(admin, [user.id], { category: "seva", message: "A seva drive" });
    const token = await tokenOf(user);
    const seva = (await api("/notifications/feed?category=seva", { token })).body.data.items;
    assert.deepEqual(seva.map((i) => i.message), ["A seva drive"]);
    assert.equal((await api("/notifications/feed?category=bogus", { token })).status, 400);
  });

  it("people only ever see and change their own notifications", async () => {
    const a = await createUser(TAG);
    const b = await createUser(TAG);
    await sendTo(await adminToken(), [a.id]);
    const tokenA = await tokenOf(a);
    const tokenB = await tokenOf(b);
    const [item] = (await api("/notifications/feed", { token: tokenA })).body.data.items;

    assert.deepEqual((await api("/notifications/feed", { token: tokenB })).body.data.items, []);
    assert.equal((await api("/notifications/read", { token: tokenB, body: { ids: [item.id] } })).body.data.count, 0);
    assert.equal((await api("/notifications/count", { token: tokenA })).body.data.unread, 1, "still unread for its owner");
  });

  it("needs a signed-in person", async () => {
    for (const path of ["/notifications", "/notifications/count", "/notifications/feed"]) {
      assert.equal((await api(path)).status, 401, path);
    }
    assert.equal((await api("/notifications/read", { body: {} })).status, 401);
  });
});

describe("the admin sends to chosen people", () => {
  it("members cannot broadcast, preview an audience, or read the history", async () => {
    const member = await tokenOf(await createUser(TAG));
    const body = { audience: { mode: "all" }, message: "Hello" };
    assert.equal((await api("/admin/notifications/broadcast", { token: member, body })).status, 403);
    assert.equal((await api("/admin/notifications/audience", { token: member, body: { audience: { mode: "all" } } })).status, 403);
    assert.equal((await api("/admin/notifications/broadcasts", { token: member })).status, 403);
    assert.equal((await api("/admin/notifications/broadcast", { body })).status, 401);
  });

  it("refuses an empty message, a too-long one, and a link that leaves the site", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    assert.equal((await sendTo(admin, [user.id], { message: "   " })).status, 400);
    assert.equal((await sendTo(admin, [user.id], { message: "x".repeat(501) })).status, 400);
    assert.equal((await sendTo(admin, [user.id], { link: "https://evil.example.com/login" })).status, 400);
    assert.equal((await sendTo(admin, [user.id], { link: "//evil.example.com" })).status, 400);
    assert.equal((await sendTo(admin, [user.id], { category: "bogus" })).status, 400);
    assert.equal((await sendTo(admin, [user.id], { link: "/events/diwali-seva" })).status, 201);
  });

  it("refuses an audience that is not valid", async () => {
    const admin = await adminToken();
    const send = (audience) => api("/admin/notifications/broadcast", { token: admin, body: { audience, message: "Hi" } });
    assert.equal((await send({ mode: "users", userIds: [] })).status, 400);
    assert.equal((await send({ mode: "users", userIds: ["not-a-uuid"] })).status, 400);
    assert.equal((await send({ mode: "segment", segment: {} })).status, 400, "a segment needs at least one filter");
    assert.equal((await send({ mode: "segment", segment: { fee: "rich" } })).status, 400);
    assert.equal((await send({ mode: "everyone" })).status, 400);
  });

  it("sending to nobody says so and records nothing", async () => {
    const admin = await adminToken();
    // plain members (no registration) who are also registered as a temple: nobody can be both
    const res = await api("/admin/notifications/broadcast", {
      token: admin,
      body: { audience: { mode: "segment", segment: { registration: "none", categories: ["temple"] } }, message: "Hi" },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /nobody matches/i);
  });

  it("the history shows who it reached and how many have read it", async () => {
    const a = await createUser(TAG);
    const b = await createUser(TAG);
    const adminUser = await createUser(TAG, { role: "admin" });
    const admin = await tokenOf(adminUser);
    const sent = await sendTo(admin, [a.id, b.id], { message: "History check" });
    assert.equal(sent.body.data.sent, 2);

    await api("/notifications/read", { token: await tokenOf(a), body: {} });

    const history = (await api("/admin/notifications/broadcasts", { token: admin })).body.data;
    const entry = history.find((h) => h.id === sent.body.data.broadcastId);
    assert.ok(entry);
    assert.equal(entry.recipients, 2);
    assert.equal(entry.read, 1);
    assert.equal(entry.createdBy, adminUser.fullName);
    assert.deepEqual(entry.audience, { mode: "users", userIds: [a.id, b.id] });
  });

  it("an admin can send themselves a test", async () => {
    const adminUser = await createUser(TAG, { role: "admin" });
    const token = await tokenOf(adminUser);
    assert.equal((await sendTo(token, [adminUser.id], { message: "Just testing" })).body.data.sent, 1);
    assert.equal((await api("/notifications/count", { token })).body.data.unread, 1);
  });

  it("a person who does not exist is skipped, not an error", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    const res = await sendTo(admin, [user.id, "11111111-1111-4111-8111-111111111111"]);
    assert.equal(res.body.data.sent, 1);
  });

  it("the old 'message these people' route still works and accepts a category", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    const res = await api("/admin/notifications", { token: admin, body: { userIds: [user.id], message: "Please complete your profile", category: "registration", link: "/complete-profile" } });
    assert.equal(res.status, 201);
    const [item] = (await api("/notifications/feed", { token: await tokenOf(user) })).body.data.items;
    assert.equal(item.category, "registration");
  });
});

describe("audiences are worked out correctly (nothing is sent: the database is shared)", () => {
  const paid = (userId, amount) =>
    sql(`INSERT INTO registration_payments (user_id, plan, amount_in_rupees, status, receipt, razorpay_order_id, paid_at)
         VALUES ($1, 'full', $2, 'paid', 'SJ-REG-aud', $3, NOW())`, [userId, amount, `order_aud_${userId}_${amount}`]);

  it("'all' leaves out admins and blocked accounts", async () => {
    const member = await createUser(TAG);
    const admin = await createUser(TAG, { role: "admin" });
    const blocked = await createUser(TAG, { blocked: true });
    const ids = new Set(await audienceUserIds({ mode: "all" }));
    assert.ok(ids.has(member.id));
    assert.ok(!ids.has(admin.id), "admins are not part of 'everyone'");
    assert.ok(!ids.has(blocked.id), "blocked accounts are skipped");
  });

  it("by fee: paid in full, part paid, and unpaid are told apart", async () => {
    const none = await createUser(TAG);
    const part = await createUser(TAG);
    const full = await createUser(TAG);
    await paid(part.id, 501);
    await paid(full.id, 1100);

    const unpaid = new Set(await audienceUserIds({ mode: "segment", segment: { fee: "unpaid" } }));
    const partial = new Set(await audienceUserIds({ mode: "segment", segment: { fee: "partial" } }));
    const complete = new Set(await audienceUserIds({ mode: "segment", segment: { fee: "paid" } }));

    assert.deepEqual([unpaid.has(none.id), unpaid.has(part.id), unpaid.has(full.id)], [true, false, false]);
    assert.deepEqual([partial.has(none.id), partial.has(part.id), partial.has(full.id)], [false, true, false]);
    assert.deepEqual([complete.has(none.id), complete.has(part.id), complete.has(full.id)], [false, false, true]);
  });

  it("by registration category and by incomplete profile", async () => {
    const { pendingId, who } = await readyToPay(TAG, { category: "musician", profile: {} }, { primarySpecialty: "Tabla", city: "Jaipur", state: "Rajasthan" });
    const done = await payPending(pendingId, 501);
    assert.equal(done.done.status, 201);
    const musician = done.done.body.data.user;
    const plain = await createUser(TAG);

    const musicians = new Set(await audienceUserIds({ mode: "segment", segment: { categories: ["musician"] } }));
    assert.ok(musicians.has(musician.id));
    assert.ok(!musicians.has(plain.id));
    const temples = new Set(await audienceUserIds({ mode: "segment", segment: { categories: ["temple"] } }));
    assert.ok(!temples.has(musician.id));

    const incomplete = new Set(await audienceUserIds({ mode: "segment", segment: { categories: ["musician"], profile: "incomplete" } }));
    assert.ok(incomplete.has(musician.id), "a musician with required details missing is incomplete");
    const plainMembers = new Set(await audienceUserIds({ mode: "segment", segment: { registration: "none" } }));
    assert.ok(plainMembers.has(plain.id));
    assert.ok(!plainMembers.has(musician.id));
    const registered = new Set(await audienceUserIds({ mode: "segment", segment: { registration: "any" } }));
    assert.ok(registered.has(musician.id));
    assert.equal(who.email.startsWith("autotest+"), true);
  });

  it("filters combine (all must match)", async () => {
    const both = await createUser(TAG);
    await paid(both.id, 1100);
    const only = new Set(await audienceUserIds({ mode: "segment", segment: { fee: "paid", registration: "none" } }));
    assert.ok(only.has(both.id));
    const impossible = new Set(await audienceUserIds({ mode: "segment", segment: { fee: "paid", registration: "any", categories: ["temple"], profile: "complete" } }));
    assert.ok(!impossible.has(both.id));
  });

  it("'users' means exactly those people, admins included", async () => {
    const a = await createUser(TAG);
    const admin = await createUser(TAG, { role: "admin" });
    const ids = await audienceUserIds({ mode: "users", userIds: [a.id, admin.id] });
    assert.deepEqual(new Set(ids), new Set([a.id, admin.id]));
  });

  it("the preview counts and names a few people through the admin route", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    const res = await api("/admin/notifications/audience", { token: admin, body: { audience: { mode: "users", userIds: [user.id] } } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.count, 1);
    assert.deepEqual(res.body.data.sample, ["Auto Test"]);
    const direct = await audiencePreview({ mode: "users", userIds: [user.id] });
    assert.equal(direct.count, 1);
  });
});

describe("automatic notifications", () => {
  it("a payment received shows once, even when both the browser and the webhook report it", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const order = await api("/payments/registration/order", { token, body: { amount: 501 } });
    const { orderId } = order.body.data;
    const paymentId = `pay_ntf_${Date.now()}`;
    registerPayment(paymentId, { orderId, amount: order.body.data.amount });

    await api("/payments/registration/verify", {
      token,
      body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signPayment(orderId, paymentId) },
    });
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: order.body.data.amount, notes: { app: "shyam_jagat", purpose: "registration_fee" } } } },
    });
    await api("/payments/webhook", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": signWebhook(raw) } });

    const items = (await api("/notifications/feed?category=payment", { token })).body.data.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "Payment received");
    assert.match(items[0].message, /₹501/);
    assert.equal(items[0].kind, "success");
  });

  it("a new account gets a welcome note with what was paid", async () => {
    const { pendingId } = await readyToPay(TAG);
    const done = await payPending(pendingId, 501);
    const token = done.done.body.data.accessToken;
    const items = (await api("/notifications/feed", { token })).body.data.items;
    const welcome = items.find((i) => i.title === "Welcome to Shyam Jagat");
    assert.ok(welcome);
    assert.match(welcome.message, /₹501/);
  });

  it("an admin's decision on a registration reaches the person", async () => {
    const { pendingId } = await readyToPay(TAG, { category: "musician", profile: {} }, { primarySpecialty: "Tabla", city: "Jaipur", state: "Rajasthan" });
    const done = await payPending(pendingId, 501);
    const user = done.done.body.data.user;
    const token = done.done.body.data.accessToken;
    const registrationId = user.profiles[0].id;
    const admin = await adminToken();

    const approve = await api(`/admin/registrations/musician/${registrationId}/verify`, { method: "PATCH", token: admin, body: {} });
    assert.equal(approve.status, 200);
    const reject = await api(`/admin/registrations/musician/${registrationId}/reject`, { method: "PATCH", token: admin, body: { adminNote: "Please add a clearer photo" } });
    assert.equal(reject.status, 200);

    const items = (await api("/notifications/feed?category=registration", { token })).body.data.items;
    const titles = items.map((i) => i.title);
    assert.ok(titles.includes("Registration approved"));
    assert.ok(titles.includes("Registration not approved"));
    const rejected = items.find((i) => i.title === "Registration not approved");
    assert.match(rejected.message, /clearer photo/);
    assert.equal(rejected.kind, "warning");
    assert.equal(rejected.link, "/profile");
  });

  it("the same system message is never sent twice to one person", async () => {
    const user = await createUser(TAG);
    const { NotificationModel } = await import("../src/models/notification.model.js");
    for (let i = 0; i < 3; i += 1) {
      await NotificationModel.notify(user.id, { title: "Once", message: "Only once", dedupeKey: "test:once" });
    }
    assert.equal((await NotificationModel.feed(user.id)).items.length, 1);
  });

  it("notifying someone who does not exist never throws", async () => {
    const { NotificationModel } = await import("../src/models/notification.model.js");
    await NotificationModel.notify("11111111-1111-4111-8111-111111111111", { message: "Nobody home" });
  });
});
