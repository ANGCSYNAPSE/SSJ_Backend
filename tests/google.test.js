import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, cookieFrom, createUser, lastMailTo, makeIdentity, payPending, sql, startServer, startSignup, stopServer } from "./helpers.js";

const { setGoogleVerifierForTests } = await import("../src/services/google.service.js");
const { ApiError } = await import("../src/utils/ApiError.js");

const TAG = "ggl";
const uniqueSub = () => `gsub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** The test stands in for Google: a credential is just JSON describing the Google account. */
before(async () => {
  await startServer();
  setGoogleVerifierForTests(async (credential) => {
    if (credential === "x".repeat(30)) throw ApiError.unauthorized("We could not verify your Google sign-in. Please try again.");
    const profile = JSON.parse(credential);
    if (!profile.emailVerified) throw ApiError.badRequest("The email on your Google account is not verified, so we cannot use it.");
    return { sub: profile.sub, email: profile.email.toLowerCase(), name: profile.name ?? "", picture: null };
  });
});
after(async () => {
  setGoogleVerifierForTests(null);
  await cleanup(TAG);
  await stopServer();
});

const cred = (over = {}) =>
  JSON.stringify({ sub: uniqueSub(), email: makeIdentity(TAG).email, name: "Gita Devi", emailVerified: true, ...over });
const signIn = (credential, extra = {}) => api("/auth/google", { body: { credential, ...extra } });
const start = (credential, mobile, acceptTerms = true) => api("/auth/google/start", { body: { credential, mobile, acceptTerms } });
const newMobile = () => `9${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`.slice(0, 10);

describe("sign in with Google: existing accounts", () => {
  it("signs in an account that has the same verified email, links Google, and marks the email verified", async () => {
    const user = await createUser(TAG);
    await sql(`UPDATE users SET email_verified_at = NULL WHERE id = $1`, [user.id]);
    const credential = cred({ email: user.email });

    const res = await signIn(credential);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.user.id, user.id);
    assert.ok(res.body.data.accessToken);
    assert.ok(cookieFrom(res.setCookie), "a refresh cookie is set, so the session survives a reload");

    const [row] = await sql(`SELECT google_sub, email_verified_at FROM users WHERE id = $1`, [user.id]);
    assert.ok(row.google_sub);
    assert.ok(row.email_verified_at, "Google verified the email");

    const me = await api("/auth/me", { token: res.body.data.accessToken });
    assert.equal(me.status, 200);
  });

  it("recognises the person by their Google id afterwards, even if the Google email differs", async () => {
    const user = await createUser(TAG);
    const sub = uniqueSub();
    await signIn(cred({ email: user.email, sub }));
    const second = await signIn(cred({ email: `autotest+${TAG}-other-${Date.now()}@example.com`, sub }));
    assert.equal(second.status, 200);
    assert.equal(second.body.data.user.id, user.id);
  });

  it("refuses an account already linked to a different Google account", async () => {
    const user = await createUser(TAG);
    await signIn(cred({ email: user.email }));
    const other = await signIn(cred({ email: user.email }));
    assert.equal(other.status, 403);
    assert.match(other.body.message, /different Google account/);
  });

  it("never signs in an administrator or a suspended account", async () => {
    const admin = await createUser(TAG, { role: "admin" });
    const blocked = await createUser(TAG, { blocked: true });
    assert.equal((await signIn(cred({ email: admin.email }))).status, 403);
    const res = await signIn(cred({ email: blocked.email }));
    assert.equal(res.status, 403);
    assert.match(res.body.message, /suspended/i);
  });

  it("refuses a Google email that Google itself has not verified, and a token that does not check out", async () => {
    const user = await createUser(TAG);
    assert.equal((await signIn(cred({ email: user.email, emailVerified: false }))).status, 400);
    assert.equal((await signIn("x".repeat(30))).status, 401);
    assert.equal((await api("/auth/google", { body: {} })).status, 400);
  });
});

describe("sign up with Google", () => {
  it("a new Google person is told to add a mobile number; nothing is created yet", async () => {
    const credential = cred();
    const email = JSON.parse(credential).email;
    const res = await signIn(credential);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.newAccount, { fullName: "Gita Devi", email });
    assert.equal(res.setCookie, null, "no session without an account");
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM users WHERE lower(email) = $1`, [email]))[0].n, 0);
  });

  it("starts the registration at its details step: no password, no emailed code", async () => {
    const credential = cred();
    const profile = JSON.parse(credential);
    const mobile = newMobile();
    const before = (await sql(`SELECT 1 FROM users LIMIT 0`)).length;
    assert.equal(before, 0);

    const res = await start(credential, mobile);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.stage, "details", "the email is already proven by Google");
    assert.equal(res.body.data.emailVerified, true);
    assert.equal(res.body.data.account.email, profile.email);
    assert.equal(res.body.data.account.mobile, mobile);
    assert.equal(res.body.data.sentBy.email, false);

    const [pending] = await sql(`SELECT google_sub, email_verified_at, password_hash FROM pending_signups WHERE lower(email) = $1`, [profile.email]);
    assert.equal(pending.google_sub, profile.sub);
    assert.ok(pending.email_verified_at);
    assert.ok(pending.password_hash.startsWith("$2"), "a random hash nobody knows, never a blank");
  });

  it("the account is created only after payment, and Google then signs straight in", async () => {
    const credential = cred();
    const profile = JSON.parse(credential);
    const started = await start(credential, newMobile());
    const pendingId = started.body.data.pendingId;

    // Step 2 (city and state), then the payment creates the account.
    assert.equal((await api("/auth/signup/profile", { body: { pendingId, profile: { city: "Jaipur", state: "Rajasthan" } } })).status, 200);
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM users WHERE lower(email) = $1`, [profile.email]))[0].n, 0);
    const paid = await payPending(pendingId, 501);
    assert.equal(paid.done.status, 201, JSON.stringify(paid.done.body));
    const user = paid.done.body.data.user;
    assert.equal(user.emailVerified, true);
    assert.equal(user.mobileVerified, false);
    assert.equal(user.isVerified, false);

    const [row] = await sql(`SELECT google_sub FROM users WHERE id = $1`, [user.id]);
    assert.equal(row.google_sub, profile.sub);

    const again = await signIn(credential);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.user.id, user.id);
  });

  it("needs a valid mobile number and the terms accepted", async () => {
    const credential = cred();
    assert.equal((await start(credential, "12345")).status, 400);
    assert.equal((await start(credential, newMobile(), false)).status, 400);
  });

  it("refuses an email or mobile that already has an account", async () => {
    const user = await createUser(TAG);
    const emailTaken = await start(cred({ email: user.email }), newMobile());
    assert.equal(emailTaken.status, 409);
    assert.ok(emailTaken.body.errors.some((e) => e.field === "email"));

    const mobileTaken = await start(cred(), user.mobile);
    assert.equal(mobileTaken.status, 409);
    assert.ok(mobileTaken.body.errors.some((e) => e.field === "mobile"));
  });

  it("someone who began with a password and never finished can carry on with Google, with no code", async () => {
    const who = makeIdentity(TAG);
    const started = await startSignup(who);
    assert.equal(started.status, 200);
    assert.equal(started.body.data.emailVerified, false);

    const res = await signIn(JSON.stringify({ sub: uniqueSub(), email: who.email, name: who.fullName, emailVerified: true }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.resume.pendingId, started.body.data.pendingId);
    assert.equal(res.body.data.resume.emailVerified, true, "Google proved the email, so the code is skipped");
    assert.equal(res.body.data.resume.stage, "details");
    assert.ok(lastMailTo(who.email), "the earlier code email exists but is no longer needed");
  });

  it("starting twice with the same Google account continues the same registration", async () => {
    const credential = cred();
    const mobile = newMobile();
    const first = await start(credential, mobile);
    const second = await start(credential, mobile);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.pendingId, first.body.data.pendingId);
  });
});

describe("when Google sign-in is not set up", () => {
  it("says so plainly (503) instead of failing in a confusing way", async () => {
    setGoogleVerifierForTests(null);
    try {
      const res = await signIn("y".repeat(40));
      assert.equal(res.status, 503);
      assert.match(res.body.message, /not set up yet/i);
    } finally {
      setGoogleVerifierForTests(async (credential) => {
        const profile = JSON.parse(credential);
        return { sub: profile.sub, email: profile.email.toLowerCase(), name: profile.name ?? "", picture: null };
      });
    }
  });
});
