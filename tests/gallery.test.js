import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const TAG = "gal";

before(startServer);
after(async () => {
  await sql(`DELETE FROM donations WHERE email LIKE 'autotest+${TAG}-%'`);
  await sql(`DELETE FROM gallery_items WHERE url LIKE 'https://example.com/autotest-gal-%'`);
  await cleanup(TAG);
  await stopServer();
});

const tokenOf = async (user) => (await login(user)).body.data.accessToken;
const share = (token, extra = {}) =>
  api("/gallery", { token, body: { gallery: "own-wish", folder: "own-wish", kind: "photo", url: `https://example.com/autotest-gal-${Date.now()}${Math.floor(Math.random() * 1000)}.jpg`, caption: "Blankets given", ...extra } });
/** Gives the member a paid offering for a seva, which is what lets them share pictures under it. */
const give = async (user, sevaType) => {
  const order = await api("/donations/create-order", { body: { amount: 501, cause: "Seva", donorName: user.fullName, email: user.email, phone: "9876543210", sevaType } });
  if (order.status !== 201 && order.status !== 200) throw new Error(JSON.stringify(order.body));
  await sql(`UPDATE donations SET status = 'paid' WHERE razorpay_order_id = $1`, [order.body.data.orderId]);
};
const publicUrls = async (gallery = "own-wish") => (await api(`/gallery?gallery=${gallery}`)).body.data.map((i) => i.url);

describe("galleries: nothing is shown until an admin approves it", () => {
  it("only a signed-in member can share, and an unknown gallery is refused", async () => {
    assert.equal((await api("/gallery", { body: { gallery: "own-wish", folder: "own-wish", kind: "photo", url: "https://example.com/autotest-gal-x.jpg" } })).status, 401);
    const member = await tokenOf(await createUser(TAG));
    assert.equal((await share(member, { gallery: "nope" })).status, 400);
    assert.equal((await share(member, { gallery: "initiatives", folder: "own-wish" })).status, 400, "folder must belong to the gallery");
    assert.equal((await api("/gallery?gallery=nope")).status, 400);
  });

  it("a shared photo waits, is shown only once approved, and is hidden again if rejected", async () => {
    const who = await createUser(TAG);
    const member = await tokenOf(who);
    const admin = await tokenOf(await createUser(TAG, { role: "admin" }));

    assert.equal((await share(member)).status, 403, "sharing needs a seva the member has given");
    await give(who, "your-choice");
    const sevas = (await api("/gallery/my-sevas", { token: member })).body.data;
    assert.deepEqual(sevas.map((x) => x.sevaType), ["your-choice"], "the member's sevas are the folders they can share into");
    assert.equal((await share(member, { gallery: "initiatives", folder: "annadan" })).status, 403, "not a seva they have given");
    assert.equal((await api("/gallery/my-sevas")).status, 401);

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

    const mine = (await api("/gallery/mine", { token: member })).body.data;
    assert.ok(mine.some((i) => i.id === made.body.data.id && i.status === "approved"), "the member sees their own item and its status");
    assert.equal((await api("/gallery/mine")).status, 401, "mine needs a sign-in");

    await api(`/admin/gallery/${made.body.data.id}`, { token: admin, method: "PATCH", body: { status: "rejected", note: "Not clear" } });
    assert.ok(!(await publicUrls()).includes(url), "hidden again once rejected");
  });
});
