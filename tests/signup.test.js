import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD,
  api,
  cleanup,
  cookieFrom,
  createUser,
  lastMailTo,
  login,
  mailCountTo,
  makeIdentity,
  payPending,
  pastMinutes,
  readyToPay,
  signPayment,
  sql,
  startAndVerify,
  startServer,
  startSignup,
  stopServer,
} from "./helpers.js";

const TAG = "sig";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const pendingRow = async (id) => (await sql(`SELECT * FROM pending_signups WHERE id = $1`, [id]))[0];
const otpRows = (id) => sql(`SELECT * FROM otp_codes WHERE pending_signup_id = $1`, [id]);
const userCount = async (email) => (await sql(`SELECT COUNT(*)::int AS n FROM users WHERE email = $1`, [email]))[0].n;

describe("signup step 1: checks first, then sends the code", () => {
  it("a new email gets exactly one code, is not an account yet, and the code is stored only as a hash", async () => {
    const who = makeIdentity(TAG);
    const res = await startSignup(who);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.stage, "otp");
    assert.equal(res.body.data.emailVerified, false);

    assert.equal(mailCountTo(who.email, "verification code"), 1);
    const { code } = lastMailTo(who.email);
    assert.match(code, /^\d{6}$/);

    assert.equal(await userCount(who.email), 0, "no account may exist before payment");
    const rows = await otpRows(res.body.data.pendingId);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].code_hash, code);
    assert.equal(rows[0].code_hash.length, 64);
  });

  it("an email that already has an account is refused BEFORE any email is sent", async () => {
    const user = await createUser(TAG);
    const res = await startSignup({ ...makeIdentity(TAG), email: user.email });
    assert.equal(res.status, 409);
    assert.equal(res.body.errors[0].field, "email");
    assert.match(res.body.errors[0].message, /sign in/i);
    assert.equal(mailCountTo(user.email), 0, "no code may be sent to an existing account");
    const pending = await sql(`SELECT 1 FROM pending_signups WHERE email = $1`, [user.email]);
    assert.equal(pending.length, 0);
  });

  it("a mobile number that already has an account is refused before any email is sent", async () => {
    const user = await createUser(TAG);
    const who = makeIdentity(TAG, { mobile: user.mobile });
    const res = await startSignup(who);
    assert.equal(res.status, 409);
    assert.equal(res.body.errors[0].field, "mobile");
    assert.equal(mailCountTo(who.email), 0);
  });

  it("a mobile number held by someone else's unfinished signup is refused too", async () => {
    const first = makeIdentity(TAG);
    assert.equal((await startSignup(first)).status, 200);
    const second = makeIdentity(TAG, { mobile: first.mobile });
    const res = await startSignup(second);
    assert.equal(res.status, 409);
    assert.equal(res.body.errors[0].field, "mobile");
    assert.equal(mailCountTo(second.email), 0);
  });

  it("starting again while a usable code is out does not send another email", async () => {
    const who = makeIdentity(TAG);
    const first = await startSignup(who);
    const second = await startSignup(who);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.pendingId, first.body.data.pendingId, "the same pending signup continues");
    assert.equal(mailCountTo(who.email, "verification code"), 1);
    assert.deepEqual(second.body.data.sentBy, { email: false, sms: false });
  });

  it("bad input is rejected with per-field errors and sends nothing", async () => {
    const who = makeIdentity(TAG, { password: "abc", confirmPassword: "abc" });
    const res = await startSignup(who);
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.some((e) => e.field === "password"));
    assert.equal(mailCountTo(who.email), 0);
  });

  it("the old one-step signup is switched off", async () => {
    const res = await api("/auth/signup", { body: makeIdentity(TAG) });
    assert.equal(res.status, 410);
  });
});

