import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, startServer, stopServer } from "./helpers.js";

const TAG = "plk";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const signIn = async () => {
  const user = await createUser(TAG);
  return { user, token: (await login(user)).body.data.accessToken };
};
const save = (token, body) => api("/me", { method: "PATCH", token, body });

describe("profile links and bio", () => {
  it("keeps a bio and the links, tidied, and shows them on the dashboard", async () => {
    const { token } = await signIn();
    const res = await save(token, {
      bio: "  Bhajan singer from Jaipur.  ",
      socialLinks: { youtube: "youtube.com/@mychannel", instagram: "https://www.instagram.com/me", website: "https://example.org/me", facebook: "", x: null },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { account } = (await api("/me/dashboard", { token })).body.data;
    assert.equal(account.bio, "Bhajan singer from Jaipur.");
    assert.equal(account.socialLinks.youtube, "https://youtube.com/@mychannel", "a bare address becomes an https link");
    assert.equal(account.socialLinks.instagram, "https://www.instagram.com/me");
    assert.equal(account.socialLinks.website, "https://example.org/me");
    assert.equal(account.socialLinks.facebook, undefined, "an empty link is not stored");
    assert.equal(account.socialLinks.x, undefined);
  });

  it("removes a link when it is sent empty, and leaves the rest of the account alone", async () => {
    const { token, user } = await signIn();
    await save(token, { fullName: "Original Name", socialLinks: { youtube: "https://youtube.com/@a", instagram: "https://instagram.com/a" } });
    await save(token, { socialLinks: { youtube: "", instagram: "https://instagram.com/a" } });
    const { account } = (await api("/me/dashboard", { token })).body.data;
    assert.equal(account.socialLinks.youtube, undefined);
    assert.equal(account.socialLinks.instagram, "https://instagram.com/a");
    assert.equal(account.fullName, "Original Name");
    assert.equal(account.email, user.email);
  });

  it("refuses a link that is not on its own platform, a script, an unknown platform and a long bio", async () => {
    const { token } = await signIn();
    for (const body of [
      { socialLinks: { youtube: "https://evil.example.com/watch" } },
      { socialLinks: { instagram: "https://youtube.com/@a" } },
      { socialLinks: { website: "javascript:alert(1)" } },
      { socialLinks: { myspace: "https://myspace.com/a" } },
      { bio: "x".repeat(301) },
    ]) {
      const res = await save(token, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("puts the links and the bio on the shared card only once sharing is on", async () => {
    const { token } = await signIn();
    await save(token, { bio: "Seva is my prayer.", socialLinks: { youtube: "https://youtube.com/@mine" } });
    const { code } = (await api("/me/card", { token })).body.data.card;
    assert.equal((await api(`/cards/${code}`)).status, 404, "private by default");
    await api("/me/card", { method: "PATCH", token, body: { enabled: true } });
    const card = (await api(`/cards/${code}`)).body.data;
    assert.equal(card.bio, "Seva is my prayer.");
    assert.equal(card.links.youtube, "https://youtube.com/@mine");
    assert.equal(card.email, undefined);
    assert.equal(card.phone, undefined);
  });
});
