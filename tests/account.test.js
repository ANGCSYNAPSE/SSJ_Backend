import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD,
  api,
  cleanup,
  cookieFrom,
  createUser,
  login,
  mailCountTo,
  makeIdentity,
  sql,
  startServer,
  stopServer,
} from "./helpers.js";

const TAG = "acc";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const patchAccount = (token, body) => api("/me/account", { method: "PATCH", token, body });

describe("changing sign-in details needs authorisation", () => {
  it("only a signed-in person can use these routes", async () => {
    assert.equal((await api("/me/account", { method: "PATCH", body: { fullName: "X Y" } })).status, 401);
    assert.equal((await api("/me/password", { body: { currentPassword: PASSWORD, newPassword: "New@12345", confirmPassword: "New@12345" } })).status, 401);
  });

  it("anyone can change their own name without a password", async () => {
    const user = await createUser(TAG);
    const res = await patchAccount(await tokenOf(user), { fullName: "Renamed Person" });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.fullName, "Renamed Person");
  });

  it("a plain member cannot change email or mobile (that needs a verification step)", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const email = await patchAccount(token, { email: makeIdentity(TAG).email, currentPassword: PASSWORD });
    assert.equal(email.status, 403);
    const mobile = await patchAccount(token, { mobile: makeIdentity(TAG).mobile, currentPassword: PASSWORD });
    assert.equal(mobile.status, 403);
  });

  it("fields that are not allowed are refused, so a role cannot be changed this way", async () => {
    const token = await tokenOf(await createUser(TAG));
    assert.equal((await patchAccount(token, { role: "admin" })).status, 400);
    assert.equal((await patchAccount(token, { isVerified: true })).status, 400);
  });

  describe("an administrator changing the sign-in email", () => {
    it("is refused without the current password, or with a wrong one, and nothing changes", async () => {
      const admin = await createUser(TAG, { role: "admin" });
      const token = await tokenOf(admin);
      const next = makeIdentity(TAG).email;

      const none = await patchAccount(token, { email: next });
      assert.equal(none.status, 400);
      assert.equal(none.body.errors[0].field, "currentPassword");

      const wrong = await patchAccount(token, { email: next, currentPassword: "Wrong@12345" });
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.errors[0].field, "currentPassword");

      const [row] = await sql(`SELECT email FROM users WHERE id = $1`, [admin.id]);
      assert.equal(row.email, admin.email);
    });

    it("works with the right password: the new email signs in, the old one no longer does, and the old address is told", async () => {
      const admin = await createUser(TAG, { role: "admin" });
      const token = await tokenOf(admin);
      const next = makeIdentity(TAG).email;

      const res = await patchAccount(token, { email: next, currentPassword: PASSWORD });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.email, next);

      assert.equal((await api("/auth/login", { body: { email: next, password: PASSWORD } })).status, 200);
      assert.equal((await api("/auth/login", { body: { email: admin.email, password: PASSWORD } })).status, 401);
      await wait(60);
      assert.equal(mailCountTo(admin.email, "sign-in email"), 1, "the old address must be warned");
    });

    it("refuses an email that another account already uses", async () => {
      const admin = await createUser(TAG, { role: "admin" });
      const other = await createUser(TAG);
      const res = await patchAccount(await tokenOf(admin), { email: other.email, currentPassword: PASSWORD });
      assert.equal(res.status, 409);
      assert.equal(res.body.errors[0].field, "email");
    });

    it("refuses an invalid email", async () => {
      const admin = await createUser(TAG, { role: "admin" });
      const res = await patchAccount(await tokenOf(admin), { email: "not-an-email", currentPassword: PASSWORD });
      assert.equal(res.status, 400);
    });

    it("changes the mobile number with the password, and refuses one already in use or malformed", async () => {
      const admin = await createUser(TAG, { role: "admin" });
      const other = await createUser(TAG);
      const token = await tokenOf(admin);
      const fresh = makeIdentity(TAG).mobile;

      assert.equal((await patchAccount(token, { mobile: fresh })).status, 400, "needs the password");
      const ok = await patchAccount(token, { mobile: fresh, currentPassword: PASSWORD });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.data.mobile, fresh);
      assert.equal((await patchAccount(token, { mobile: other.mobile, currentPassword: PASSWORD })).status, 409);
      assert.equal((await patchAccount(token, { mobile: "12345", currentPassword: PASSWORD })).status, 400);
    });

    it("sending the same email again changes nothing and needs no password", async () => {
      const admin = await createUser(TAG, { role: "admin" });
      const res = await patchAccount(await tokenOf(admin), { email: admin.email, fullName: "Same Email" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.email, admin.email);
    });
  });
});

describe("changing the password", () => {
  const change = (token, over = {}) =>
    api("/me/password", { token, body: { currentPassword: PASSWORD, newPassword: "Brand@New123", confirmPassword: "Brand@New123", ...over } });

  it("refuses a wrong current password", async () => {
    const token = await tokenOf(await createUser(TAG));
    const res = await change(token, { currentPassword: "Wrong@12345" });
    assert.equal(res.status, 400);
    assert.equal(res.body.errors[0].field, "currentPassword");
  });

  it("refuses a weak or mismatched new password", async () => {
    const token = await tokenOf(await createUser(TAG));
    assert.equal((await change(token, { newPassword: "short1", confirmPassword: "short1" })).status, 400);
    assert.equal((await change(token, { newPassword: "onlyletters", confirmPassword: "onlyletters" })).status, 400);
    const mismatch = await change(token, { confirmPassword: "Different@123" });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.errors[0].field, "confirmPassword");
  });

  it("refuses the same password again", async () => {
    const token = await tokenOf(await createUser(TAG));
    const res = await change(token, { newPassword: PASSWORD, confirmPassword: PASSWORD });
    assert.equal(res.status, 400);
    assert.equal(res.body.errors[0].field, "newPassword");
  });

  it("works: the new password signs in, the old one does not, and the person is warned by email", async () => {
    const user = await createUser(TAG);
    const token = await tokenOf(user);
    const res = await change(token);
    assert.equal(res.status, 200);

    assert.equal((await api("/auth/login", { body: { email: user.email, password: "Brand@New123" } })).status, 200);
    assert.equal((await api("/auth/login", { body: { email: user.email, password: PASSWORD } })).status, 401);
    await wait(60);
    assert.equal(mailCountTo(user.email, "password was changed"), 1);
  });

  it("ends the other sessions but keeps this device signed in", async () => {
    const user = await createUser(TAG);
    const thisDevice = await login(user);
    const otherDevice = await login(user);

    const res = await change(thisDevice.body.data.accessToken);
    assert.equal(res.status, 200);

    // the other device's refresh token is dead
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(otherDevice.setCookie) })).status, 401);
    // this device got a fresh refresh cookie in the response, and it works
    assert.ok(res.setCookie, "a new refresh cookie is issued");
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(res.setCookie) })).status, 200);
    // the old cookie of this device is dead too
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(thisDevice.setCookie) })).status, 401);
  });
});