describe("the email code", () => {
  it("a wrong code says how many tries are left and counts the attempt", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    const pendingId = body.data.pendingId;
    const real = lastMailTo(who.email).code;
    const wrong = real === "000000" ? "111111" : "000000";

    const res = await api("/auth/signup/verify-otp", { body: { pendingId, code: wrong } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /4 tries left/);
    assert.equal((await otpRows(pendingId))[0].attempts, 1);
  });

  it("a badly formatted code is rejected", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    const res = await api("/auth/signup/verify-otp", { body: { pendingId: body.data.pendingId, code: "12ab" } });
    assert.equal(res.status, 400);
  });

  it("five wrong tries lock the code, even for the right code, until a new one is sent", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    const pendingId = body.data.pendingId;
    const real = lastMailTo(who.email).code;
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) await api("/auth/signup/verify-otp", { body: { pendingId, code: wrong } });

    const locked = await api("/auth/signup/verify-otp", { body: { pendingId, code: real } });
    assert.equal(locked.status, 429);

    // Ask for a new one (after the 45-second wait, which the test fast-forwards).
    await sql(`UPDATE pending_signups SET otp_sent_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`, [pendingId]);
    assert.equal((await api("/auth/signup/resend", { body: { pendingId } })).status, 200);
    const fresh = lastMailTo(who.email).code;
    assert.equal((await api("/auth/signup/verify-otp", { body: { pendingId, code: fresh } })).status, 200);
  });

  it("an expired code is refused", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    const pendingId = body.data.pendingId;
    await sql(`UPDATE otp_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE pending_signup_id = $1`, [pendingId]);
    const res = await api("/auth/signup/verify-otp", { body: { pendingId, code: lastMailTo(who.email).code } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /expired/i);
  });

  it("asking for another code too soon is refused; later, the new code works and the old one does not", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    const pendingId = body.data.pendingId;
    const oldCode = lastMailTo(who.email).code;

    assert.equal((await api("/auth/signup/resend", { body: { pendingId } })).status, 429);

    await sql(`UPDATE pending_signups SET otp_sent_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`, [pendingId]);
    assert.equal((await api("/auth/signup/resend", { body: { pendingId } })).status, 200);
    assert.equal(mailCountTo(who.email, "verification code"), 2);
    assert.equal((await otpRows(pendingId)).length, 1, "only the newest code is kept");

    const newCode = lastMailTo(who.email).code;
    if (newCode !== oldCode) {
      assert.equal((await api("/auth/signup/verify-otp", { body: { pendingId, code: oldCode } })).status, 400);
    }
    assert.equal((await api("/auth/signup/verify-otp", { body: { pendingId, code: newCode } })).status, 200);
  });

  it("SMS is not available yet: asking for it is refused and sends nothing", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    await sql(`UPDATE pending_signups SET otp_sent_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`, [body.data.pendingId]);
    const res = await api("/auth/signup/resend", { body: { pendingId: body.data.pendingId, channel: "sms" } });
    assert.equal(res.status, 503);
    assert.equal(body.data.channels.sms, false);
  });

  it("a verified code is moved: verification is recorded and the code row is deleted", async () => {
    const { pendingId, verified } = await startAndVerify(TAG);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.data.emailVerified, true);
    assert.equal(verified.body.data.stage, "details");
    assert.equal((await otpRows(pendingId)).length, 0, "a used code must not stay in the table");
    assert.ok((await pendingRow(pendingId)).email_verified_at);
  });

  it("starting again after verifying, with the same password, sends no email and stays verified", async () => {
    const { who, pendingId } = await startAndVerify(TAG);
    const before = mailCountTo(who.email);
    const again = await startSignup(who);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.pendingId, pendingId);
    assert.equal(again.body.data.emailVerified, true);
    assert.equal(again.body.data.stage, "details");
    assert.equal(mailCountTo(who.email), before, "no second email");
  });

  it("starting again after verifying with a DIFFERENT password is refused", async () => {
    const { who } = await startAndVerify(TAG);
    const res = await startSignup({ ...who, password: "Other@12345", confirmPassword: "Other@12345" });
    assert.equal(res.status, 409);
    assert.equal(res.body.errors[0].field, "password");
  });
});

