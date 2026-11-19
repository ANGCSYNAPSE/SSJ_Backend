import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const { smsOutbox } = await import("../src/services/sms.service.js");

const TAG = "mob";

before(async () => {
  await startServer();
  process.env.SMS_PROVIDER = "test";
});
after(async () => {
  process.env.SMS_PROVIDER = "";
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const lastCodeTo = (mobile) => [...smsOutbox].reverse().find((m) => m.to === mobile)?.code;
const send = (token) => api("/me/mobile/send-otp", { token, body: {} });
const verify = (token, code) => api("/me/mobile/verify-otp", { token, body: { code } });
const me = async (token) => (await api("/auth/me", { token })).body.data.user;

describe("phone verification", () => {
  it("needs a signed-in person", async () => {
    assert.equal((await api("/me/mobile/send-otp", { body: {} })).status, 401);
    assert.equal((await api("/me/mobile/verify-otp", { body: { code: "123456" } })).status, 401);
  });

  it("texts a code to the person's own number and verifies the phone with it", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    assert.equal((await me(token)).mobileVerified, false);

    const sent = await send(token);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.data.sent, true);
    assert.match(sent.body.data.mobile, /^•+\d{3}$/, "the number is masked in the answer");
    const code = lastCodeTo(user.mobile);
    assert.match(code, /^\d{6}$/);

    const done = await verify(token, code);
    assert.equal(done.status, 200);
    const after = await me(token);
    assert.equal(after.mobileVerified, true);
    assert.ok(after.mobileVerifiedAt);

    const notes = (await api("/notifications/feed", { token })).body.data.items;
    assert.ok(notes.some((n) => n.title === "Phone verified"));
  });

  it("the code is stored only as a hash", async () => {
    const user = await createUser(TAG);
    await send(await tokenOf(user));
    const code = lastCodeTo(user.mobile);
    const [row] = await sql(`SELECT code_hash FROM mobile_otps WHERE user_id = $1`, [user.id]);
    assert.ok(row.code_hash && !row.code_hash.includes(code));
    assert.equal(row.code_hash.length, 64);
  });

  it("a wrong code says how many tries are left and five wrong tries lock it", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    await send(token);
    const good = lastCodeTo(user.mobile);
    const bad = good === "000000" ? "111111" : "000000";

    const first = await verify(token, bad);
    assert.equal(first.status, 400);
    assert.match(first.body.message, /4 tries left/);
    for (let i = 0; i < 4; i += 1) await verify(token, bad);
    const locked = await verify(token, good);
    assert.equal(locked.status, 429, "even the right code is refused once locked");
    assert.equal((await me(token)).mobileVerified, false);
  });

  it("a badly formatted code is refused", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    await send(token);
    for (const code of ["12345", "1234567", "abcdef", ""]) assert.equal((await verify(token, code)).status, 400, code);
  });

  it("without asking for a code first there is nothing to confirm", async () => {
    const token = await tokenOf(await createUser(TAG));
    const res = await verify(token, "123456");
    assert.equal(res.status, 400);
    assert.match(res.body.message, /expired|new one/i);
  });

  it("an expired code is refused", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    await send(token);
    const code = lastCodeTo(user.mobile);
    await sql(`UPDATE mobile_otps SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [user.id]);
    assert.equal((await verify(token, code)).status, 400);
  });

  it("asking again too soon is refused; later, the new code works and the old one does not", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    await send(token);
    const first = lastCodeTo(user.mobile);
    assert.equal((await send(token)).status, 429);

    await sql(`UPDATE mobile_otps SET sent_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [user.id]);
    assert.equal((await send(token)).status, 200);
    const second = lastCodeTo(user.mobile);
    if (first !== second) assert.equal((await verify(token, first)).status, 400, "the earlier code stops working");
    assert.equal((await verify(token, second)).status, 200);
  });

  it("no more than five codes an hour", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await send(token)).status, 200, `send ${i + 1}`);
      await sql(`UPDATE mobile_otps SET sent_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [user.id]);
    }
    const sixth = await send(token);
    assert.equal(sixth.status, 429);
    assert.match(sixth.body.message, /hour/);
  });

  it("an already verified phone is left alone: no text is sent", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    await send(token);
    await verify(token, lastCodeTo(user.mobile));
    const before = smsOutbox.length;
    const again = await send(token);
    assert.equal(again.body.data.alreadyVerified, true);
    assert.equal(smsOutbox.length, before);
  });

  it("a code sent to an old number does not verify the new one", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    await send(token);
    const code = lastCodeTo(user.mobile);
    await sql(`UPDATE users SET mobile = $2 WHERE id = $1`, [user.id, `9${String(Date.now()).slice(-9)}`]);
    assert.equal((await verify(token, code)).status, 400);
  });

  it("when SMS is switched off it says so and stores nothing", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    process.env.SMS_PROVIDER = "";
    try {
      const res = await send(token);
      assert.equal(res.status, 503);
      assert.match(res.body.message, /not switched on/i);
    } finally {
      process.env.SMS_PROVIDER = "test";
    }
    assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM mobile_otps WHERE user_id = $1`, [user.id]))[0].n, 0);
  });

  it("MSG91 is not configured without both its values", async () => {
    const { smsAvailable } = await import("../src/services/sms.service.js");
    const keep = { key: process.env.MSG91_AUTH_KEY, tpl: process.env.MSG91_OTP_TEMPLATE_ID };
    process.env.SMS_PROVIDER = "msg91";
    process.env.MSG91_AUTH_KEY = "";
    process.env.MSG91_OTP_TEMPLATE_ID = "tpl";
    assert.equal(smsAvailable(), false);
    process.env.MSG91_AUTH_KEY = "key";
    assert.equal(smsAvailable(), true);
    process.env.MSG91_AUTH_KEY = keep.key ?? "";
    process.env.MSG91_OTP_TEMPLATE_ID = keep.tpl ?? "";
    process.env.SMS_PROVIDER = "test";
  });

  it("MSG91's API is called with the template, the 91-prefixed number and our code", async () => {
    const { sendOtpSms } = await import("../src/services/sms.service.js");
    const realFetch = globalThis.fetch;
    let seen;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("msg91.com")) {
        seen = { url: new URL(String(url)), headers: init.headers };
        return new Response(JSON.stringify({ type: "success", message: "ok" }), { status: 200 });
      }
      return realFetch(url, init);
    };
    process.env.SMS_PROVIDER = "msg91";
    process.env.MSG91_AUTH_KEY = "secret-key";
    process.env.MSG91_OTP_TEMPLATE_ID = "tpl_123";
    try {
      await sendOtpSms({ to: "9876543210", code: "482913", minutes: 10 });
      assert.equal(seen.url.searchParams.get("mobile"), "919876543210");
      assert.equal(seen.url.searchParams.get("otp"), "482913");
      assert.equal(seen.url.searchParams.get("template_id"), "tpl_123");
      assert.equal(seen.headers.authkey, "secret-key");
      assert.ok(!seen.url.search.includes("secret-key"), "the key travels in a header, not the address");

      globalThis.fetch = async (url, init) =>
        String(url).includes("msg91.com") ? new Response(JSON.stringify({ type: "error", message: "Template not found" }), { status: 200 }) : realFetch(url, init);
      await assert.rejects(sendOtpSms({ to: "9876543210", code: "111111", minutes: 10 }), (e) => e.statusCode === 503 && !/Template/.test(e.message));
    } finally {
      globalThis.fetch = realFetch;
      process.env.MSG91_AUTH_KEY = "";
      process.env.MSG91_OTP_TEMPLATE_ID = "";
      process.env.SMS_PROVIDER = "test";
    }
  });
});
