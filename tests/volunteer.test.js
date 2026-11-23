import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, lastMailTo, login, makeIdentity, mailOutbox, sql, startServer, startSignup, stopServer } from "./helpers.js";

const TAG = "vol";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const PROFILE = {
  city: "Jaipur",
  state: "Rajasthan",
  interests: ["Food seva (Annadan)", "Drinking water (Pani Ki Pyau)"],
  skills: ["Teaching", "Driving"],
  availability: "Weekends",
  about: "I would like to help at the temple bhandara.",
};

/** The whole volunteer signup the way the site does it: start, the emailed code, the details, then the account. */
async function signUpVolunteer(profile = PROFILE) {
  const who = makeIdentity(TAG, { becomeMember: false });
  const started = await startSignup(who, { category: "volunteer" });
  const pendingId = started.body.data.pendingId;
  const { code } = lastMailTo(who.email);
  const verified = await api("/auth/signup/verify-otp", { body: { pendingId, code } });
  const saved = await api("/auth/signup/profile", { body: { pendingId, profile } });
  return { who, pendingId, started, verified, saved };
}

describe("volunteer signup is free", () => {
  it("goes straight from the details to an account, with no payment, and the person is signed in", async () => {
    const { who, pendingId, started, verified, saved } = await signUpVolunteer();
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.data.category, "volunteer");
    assert.equal(started.body.data.fee.status, "free");
    assert.equal(started.body.data.fee.total, 0);
    assert.equal(verified.body.data.stage, "details");
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.stage, "complete", "nothing is left to pay");

    const done = await api("/auth/signup/complete", { body: { pendingId } });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.ok(done.setCookie, "signed in");
    const user = done.body.data.user;
    assert.equal(user.email, who.email);
    assert.equal(user.registrationFee, "free", "not held back and not reminded to pay");
    assert.equal(user.volunteer.status, "pending");
    assert.deepEqual(user.volunteer.interests, PROFILE.interests);
    assert.equal(user.volunteer.availability, "Weekends");
    assert.deepEqual(user.profiles, [], "a volunteer is not a registration category");

    const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM registration_payments WHERE user_id = $1`, [user.id]);
    assert.equal(n, 0, "no payment was taken");
    const [account] = await sql(`SELECT email_verified_at, location FROM users WHERE id = $1`, [user.id]);
    assert.ok(account.email_verified_at);
    assert.equal(account.location, "Jaipur, Rajasthan");
  });

  it("welcomes them by email without a fee or a receipt", async () => {
    const { who, pendingId } = await signUpVolunteer();
    await api("/auth/signup/complete", { body: { pendingId } });
    await new Promise((resolve) => setTimeout(resolve, 300)); // the email is sent in the background
    const mail = mailOutbox.filter((m) => m.to === who.email).find((m) => /volunteer/i.test(m.subject));
    assert.ok(mail, "a volunteer welcome email went out");
    assert.match(mail.text, /free/i);
    assert.doesNotMatch(mail.text, /Receipt|Amount paid/i);
  });

  it("refuses a payment order: there is nothing to pay", async () => {
    const { pendingId } = await signUpVolunteer();
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    assert.equal(order.status, 409);
    assert.match(order.body.message, /free/i);
  });

  it("will not make the account before the email is verified and the details are in", async () => {
    const who = makeIdentity(TAG, { becomeMember: false });
    const started = await startSignup(who, { category: "volunteer" });
    const early = await api("/auth/signup/complete", { body: { pendingId: started.body.data.pendingId } });
    assert.equal(early.status, 400);
  });

  it("a member's signup still has to be paid for", async () => {
    const who = makeIdentity(TAG);
    const started = await startSignup(who);
    const { code } = lastMailTo(who.email);
    await api("/auth/signup/verify-otp", { body: { pendingId: started.body.data.pendingId, code } });
    const saved = await api("/auth/signup/profile", { body: { pendingId: started.body.data.pendingId, profile: { city: "Jaipur", state: "Rajasthan" } } });
    assert.equal(saved.body.data.stage, "pay");
    const early = await api("/auth/signup/complete", { body: { pendingId: started.body.data.pendingId } });
    assert.equal(early.status, 400);
  });
});

describe("the volunteer form is checked", () => {
  const trySave = async (profile) => {
    const who = makeIdentity(TAG, { becomeMember: false });
    const started = await startSignup(who, { category: "volunteer" });
    const { code } = lastMailTo(who.email);
    await api("/auth/signup/verify-otp", { body: { pendingId: started.body.data.pendingId, code } });
    return api("/auth/signup/profile", { body: { pendingId: started.body.data.pendingId, profile } });
  };

  it("needs at least one seva, and only the seva on the list", async () => {
    const none = await trySave({ ...PROFILE, interests: [] });
    assert.equal(none.status, 400);
    assert.ok(none.body.errors.some((e) => e.field === "profile.interests"));
    assert.equal((await trySave({ ...PROFILE, interests: ["Something else"] })).status, 400);
  });

  it("needs when they can help, and where they live", async () => {
    assert.equal((await trySave({ ...PROFILE, availability: undefined })).status, 400);
    assert.equal((await trySave({ ...PROFILE, availability: "Whenever" })).status, 400);
    assert.equal((await trySave({ ...PROFILE, city: "" })).status, 400);
    assert.equal((await trySave({ ...PROFILE, state: undefined })).status, 400);
  });

  it("works with no skills and no note", async () => {
    const ok = await trySave({ city: "Jaipur", state: "Rajasthan", interests: ["Gaushala seva"], availability: "Any day" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  it("keeps the note short", async () => {
    assert.equal((await trySave({ ...PROFILE, about: "x".repeat(501) })).status, 400);
  });
});

describe("a volunteer's own record", () => {
  it("can be read and changed by the volunteer, and is the same on their account", async () => {
    const { pendingId } = await signUpVolunteer();
    const done = await api("/auth/signup/complete", { body: { pendingId } });
    const token = done.body.data.accessToken;

    const mine = await api("/me/volunteer", { token });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.city, "Jaipur");

    const changed = await api("/me/volunteer", { method: "PATCH", token, body: { interests: ["Education support"], availability: "Weekdays" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body.data.interests, ["Education support"]);
    assert.equal(changed.body.data.city, "Jaipur", "what was not changed stays");

    const bad = await api("/me/volunteer", { method: "PATCH", token, body: { interests: ["Not a seva"] } });
    assert.equal(bad.status, 400);

    const me = await api("/auth/me", { token });
    assert.deepEqual(me.body.data.user.volunteer.interests, ["Education support"]);
    assert.equal(me.body.data.user.registrationFee, "free");
    const fee = await api("/payments/me", { token });
    assert.equal(fee.body.data.fee.status, "free");
  });

  it("is not there for someone who is not a volunteer", async () => {
    const member = await createUser(TAG);
    const token = (await login(member)).body.data.accessToken;
    assert.equal((await api("/me/volunteer", { token })).status, 404);
    assert.equal((await api("/me/volunteer", { method: "PATCH", token, body: { availability: "Weekends" } })).status, 404);
  });

  it("becomes an ordinary member account once they pay the fee", async () => {
    const { pendingId } = await signUpVolunteer();
    const done = await api("/auth/signup/complete", { body: { pendingId } });
    const { id } = done.body.data.user;
    await sql(
      `INSERT INTO registration_payments (user_id, plan, amount_in_rupees, status, receipt, razorpay_order_id, paid_at)
       VALUES ($1, 'part', 501, 'paid', 'SJ-REG-vol', $2, NOW())`,
      [id, `order_vol_${id}`],
    );
    const fee = await api("/payments/me", { token: done.body.data.accessToken });
    assert.equal(fee.body.data.fee.status, "partial");
    const me = await api("/auth/me", { token: done.body.data.accessToken });
    assert.equal(me.body.data.user.registrationFee, "partial");
    assert.ok(me.body.data.user.volunteer, "still a volunteer");
  });
});

describe("the admin's side", () => {
  it("lists volunteers, with filters, and only for an admin", async () => {
    const admin = (await login(await createUser(TAG, { role: "admin" }))).body.data.accessToken;
    const { who, pendingId } = await signUpVolunteer({ ...PROFILE, interests: ["Ambulance help"], state: "Haryana", city: "Gurugram" });
    await api("/auth/signup/complete", { body: { pendingId } });

    const all = await api(`/admin/volunteers?q=${encodeURIComponent(who.email)}`, { token: admin });
    assert.equal(all.status, 200, JSON.stringify(all.body));
    const [item] = all.body.data.items;
    assert.equal(item.email, who.email);
    assert.equal(item.status, "pending");
    assert.equal(item.isMember, false);
    assert.deepEqual(item.interests, ["Ambulance help"]);
    assert.equal(typeof all.body.data.counts.pending, "number");

    const byInterest = await api(`/admin/volunteers?interest=${encodeURIComponent("Ambulance help")}&state=Haryana`, { token: admin });
    assert.ok(byInterest.body.data.items.some((v) => v.email === who.email));
    const other = await api(`/admin/volunteers?interest=${encodeURIComponent("Gaushala seva")}&q=${encodeURIComponent(who.email)}`, { token: admin });
    assert.equal(other.body.data.items.length, 0);
    assert.equal((await api(`/admin/volunteers?status=approved&q=${encodeURIComponent(who.email)}`, { token: admin })).body.data.items.length, 0);

    const member = (await login(await createUser(TAG))).body.data.accessToken;
    assert.equal((await api("/admin/volunteers", { token: member })).status, 403);
    assert.equal((await api("/admin/volunteers")).status, 401);
  });

  it("approves a volunteer, tells them, and keeps the note", async () => {
    const admin = (await login(await createUser(TAG, { role: "admin" }))).body.data.accessToken;
    const { who, pendingId } = await signUpVolunteer();
    const done = await api("/auth/signup/complete", { body: { pendingId } });
    const list = await api(`/admin/volunteers?q=${encodeURIComponent(who.email)}`, { token: admin });
    const id = list.body.data.items[0].id;

    const approved = await api(`/admin/volunteers/${id}`, { method: "PATCH", token: admin, body: { status: "approved", adminNote: "Called, happy to help on Sundays." } });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, "approved");
    assert.equal(approved.body.data.adminNote, "Called, happy to help on Sundays.");

    const mine = await api("/me/volunteer", { token: done.body.data.accessToken });
    assert.equal(mine.body.data.status, "approved");
    assert.equal(mine.body.data.adminNote, undefined, "the admin's private note is not shown to the volunteer");

    const inbox = await api("/notifications?unread=true", { token: done.body.data.accessToken });
    const titles = JSON.stringify(inbox.body.data);
    assert.match(titles, /Volunteer registration approved/);

    assert.equal((await api(`/admin/volunteers/${id}`, { method: "PATCH", token: admin, body: { status: "great" } })).status, 400);
    assert.equal((await api("/admin/volunteers/00000000-0000-4000-8000-000000000000", { method: "PATCH", token: admin, body: { status: "approved" } })).status, 404);
  });
});

describe("broadcasts can reach volunteers", () => {
  it("can be limited to volunteers, or to those who want a particular seva", async () => {
    const admin = (await login(await createUser(TAG, { role: "admin" }))).body.data.accessToken;
    const { pendingId } = await signUpVolunteer({ ...PROFILE, interests: ["Clean toilets (Swachh Shauchalay)"] });
    const done = await api("/auth/signup/complete", { body: { pendingId } });
    const id = done.body.data.user.id;
    const preview = (segment) => api("/admin/notifications/audience", { token: admin, body: { audience: { mode: "segment", segment } } });

    const volunteers = await preview({ volunteer: "yes" });
    assert.equal(volunteers.status, 200, JSON.stringify(volunteers.body));
    const some = await preview({ interest: "Clean toilets (Swachh Shauchalay)" });
    assert.ok(some.body.data.count >= 1);
    const notVolunteers = await preview({ volunteer: "no" });
    assert.ok(notVolunteers.body.data.count >= 0);
    // A volunteer who has paid nothing is not "unpaid": they are free.
    const unpaid = await api("/admin/notifications/audience", { token: admin, body: { audience: { mode: "segment", segment: { fee: "unpaid" } }, includeIds: true } });
    assert.ok(!JSON.stringify(unpaid.body.data).includes(id));
  });
});