describe("step 2 (details) and the payment are required, in order", () => {
  it("details cannot be saved before the email is verified", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    const res = await api("/auth/signup/profile", { body: { pendingId: body.data.pendingId, profile: { city: "Jaipur", state: "Rajasthan" } } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /verify your email/i);
  });

  it("a member's details need a city and a state", async () => {
    const { pendingId } = await startAndVerify(TAG);
    const res = await api("/auth/signup/profile", { body: { pendingId, profile: { city: "Jaipur" } } });
    assert.equal(res.status, 400);
    assert.equal(res.body.errors[0].field, "profile.state");
  });

  it("payment cannot start before the details are saved", async () => {
    const { pendingId } = await startAndVerify(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    assert.equal(order.status, 400);
    assert.match(order.body.message, /finish your details/i);
  });

  it("payment cannot start before the email is verified", async () => {
    const { body } = await startSignup(makeIdentity(TAG));
    const order = await api("/auth/signup/pay/order", { body: { pendingId: body.data.pendingId, amount: 501 } });
    assert.equal(order.status, 400);
    assert.match(order.body.message, /verify your email/i);
  });

  it("saving the details moves the signup to the payment stage and is not yet an account", async () => {
    const { who, saved } = await readyToPay(TAG);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.stage, "pay");
    assert.equal(await userCount(who.email), 0);
  });

  it("an artist's details are checked with the artist rules", async () => {
    const { pendingId } = await startAndVerify(TAG, { category: "musician", profile: {} });
    const bad = await api("/auth/signup/profile", { body: { pendingId, profile: { state: 123 } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors[0].field, "profile.state");
    const good = await api("/auth/signup/profile", { body: { pendingId, profile: { primarySpecialty: "Tabla", city: "Jaipur", state: "Rajasthan" } } });
    assert.equal(good.status, 200);
    assert.equal(good.body.data.category, "musician");
  });

  it("the amount must be a whole number between ₹501 and ₹1100", async () => {
    const { pendingId } = await readyToPay(TAG);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 500 } })).status, 400);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 1101 } })).status, 400);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 600.5 } })).status, 400);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: "abc" } })).status, 400);
    assert.equal((await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } })).status, 201);
  });

  it("the account cannot be completed without a payment", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const res = await api("/auth/signup/complete", { body: { pendingId } });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /pay at least/i);
    assert.equal(await userCount(who.email), 0);
  });

  it("a payment with a wrong signature creates nothing", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    const res = await api("/auth/signup/pay/verify", {
      body: { pendingId, razorpay_order_id: order.body.data.orderId, razorpay_payment_id: "pay_x", razorpay_signature: "00" },
    });
    assert.equal(res.status, 400);
    assert.equal(await userCount(who.email), 0);
    const [payment] = await sql(`SELECT status FROM registration_payments WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
    assert.equal(payment.status, "failed");
  });

  it("someone else's order cannot be used to finish this signup", async () => {
    const a = await readyToPay(TAG);
    const b = await readyToPay(TAG);
    const orderOfA = await api("/auth/signup/pay/order", { body: { pendingId: a.pendingId, amount: 501 } });
    const res = await api("/auth/signup/pay/verify", {
      body: {
        pendingId: b.pendingId,
        razorpay_order_id: orderOfA.body.data.orderId,
        razorpay_payment_id: "pay_y",
        razorpay_signature: signPayment(orderOfA.body.data.orderId, "pay_y"),
      },
    });
    assert.equal(res.status, 404);
    assert.equal(await userCount(b.who.email), 0);
  });
});

describe("the account is created only when the payment succeeds", () => {
  it("a ₹501 payment creates the account, signs the person in, and stores a hashed refresh token", async () => {
    const { who, pendingId } = await readyToPay(TAG);
    assert.equal(await userCount(who.email), 0);

    const paid = await payPending(pendingId, 501);
    assert.equal(paid.done.status, 201);
    const { user, accessToken } = paid.done.body.data;
    assert.equal(user.email, who.email);
    assert.equal(user.emailVerified, true, "the emailed code proves the email");
    assert.equal(user.mobileVerified, false);
    assert.equal(user.isVerified, false, "an admin has not checked the account yet");
    assert.equal(user.location, "Jaipur, Rajasthan");
    assert.equal(user.registrationFee, "partial");
    assert.ok(accessToken);

    // tokens: the access token works, the refresh token is in a cookie and (hashed) in its own table
    assert.ok(paid.done.setCookie.includes("HttpOnly"));
    assert.ok(paid.done.setCookie.includes("Max-Age=604800"));
    const cookieToken = cookieFrom(paid.done.setCookie).split("=")[1];
    const [stored] = await sql(`SELECT * FROM refresh_tokens WHERE user_id = $1`, [user.id]);
    assert.ok(stored, "the refresh token must be stored");
    assert.notEqual(stored.token_hash, cookieToken, "the token itself must not be stored");
    assert.equal(stored.revoked_at, null);
    assert.equal((await api("/payments/me", { token: accessToken })).body.data.fee.paid, 501);

    // bookkeeping: the payment moved to the account, the pending signup is closed, the welcome mail went out
    const [payment] = await sql(`SELECT user_id FROM registration_payments WHERE razorpay_order_id = $1`, [paid.orderId]);
    assert.equal(payment.user_id, user.id);
    const pending = await pendingRow(pendingId);
    assert.equal(pending.completed_user_id, user.id);
    assert.equal(pending.password_hash, "completed");
    assert.equal((await otpRows(pendingId)).length, 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(mailCountTo(who.email, "Welcome"), 1);
  });

  it("the new account can sign in with the password chosen at signup", async () => {
    const { who, pendingId } = await readyToPay(TAG);
    await payPending(pendingId, 1100);
    const res = await api("/auth/login", { body: { email: who.email, password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.registrationFee, "paid");
    assert.ok(res.body.data.accessToken);
  });

  it("an artist signup creates the artist registration with the account", async () => {
    const { pendingId } = await startAndVerify(TAG, { category: "musician", profile: {} });
    await api("/auth/signup/profile", { body: { pendingId, profile: { primarySpecialty: "Tabla", city: "Jaipur", state: "Rajasthan" } } });
    const paid = await payPending(pendingId, 501);
    assert.equal(paid.done.status, 201);
    const { user } = paid.done.body.data;
    assert.deepEqual(user.profiles.map((p) => p.category), ["musician"]);
    const [row] = await sql(`SELECT primary_specialty, city FROM musicians WHERE user_id = $1`, [user.id]);
    assert.equal(row.primary_specialty, "Tabla");
  });

  it("a payment made but not finished (page lost) can still create the account afterwards", async () => {
    const { pendingId, who } = await readyToPay(TAG);
    const order = await api("/auth/signup/pay/order", { body: { pendingId, amount: 501 } });
    // the webhook (or the verify call) marked it paid, but the browser never reached /pay/verify
    await sql(`UPDATE registration_payments SET status = 'paid', paid_at = NOW() WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
    const res = await api("/auth/signup/complete", { body: { pendingId } });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.email, who.email);
  });

  it("a second attempt to finish the same signup says the account exists", async () => {
    const { pendingId } = await readyToPay(TAG);
    await payPending(pendingId, 501);
    const again = await api("/auth/signup/complete", { body: { pendingId } });
    assert.equal(again.status, 409);
  });

  it("after the account exists, signing up with that email is refused without sending mail", async () => {
    const { who, pendingId } = await readyToPay(TAG);
    await payPending(pendingId, 501);
    const before = mailCountTo(who.email, "verification code");
    const res = await startSignup(who);
    assert.equal(res.status, 409);
    assert.equal(mailCountTo(who.email, "verification code"), before);
  });
});

