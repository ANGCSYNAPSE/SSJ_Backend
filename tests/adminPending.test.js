import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const TAG = "apd";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;

describe("admin pending counts (the badges on the admin menu)", () => {
  it("is for administrators only", async () => {
    assert.equal((await api("/admin/dashboard/pending")).status, 401);
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await api("/admin/dashboard/pending", { token: member })).status, 403);
  });

  it("counts what is waiting, and the count falls when it is dealt with", async () => {
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));
    const before = (await api("/admin/dashboard/pending", { token: admin })).body.data;
    for (const key of ["registrations", "temples", "artists", "dharamshalas", "organisations", "volunteers", "verification", "contactInquiries", "gallery"]) {
      assert.equal(typeof before[key], "number", key);
    }

    // a new member who is not verified yet is waiting for an admin
    const user = await createUser(TAG);
    await sql(`UPDATE users SET is_verified = FALSE WHERE id = $1`, [user.id]);
    const waiting = (await api("/admin/dashboard/pending", { token: admin })).body.data;
    assert.equal(waiting.verification, before.verification + 1);

    await sql(`UPDATE users SET is_verified = TRUE WHERE id = $1`, [user.id]);
    const done = (await api("/admin/dashboard/pending", { token: admin })).body.data;
    assert.equal(done.verification, before.verification);
  });
});
