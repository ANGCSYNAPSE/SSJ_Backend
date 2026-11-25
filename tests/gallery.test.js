import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const TAG = "gal";

before(startServer);
after(async () => {
  await sql(`DELETE FROM gallery_items WHERE url LIKE 'https://example.com/autotest-gal-%'`);
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const share = (token, extra = {}) =>
  api("/gallery", { token, body: { gallery: "own-wish", folder: "own-wish", kind: "photo", url: `https://example.com/autotest-gal-${Date.now()}${Math.floor(Math.random() * 1000)}.jpg`, caption: "Blankets given", ...extra } });
const publicUrls = async (gallery = "own-wish") => (await api(`/gallery?gallery=${gallery}`)).body.data.map((i) => i.url);

describe("galleries: nothing is shown until an admin approves it", () => {
  it("only a signed-in member can share, and an unknown gallery is refused", async () => {
    assert.equal((await api("/gallery", { body: { gallery: "own-wish", folder: "own-wish", kind: "photo", url: "https://example.com/autotest-gal-x.jpg" } })).status, 401);
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await share(member, { gallery: "nope" })).status, 400);
    assert.equal((await api("/gallery?gallery=nope")).status, 400);
  });

  it("a shared photo waits, is shown only once approved, and is hidden again if rejected", async () => {
    const member = await tokenOf(await createUser(TAG));
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));

    const made = await share(member);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.data.status, "pending");
    const [{ url }] = await sql(`SELECT url FROM gallery_items WHERE id = $1`, [made.body.data.id]);
    assert.ok(!(await publicUrls()).includes(url), "not public while pending");

    const pending = (await api("/admin/gallery", { token: admin })).body.data;
    assert.ok(pending.items.some((i) => i.id === made.body.data.id), "the admin sees it waiting");
    assert.equal((await api("/admin/gallery", { token: member })).status, 403, "a member cannot review");
    assert.equal((await api(`/admin/gallery/${made.body.data.id}`, { token: member, method: "PATCH", body: { status: "approved" } })).status, 403);

    const ok = await api(`/admin/gallery/${made.body.data.id}`, { token: admin, method: "PATCH", body: { status: "approved" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok((await publicUrls()).includes(url), "public once approved");

    await api(`/admin/gallery/${made.body.data.id}`, { token: admin, method: "PATCH", body: { status: "rejected", note: "Not clear" } });
    assert.ok(!(await publicUrls()).includes(url), "hidden again once rejected");
  });
});
