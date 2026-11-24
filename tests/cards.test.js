import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const TAG = "card";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const signIn = async (over) => {
  const user = await createUser(TAG, over);
  return { user, token: (await login(user)).body.data.accessToken };
};

describe("the digital card", () => {
  it("is made on first use, with a code that stays the same, and starts private", async () => {
    const { token } = await signIn();
    const first = await api("/me/card", { token });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.enabled, false);
    assert.match(first.body.data.card.code, /^[2-9A-HJKMNP-Z]{8}$/);
    assert.ok(first.body.data.url.endsWith(`/card/${first.body.data.card.code}`));
    const again = await api("/me/card", { token });
    assert.equal(again.body.data.card.code, first.body.data.card.code);
  });

  it("cannot be opened by anyone until the owner switches sharing on, and then shows only what is safe to share", async () => {
    const { user, token } = await signIn();
    await sql(`UPDATE users SET location = 'Jaipur, Rajasthan', avatar_url = 'https://example.com/me.jpg' WHERE id = $1`, [user.id]);
    const { code } = (await api("/me/card", { token })).body.data.card;

    assert.equal((await api(`/cards/${code}`)).status, 404, "private by default");

    const on = await api("/me/card", { method: "PATCH", token, body: { enabled: true } });
    assert.equal(on.status, 200);
    assert.equal(on.body.data.enabled, true);

    const open = await api(`/cards/${code}`);
    assert.equal(open.status, 200, JSON.stringify(open.body));
    const card = open.body.data;
    assert.equal(card.name, user.fullName);
    assert.equal(card.photoUrl, "https://example.com/me.jpg");
    assert.equal(card.location, "Jaipur, Rajasthan");
    assert.deepEqual(card.kinds, ["Devotee"]);
    const text = JSON.stringify(open.body);
    assert.ok(!text.includes(user.email) && !text.includes(user.mobile), "no email or phone on a public card");
    assert.equal(card.id, undefined);

    await api("/me/card", { method: "PATCH", token, body: { enabled: false } });
    assert.equal((await api(`/cards/${code}`)).status, 404, "private again");
  });

  it("says what the person is only once the team has approved it, or they have paid", async () => {
    const { user, token } = await signIn();
    const { code } = (await api("/me/card", { token })).body.data.card;
    await api("/me/card", { method: "PATCH", token, body: { enabled: true } });
    await sql(`INSERT INTO volunteers (user_id, city, state, interests, availability) VALUES ($1, 'Jaipur', 'Rajasthan', '["Gaushala seva"]', 'Weekends')`, [user.id]);
    assert.deepEqual((await api(`/cards/${code}`)).body.data.kinds, ["Devotee"], "a volunteer not yet approved is not shown as one");
    await sql(`UPDATE volunteers SET status = 'approved' WHERE user_id = $1`, [user.id]);
    await sql(
      `INSERT INTO registration_payments (user_id, plan, amount_in_rupees, status, receipt, razorpay_order_id, paid_at)
       VALUES ($1, 'part', 501, 'paid', 'SJ-REG-card', $2, NOW())`,
      [user.id, `order_card_${user.id}`],
    );
    assert.deepEqual((await api(`/cards/${code}`)).body.data.kinds, ["Member", "Volunteer"]);
  });

  it("does not open for a blocked account, a made-up code or a badly shaped one", async () => {
    const { user, token } = await signIn();
    const { code } = (await api("/me/card", { token })).body.data.card;
    await api("/me/card", { method: "PATCH", token, body: { enabled: true } });
    await sql(`UPDATE users SET is_blocked = TRUE WHERE id = $1`, [user.id]);
    assert.equal((await api(`/cards/${code}`)).status, 404);
    assert.equal((await api("/cards/ZZZZZZZZ")).status, 404);
    assert.equal((await api("/cards/..%2F..%2Fx")).status, 404);
  });

  it("needs a signed-in person to make or change a card", async () => {
    assert.equal((await api("/me/card")).status, 401);
    assert.equal((await api("/me/card", { method: "PATCH", body: { enabled: true } })).status, 401);
    const { token } = await signIn();
    assert.equal((await api("/me/card", { method: "PATCH", token, body: { enabled: "yes" } })).status, 400);
  });
});