describe("coming back later: signing in resumes the unfinished signup", () => {
  it("unverified: login says to verify (stage otp) and gives no session", async () => {
    const who = makeIdentity(TAG);
    await startSignup(who);
    const res = await login(who);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.resume.stage, "otp");
    assert.equal(res.body.data.accessToken, undefined);
    assert.equal(res.setCookie, null, "no refresh cookie for an unfinished signup");
    assert.equal(res.body.data.resume.account.email, who.email);
    assert.equal(await userCount(who.email), 0);
  });

  it("unverified with a usable code already out: login does not send another email", async () => {
    const who = makeIdentity(TAG);
    await startSignup(who);
    const before = mailCountTo(who.email);
    await login(who);
    assert.equal(mailCountTo(who.email), before);
  });

  it("unverified with the old code expired: login sends a fresh code", async () => {
    const who = makeIdentity(TAG);
    const { body } = await startSignup(who);
    await sql(`UPDATE otp_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE pending_signup_id = $1`, [body.data.pendingId]);
    const before = mailCountTo(who.email);
    const res = await login(who);
    assert.equal(res.body.data.resume.stage, "otp");
    assert.equal(mailCountTo(who.email), before + 1);
    const code = lastMailTo(who.email).code;
    assert.equal((await api("/auth/signup/verify-otp", { body: { pendingId: body.data.pendingId, code } })).status, 200);
  });

  it("verified but the details were never filled (2-3 days later): login resumes at step 2, no email, no account", async () => {
    const { who, pendingId } = await startAndVerify(TAG);
    // two days pass
    await sql(`UPDATE pending_signups SET created_at = NOW() - INTERVAL '3 days', expires_at = NOW() + INTERVAL '4 days' WHERE id = $1`, [pendingId]);
    const before = mailCountTo(who.email);

    const res = await login(who);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.resume.stage, "details");
    assert.equal(res.body.data.resume.pendingId, pendingId);
    assert.equal(res.body.data.resume.emailVerified, true);
    assert.equal(res.body.data.accessToken, undefined);
    assert.equal(mailCountTo(who.email), before, "a verified email is not asked to verify again");
    assert.equal(await userCount(who.email), 0, "still no account");

    // and they can carry on from there: details -> pay -> account
    const saved = await api("/auth/signup/profile", { body: { pendingId, profile: { city: "Pune", state: "Maharashtra" } } });
    assert.equal(saved.body.data.stage, "pay");
    const paid = await payPending(pendingId, 501);
    assert.equal(paid.done.status, 201);
  });

  it("details saved but unpaid: login resumes at the payment", async () => {
    const { who } = await readyToPay(TAG);
    const res = await login(who);
    assert.equal(res.body.data.resume.stage, "pay");
    assert.equal(res.body.data.resume.details.city, "Jaipur");
    assert.equal(res.body.data.resume.fee.minimum, 501);
  });

  it("the resume state can be re-read by its id (a page reload)", async () => {
    const { pendingId } = await startAndVerify(TAG);
    const res = await api("/auth/signup/resume", { body: { pendingId } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.stage, "details");
    assert.equal(res.body.data.emailVerified, true);
  });

  it("a wrong password gets no resume and no hint that a signup exists", async () => {
    const { who } = await startAndVerify(TAG);
    const res = await api("/auth/login", { body: { email: who.email, password: "Wrong@12345" } });
    assert.equal(res.status, 401);
    assert.equal(res.body.data, undefined);
  });

  it("an unknown email is simply refused", async () => {
    const res = await api("/auth/login", { body: { email: `autotest+${TAG}-nobody@example.com`, password: PASSWORD } });
    assert.equal(res.status, 401);
  });

  it("an unfinished signup that has expired can no longer be resumed", async () => {
    const { who, pendingId } = await startAndVerify(TAG);
    await sql(`UPDATE pending_signups SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [pendingId]);
    assert.equal((await login(who)).status, 401);
    assert.equal((await api("/auth/signup/resume", { body: { pendingId } })).status, 400);
  });

  it("an expired signup can be started over with the same email", async () => {
    const { who, pendingId } = await startAndVerify(TAG);
    await sql(`UPDATE pending_signups SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [pendingId]);
    const res = await startSignup(who);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.emailVerified, true, "the same pending signup is revived");
  });
});
