import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, payPending, readyToPay, sql, startServer, stopServer } from "./helpers.js";

const { audienceUserIds } = await import("../src/services/audience.service.js");

const TAG = "ver";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const adminToken = async () => tokenOf(await createUser(TAG, { role: "admin" }));
const unverified = async () => {
  const user = await createUser(TAG);
  await sql(`UPDATE users SET is_verified = FALSE WHERE id = $1`, [user.id]);
  return user;
};
const verification = (token, query = "") => api(`/admin/verification${query}`, { token });

describe("admin verification", () => {
  it("is for administrators only", async () => {
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await verification(member)).status, 403);
    assert.equal((await api("/admin/verification")).status, 401);
    assert.equal((await api("/admin/verification/bulk", { token: member, body: { userIds: [], verified: true } })).status, 403);
    assert.equal((await api("/admin/activity", { token: member })).status, 403);
  });

  it("lists unverified and verified people with counts, and never admins", async () => {
    const admin = await adminToken();
    const pending = await unverified();
    const done = await createUser(TAG);

    const unv = (await verification(admin, `?status=unverified&q=${encodeURIComponent(TAG)}&pageSize=100`)).body.data;
    const ids = unv.items.map((i) => i.id);
    assert.ok(ids.includes(pending.id));
    assert.ok(!ids.includes(done.id));
    assert.ok(unv.items.every((i) => i.isVerified === false));

    const ver = (await verification(admin, `?status=verified&q=${encodeURIComponent(TAG)}&pageSize=100`)).body.data;
    assert.ok(ver.items.some((i) => i.id === done.id));
    assert.ok(!ver.items.some((i) => i.role === "admin"), "admins are not part of the list");
    assert.ok(ver.counts.total >= 2 && ver.counts.unverified >= 1 && ver.counts.verified >= 1);
    assert.equal(typeof ver.fee.minimum, "number");
  });

  it("shows what the admin needs to decide: fee paid and registrations", async () => {
    const admin = await adminToken();
    const user = await unverified();
    await sql(
      `INSERT INTO registration_payments (user_id, plan, amount_in_rupees, status, receipt, razorpay_order_id, paid_at)
       VALUES ($1, 'full', 501, 'paid', 'SJ-REG-ver', $2, NOW())`,
      [user.id, `order_ver_${user.id}`],
    );
    const item = (await verification(admin, `?q=${encodeURIComponent(user.email)}`)).body.data.items[0];
    assert.equal(item.id, user.id);
    assert.equal(item.paid, 501);
    assert.deepEqual(item.registrations, []);
    assert.equal(item.verifiedAt, null);

    const ready = (await verification(admin, `?status=ready&q=${encodeURIComponent(user.email)}`)).body.data.items;
    assert.equal(ready.length, 1, "unverified with the minimum fee paid counts as ready");
  });

  it("people who have not paid the minimum are not 'ready'", async () => {
    const admin = await adminToken();
    const user = await unverified();
    assert.equal((await verification(admin, `?status=ready&q=${encodeURIComponent(user.email)}`)).body.data.items.length, 0);
  });

  it("verifies one person, records who and when, and tells them", async () => {
    const adminUser = await createUser(TAG, { role: "admin" });
    const admin = await tokenOf(adminUser);
    const user = await unverified();

    const res = await api(`/admin/verification/${user.id}`, { method: "PATCH", token: admin, body: { verified: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.changed, true);

    const item = (await verification(admin, `?status=verified&q=${encodeURIComponent(user.email)}`)).body.data.items[0];
    assert.equal(item.isVerified, true);
    assert.ok(item.verifiedAt);
    assert.equal(item.verifiedBy, adminUser.fullName);

    const feed = (await api("/notifications/feed", { token: await tokenOf(user) })).body.data.items;
    const note = feed.find((n) => n.title === "Your account is verified");
    assert.ok(note);
    assert.equal(note.category, "registration");
    assert.equal(note.kind, "success");
  });

  it("doing it again changes nothing and does not notify twice", async () => {
    const admin = await adminToken();
    const user = await unverified();
    await api(`/admin/verification/${user.id}`, { method: "PATCH", token: admin, body: { verified: true } });
    const again = await api(`/admin/verification/${user.id}`, { method: "PATCH", token: admin, body: { verified: true } });
    assert.equal(again.body.data.changed, false);
    const feed = (await api("/notifications/feed", { token: await tokenOf(user) })).body.data.items;
    assert.equal(feed.filter((n) => n.title === "Your account is verified").length, 1);
  });

  it("un-verifies with a different message", async () => {
    const admin = await adminToken();
    const user = await createUser(TAG);
    const res = await api(`/admin/verification/${user.id}`, { method: "PATCH", token: admin, body: { verified: false } });
    assert.equal(res.body.data.changed, true);
    const feed = (await api("/notifications/feed", { token: await tokenOf(user) })).body.data.items;
    const note = feed.find((n) => n.title === "Verification removed");
    assert.ok(note);
    assert.equal(note.kind, "warning");
    const [row] = await sql(`SELECT is_verified, verified_at FROM users WHERE id = $1`, [user.id]);
    assert.equal(row.is_verified, false);
    assert.equal(row.verified_at, null);
  });

  it("verifies many at once and reports how many actually changed", async () => {
    const admin = await adminToken();
    const a = await unverified();
    const b = await unverified();
    const c = await createUser(TAG); // already verified
    const res = await api("/admin/verification/bulk", { token: admin, body: { userIds: [a.id, b.id, c.id], verified: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.changed, 2);
    assert.match(res.body.message, /2 accounts verified/);
  });

  it("an admin account cannot be verified or un-verified here, and bad input is refused", async () => {
    const admin = await adminToken();
    const other = await createUser(TAG, { role: "admin" });
    assert.equal((await api(`/admin/verification/${other.id}`, { method: "PATCH", token: admin, body: { verified: false } })).status, 404);
    assert.equal((await api(`/admin/verification/not-a-uuid`, { method: "PATCH", token: admin, body: { verified: true } })).status, 404);
    assert.equal((await api(`/admin/verification/${other.id}`, { method: "PATCH", token: admin, body: {} })).status, 400);
    assert.equal((await api("/admin/verification/bulk", { token: admin, body: { userIds: [], verified: true } })).status, 400);
    assert.equal((await verification(admin, "?status=bogus")).status, 400);
  });

  it("the existing user editor verifies through the same path (person is told)", async () => {
    const admin = await adminToken();
    const user = await unverified();
    const res = await api(`/admin/users/${user.id}`, { method: "PATCH", token: admin, body: { status: "active" } });
    assert.equal(res.status, 200);
    const feed = (await api("/notifications/feed", { token: await tokenOf(user) })).body.data.items;
    assert.ok(feed.some((n) => n.title === "Your account is verified"));
  });
});

describe("notifying by verification status", () => {
  it("a broadcast can target verified or unverified people", async () => {
    const pending = await unverified();
    const done = await createUser(TAG);
    const no = new Set(await audienceUserIds({ mode: "segment", segment: { verified: "no" } }));
    const yes = new Set(await audienceUserIds({ mode: "segment", segment: { verified: "yes" } }));
    assert.deepEqual([no.has(pending.id), no.has(done.id)], [true, false]);
    assert.deepEqual([yes.has(pending.id), yes.has(done.id)], [false, true]);

    const admin = await adminToken();
    const preview = await api("/admin/notifications/audience", { token: admin, body: { audience: { mode: "segment", segment: { verified: "bogus" } } } });
    assert.equal(preview.status, 400);
  });
});

describe("the three marks on an account: email, phone, admin", () => {
  it("a person who signed up is email-verified, not phone-verified, and waiting for the admin", async () => {
    const { pendingId } = await readyToPay(TAG);
    const done = await payPending(pendingId, 501);
    const user = done.done.body.data.user;
    assert.deepEqual([user.emailVerified, user.mobileVerified, user.isVerified], [true, false, false]);

    const token = done.done.body.data.accessToken;
    const mine = (await api("/me/dashboard", { token })).body.data.account;
    assert.deepEqual([mine.emailVerified, mine.mobileVerified, mine.isVerified], [true, false, false]);
    const me = (await api("/auth/me", { token })).body.data.user;
    assert.equal(me.emailVerified, true);
  });

  it("being unverified by the admin does not lower the profile completion", async () => {
    const { pendingId } = await readyToPay(TAG);
    const done = await payPending(pendingId, 501);
    const dashboard = (await api("/me/dashboard", { token: done.done.body.data.accessToken })).body.data;
    assert.ok(!dashboard.completion.missingAccount.includes("isVerified"));
  });

  it("the admin sees all three on one person, with the fee and registrations", async () => {
    const admin = await adminToken();
    const { pendingId } = await readyToPay(TAG, { category: "musician", profile: {} }, { primarySpecialty: "Tabla", city: "Jaipur", state: "Rajasthan" });
    const done = await payPending(pendingId, 501);
    const id = done.done.body.data.user.id;

    const before = (await api(`/admin/verification/${id}`, { token: admin })).body.data;
    assert.deepEqual([before.emailVerified, before.mobileVerified, before.isVerified], [true, false, false]);
    assert.ok(before.emailVerifiedAt);
    assert.equal(before.paid, 501);
    assert.equal(before.fee.minimum, 501);
    assert.equal(before.registrations[0].type, "musician");
    assert.equal(before.payments[0].amount, 501);

    await api(`/admin/verification/${id}`, { method: "PATCH", token: admin, body: { verified: true } });
    const after = (await api(`/admin/verification/${id}`, { token: admin })).body.data;
    assert.equal(after.isVerified, true);
    assert.ok(after.verifiedAt);

    const asUser = (await api("/me/dashboard", { token: done.done.body.data.accessToken })).body.data.account;
    assert.equal(asUser.isVerified, true);
  });

  it("an unknown person is a 404, and members cannot look", async () => {
    const admin = await adminToken();
    assert.equal((await api("/admin/verification/11111111-1111-4111-8111-111111111111", { token: admin })).status, 404);
    assert.equal((await api("/admin/verification/not-a-uuid", { token: admin })).status, 404);
    assert.equal((await api(`/admin/verification/${(await createUser(TAG)).id}`, { token: await tokenOf(await createUser(TAG)) })).status, 403);
  });
});

describe("the admin's bell (activity)", () => {
  it("shows what needs attention and what happened, newest first", async () => {
    const admin = await adminToken();
    await unverified();
    const res = await api("/admin/activity", { token: admin });
    assert.equal(res.status, 200);
    const { attention, items } = res.body.data;
    assert.ok(attention.unverified >= 1);
    for (const key of ["registrations", "unverified", "messages"]) assert.equal(typeof attention[key], "number");
    assert.ok(items.length > 0);
    for (const item of items) {
      assert.ok(item.id && item.title && item.link.startsWith("/") && item.at);
    }
    const times = items.map((i) => new Date(i.at).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => y - x));
    assert.ok(items.some((i) => i.kind === "signup"));
  });

  it("a new contact message shows up until it is handled", async () => {
    const admin = await adminToken();
    const [row] = await sql(`INSERT INTO contact_submissions (name, email, subject, message) VALUES ('Bell Tester', 'autotest+ver-contact@example.com', 'Hello', 'Test') RETURNING id`);
    try {
      const { items, attention } = (await api("/admin/activity", { token: admin })).body.data;
      assert.ok(items.some((i) => i.id === `message:${row.id}` && /Bell Tester/.test(i.title)));
      assert.ok(attention.messages >= 1);
    } finally {
      await sql(`DELETE FROM contact_submissions WHERE id = $1`, [row.id]);
    }
  });
});
