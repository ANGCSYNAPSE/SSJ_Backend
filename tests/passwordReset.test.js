import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, cookieFrom, createUser, login, lastMailTo, mailCountTo, mailOutbox, sql, startServer, stopServer } from "./helpers.js";

const TAG = "pwr";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const forgot = (email) => api("/auth/forgot-password", { body: { email } });
const verifyCode = (email, code) => api("/auth/forgot-password/verify", { body: { email, code } });
const reset = (token, password = "Brand@New123", confirmPassword = password) => api("/auth/reset-password", { body: { token, password, confirmPassword } });
const codeFromMail = (email) => /\b(\d{6})\b/.exec(lastMailTo(email).text)[1];
/** Cheats the 45-second wait so a test can ask again straight away. */
const allowResend = (userId) => sql(`UPDATE password_reset_codes SET sent_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [userId]);
const wrongCode = (code) => (code === "000000" ? "111111" : "000000");

describe("forgot password with an emailed code", () => {
  it("emails a 6-digit code, the code opens the new-password step, and the password changes", async () => {
    const user = await createUser(TAG);
    const asked = await forgot(user.email);
    assert.equal(asked.status, 200);
    assert.equal(asked.body.data.resendAfterSeconds, 45);

    const mail = lastMailTo(user.email);
    assert.match(mail.subject, /^\d{6} is your Shyam Jagat password reset code$/);
    assert.ok(!/reset-password\?token/.test(mail.text), "no link: the whole reset happens on the site");

    const verified = await verifyCode(user.email, codeFromMail(user.email));
    assert.equal(verified.status, 200);
    assert.match(verified.body.data.resetToken, /^[a-f0-9]{64}$/);

    assert.equal((await reset(verified.body.data.resetToken)).status, 200);
    assert.equal((await api("/auth/login", { body: { email: user.email, password: "Brand@New123" } })).status, 200);
    assert.equal((await api("/auth/login", { body: { email: user.email, password: user.password } })).status, 401, "the old password stops working");
  });

  it("works for an admin account too (the code is entered on the website)", async () => {
    const admin = await createUser(TAG, { role: "admin" });
    await forgot(admin.email);
    const verified = await verifyCode(admin.email, codeFromMail(admin.email));
    assert.equal((await reset(verified.body.data.resetToken)).status, 200);
    assert.equal((await api("/auth/login", { body: { email: admin.email, password: "Brand@New123" } })).status, 200);
  });

  it("answers the same way for an unknown email and sends nothing", async () => {
    const before = mailOutbox.length;
    const res = await forgot(`autotest+${TAG}-nobody-${Date.now()}@example.com`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.resendAfterSeconds, 45);
    assert.equal(mailOutbox.length, before);
    assert.equal((await api("/auth/forgot-password", { body: { email: "not-an-email" } })).status, 400);
  });

  it("does not email a suspended account", async () => {
    const user = await createUser(TAG, { blocked: true });
    await forgot(user.email);
    assert.equal(mailCountTo(user.email, "reset code"), 0);
  });

  it("stores the code only as a hash", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const code = codeFromMail(user.email);
    const [row] = await sql(`SELECT code_hash FROM password_reset_codes WHERE user_id = $1`, [user.id]);
    assert.equal(row.code_hash.length, 64);
    assert.ok(!row.code_hash.includes(code));
  });

  it("a wrong code, an unknown email and an expired code all get the same refusal", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const code = codeFromMail(user.email);

    const wrong = await verifyCode(user.email, wrongCode(code));
    const unknown = await verifyCode(`autotest+${TAG}-ghost-${Date.now()}@example.com`, "123456");
    assert.equal(wrong.status, 400);
    assert.equal(unknown.status, 400);
    assert.equal(wrong.body.message, unknown.body.message, "nothing reveals whether the account exists");

    await sql(`UPDATE password_reset_codes SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [user.id]);
    const expired = await verifyCode(user.email, code);
    assert.equal(expired.status, 400);
    assert.equal(expired.body.message, wrong.body.message);
  });

  it("a badly formatted code is refused", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    for (const code of ["12345", "1234567", "abcdef", ""]) assert.equal((await verifyCode(user.email, code)).status, 400, code);
  });

  it("five wrong tries lock the code, even for the right one, until a new one is sent", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const code = codeFromMail(user.email);
    for (let i = 0; i < 5; i += 1) await verifyCode(user.email, wrongCode(code));
    assert.equal((await verifyCode(user.email, code)).status, 400);

    await allowResend(user.id);
    await forgot(user.email);
    const fresh = codeFromMail(user.email);
    assert.equal((await verifyCode(user.email, fresh)).status, 200);
  });

  it("asking again too soon sends nothing; later, the new code works and the old one does not", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const first = codeFromMail(user.email);
    const sentBefore = mailCountTo(user.email, "reset code");
    assert.equal((await forgot(user.email)).status, 200);
    assert.equal(mailCountTo(user.email, "reset code"), sentBefore, "within 45 seconds nothing more is sent");

    await allowResend(user.id);
    await forgot(user.email);
    const second = codeFromMail(user.email);
    assert.equal(mailCountTo(user.email, "reset code"), sentBefore + 1);
    if (first !== second) assert.equal((await verifyCode(user.email, first)).status, 400);
    assert.equal((await verifyCode(user.email, second)).status, 200);
  });

  it("no more than five codes an hour", async () => {
    const user = await createUser(TAG);
    for (let i = 0; i < 5; i += 1) {
      await forgot(user.email);
      await allowResend(user.id);
    }
    const sent = mailCountTo(user.email, "reset code");
    assert.equal(sent, 5);
    await forgot(user.email);
    assert.equal(mailCountTo(user.email, "reset code"), 5, "the sixth ask is quietly ignored");
  });

  it("a code works once", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const code = codeFromMail(user.email);
    assert.equal((await verifyCode(user.email, code)).status, 200);
    assert.equal((await verifyCode(user.email, code)).status, 400);
  });

  it("the reset token works once, and a newer one replaces it", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const first = (await verifyCode(user.email, codeFromMail(user.email))).body.data.resetToken;
    await allowResend(user.id);
    await forgot(user.email);
    const second = (await verifyCode(user.email, codeFromMail(user.email))).body.data.resetToken;

    assert.equal((await reset(first)).status, 400, "only the newest token works");
    assert.equal((await reset(second)).status, 200);
    const again = await reset(second, "Another@12345");
    assert.equal(again.status, 400);
    assert.match(again.body.message, /invalid or has expired/);
  });

  it("a weak or mismatched password is refused and the token stays usable", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const token = (await verifyCode(user.email, codeFromMail(user.email))).body.data.resetToken;
    assert.equal((await reset(token, "short1")).status, 400);
    assert.equal((await reset(token, "onlyletters")).status, 400);
    assert.equal((await reset(token, "Brand@New123", "Different@123")).status, 400);
    assert.equal((await reset(token)).status, 200);
  });

  it("the current password cannot be chosen again, and the reset can still be completed with another", async () => {
    const user = await createUser(TAG);
    await forgot(user.email);
    const token = (await verifyCode(user.email, codeFromMail(user.email))).body.data.resetToken;

    const same = await reset(token, user.password);
    assert.equal(same.status, 400);
    assert.equal(same.body.errors[0].field, "password");
    assert.match(same.body.errors[0].message, /current password/i);
    assert.equal((await api("/auth/login", { body: { email: user.email, password: user.password } })).status, 200, "nothing changed");

    assert.equal((await reset(token, "Different@123")).status, 200, "the same token still works for a different password");
    assert.equal((await api("/auth/login", { body: { email: user.email, password: "Different@123" } })).status, 200);
  });

  it("a made-up token is refused", async () => {
    assert.equal((await reset("0".repeat(64))).status, 400);
    assert.equal((await api("/auth/reset-password", { body: { password: "Brand@New123", confirmPassword: "Brand@New123" } })).status, 400);
  });

  it("ends every signed-in session and tells the owner", async () => {
    const user = await createUser(TAG);
    const session = await login(user);
    await forgot(user.email);
    const token = (await verifyCode(user.email, codeFromMail(user.email))).body.data.resetToken;
    const noticesBefore = mailCountTo(user.email, "password was changed");
    await reset(token);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(session.setCookie) })).status, 401);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(mailCountTo(user.email, "password was changed"), noticesBefore + 1);
  });
});
