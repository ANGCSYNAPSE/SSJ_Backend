import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const MARK = "autotest-ad";
let admin;
let originalRotation;

before(async () => {
  await startServer();
  // The rotation rules are one shared setting for the whole site: remember them, put them back afterwards.
  [originalRotation] = await sql(`SELECT value FROM app_settings WHERE key = 'ad_rotation'`);
  admin = (await login(await createUser("ads", { role: "admin" }))).body.data.accessToken;
});
after(async () => {
  await sql(`DELETE FROM ads WHERE title LIKE '${MARK}%'`);
  await sql(`DELETE FROM app_settings WHERE key = 'ad_rotation'`);
  if (originalRotation) {
    await sql(`INSERT INTO app_settings (key, value) VALUES ('ad_rotation', $1::jsonb)`, [JSON.stringify(originalRotation.value)]);
  }
  await sql(`DELETE FROM users WHERE email LIKE 'autotest+ads-%'`);
  await stopServer();
});

const make = (over = {}) =>
  api("/admin/ads", {
    token: admin,
    // Every test ad has a picture: the database is shared with the live site, and an older deployed site cannot show an ad without one.
    body: { title: `${MARK}-${Date.now()}${Math.floor(Math.random() * 1000)}`, placement: "leaderboard", template: "split", headline: "Software that works", imageUrl: "https://example.com/autotest.jpg", ...over },
  });
const publicAds = async () => (await api("/ads")).body.data;

describe("ad templates", () => {
  it("a text-and-picture ad needs a headline but not a picture", async () => {
    const res = await make({ imageUrl: undefined, isActive: false });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.template, "split");
    assert.equal(res.body.data.imageUrl, null);
    assert.equal(res.body.data.theme, "maroon");

    const noHeadline = await make({ headline: undefined });
    assert.equal(noHeadline.status, 400);
    assert.ok(noHeadline.body.errors.some((e) => e.field === "headline"));
  });

  it("a picture-only ad needs its picture", async () => {
    const missing = await make({ template: "image", headline: undefined, imageUrl: undefined });
    assert.equal(missing.status, 400);
    assert.ok(missing.body.errors.some((e) => e.field === "imageUrl"));
    const ok = await make({ template: "image", headline: undefined, imageUrl: "https://example.com/banner.jpg" });
    assert.equal(ok.status, 201);
  });

  it("a custom colour scheme needs both colours, written as #rrggbb", async () => {
    assert.equal((await make({ theme: "custom", isActive: false })).status, 400);
    assert.equal((await make({ theme: "custom", bgFrom: "red", bgTo: "#101010" })).status, 400);
    const ok = await make({ theme: "custom", bgFrom: "#1a2b3c", bgTo: "#101010" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.bgFrom, "#1a2b3c");
  });

  it("the button can have its own colour, written as #rrggbb", async () => {
    const ok = await make({ ctaColor: "#d4a73a", isActive: false });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.ctaColor, "#d4a73a");
    assert.equal((await make({ ctaColor: "gold", isActive: false })).status, 400);
    const plain = await make({ isActive: false });
    assert.equal(plain.body.data.ctaColor, null);
  });

  it("an ad can be given one spot on its page, and the spot can be cleared again", async () => {
    const ad = (await make({ page: "Events Page", slotPosition: 2, isActive: false })).body.data;
    assert.equal(ad.slotPosition, 2);
    const cleared = await api(`/admin/ads/${ad.id}`, { method: "PATCH", token: admin, body: { slotPosition: null } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.slotPosition, null);
    assert.equal((await make({ slotPosition: 0, isActive: false })).status, 400);
    assert.equal((await make({ slotPosition: 10, isActive: false })).status, 400);
    assert.equal((await make({ slotPosition: 1.5, isActive: false })).status, 400);
  });

  it("an unknown template or colour scheme is refused", async () => {
    assert.equal((await make({ template: "video" })).status, 400);
    assert.equal((await make({ theme: "pink" })).status, 400);
  });

  it("the site gets the live ads with their text, and never a draft or paused one", async () => {
    const live = (await make({ headline: "Live headline", subline: "Live line", ctaLabel: "Visit", linkUrl: "https://example.com" })).body.data;
    const paused = (await make({ isActive: false })).body.data;
    const draft = (await make({ isDraft: true, isActive: false })).body.data;
    const list = await publicAds();
    const shown = list.find((a) => a.id === live.id);
    assert.ok(shown);
    assert.equal(shown.headline, "Live headline");
    assert.equal(shown.ctaLabel, "Visit");
    assert.ok(!list.some((a) => a.id === paused.id || a.id === draft.id));
  });

  it("changing an ad's text leaves the rest alone", async () => {
    const ad = (await make({ subline: "First line" })).body.data;
    const res = await api(`/admin/ads/${ad.id}`, { method: "PATCH", token: admin, body: { headline: "New headline" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.headline, "New headline");
    assert.equal(res.body.data.subline, "First line");
  });
});

describe("how the ads rotate", () => {
  it("has sensible rules before anyone sets them, for the public site and the admin", async () => {
    await sql(`DELETE FROM app_settings WHERE key = 'ad_rotation'`);
    const res = await api("/ads/rotation");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { seconds: 6, transition: "tiles", pauseOnHover: true });
  });

  it("the admin changes them and the site sees the change", async () => {
    const saved = await api("/admin/ads/rotation", { method: "PUT", token: admin, body: { seconds: 12, transition: "fade", pauseOnHover: false } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const seen = await api("/ads/rotation");
    assert.deepEqual(seen.body.data, { seconds: 12, transition: "fade", pauseOnHover: false });
  });

  it("refuses a time that is too short or too long, or an unknown effect", async () => {
    const put = (body) => api("/admin/ads/rotation", { method: "PUT", token: admin, body });
    const ok = { seconds: 8, transition: "tiles", pauseOnHover: true };
    assert.equal((await put({ ...ok, seconds: 2 })).status, 400);
    assert.equal((await put({ ...ok, seconds: 601 })).status, 400);
    assert.equal((await put({ ...ok, seconds: 600 })).status, 200);
    assert.equal((await put({ ...ok, seconds: 4.5 })).status, 400);
    assert.equal((await put({ ...ok, transition: "slide" })).status, 400);
  });

  it("only an admin can change them", async () => {
    const body = { seconds: 9, transition: "tiles", pauseOnHover: true };
    assert.equal((await api("/admin/ads/rotation", { method: "PUT", body })).status, 401);
    const member = (await login(await createUser("ads-member"))).body.data.accessToken;
    assert.equal((await api("/admin/ads/rotation", { method: "PUT", token: member, body })).status, 403);
  });
});

describe("counting clicks", () => {
  const clicksOf = async (id) => (await sql(`SELECT clicks FROM ads WHERE id = $1`, [id]))[0].clicks;

  it("counts a click on a live ad", async () => {
    const ad = (await make()).body.data;
    assert.equal((await api(`/ads/${ad.id}/click`, { method: "POST" })).status, 204);
    await api(`/ads/${ad.id}/click`, { method: "POST" });
    assert.equal(await clicksOf(ad.id), 2);
  });

  it("does not count a paused ad, and quietly ignores an id that is not an ad", async () => {
    const paused = (await make({ isActive: false })).body.data;
    assert.equal((await api(`/ads/${paused.id}/click`, { method: "POST" })).status, 204);
    assert.equal(await clicksOf(paused.id), 0);
    assert.equal((await api(`/ads/not-an-id/click`, { method: "POST" })).status, 204);
  });
});
