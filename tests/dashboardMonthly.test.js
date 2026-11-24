import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { api, cleanup, createUser, login, sql, startServer, stopServer } from "./helpers.js";

const TAG = "dmo";

before(startServer);
after(async () => {
  await sql(`DELETE FROM donations WHERE email LIKE 'autotest+${TAG}-%'`);
  await cleanup(TAG);
  await stopServer();
});

describe("the dashboard's giving by month", () => {
  it("gives the last six months, oldest first, zero where nothing was given, counting only paid seva", async () => {
    const user = await createUser(TAG);
    const token = (await login(user)).body.data.accessToken;
    const stamp = Date.now();
    const row = (name, amount, status, monthsAgo) =>
      sql(
        `INSERT INTO donations (amount_in_rupees, cause, donor_name, email, razorpay_order_id, status, created_at)
         VALUES ($1, 'Annadan Seva', 'Test Donor', $2, $3, $4, NOW() - ($5 || ' months')::interval)`,
        [amount, user.email, `order_${TAG}_${name}_${stamp}`, status, String(monthsAgo)],
      );
    await row("a", 501, "paid", 0);
    await row("b", 1100, "paid", 0);
    await row("c", 2100, "paid", 2);
    await row("d", 999, "created", 1); // never paid: not counted
    await row("e", 5100, "paid", 9); // too long ago for the chart

    const { donations } = (await api("/me/dashboard", { token })).body.data;
    assert.equal(donations.monthly.length, 6);
    const months = donations.monthly.map((m) => m.month);
    assert.deepEqual([...months].sort(), months, "oldest first");
    assert.equal(donations.monthly[5].total, 1601, "this month: 501 + 1100");
    assert.equal(donations.monthly[3].total, 2100, "two months ago");
    assert.equal(donations.monthly[4].total, 0, "a month with only an unpaid order");
    assert.equal(donations.monthly[0].total, 0);
  });
});
