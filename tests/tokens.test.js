import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
  api,
  cleanup,
  cookieFrom,
  createUser,
  login,
  sha256,
  sql,
  startServer,
  stopServer,
  tokenFrom,
} from "./helpers.js";

const { ttlToMs } = await import("../src/utils/tokens.js");

const TAG = "tok";

before(startServer);
after(async () => {
  await cleanup(TAG);
  await stopServer();
});

const rowsOf = (userId) => sql(`SELECT * FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at`, [userId]);
/** Pretends the token swaps happened a minute ago, past the short grace window for a double request. */
const ageSwaps = (userId) => sql(`UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1 AND replaced_by IS NOT NULL`, [userId]);

describe("token lifetimes", () => {
  it("reads TTLs like 7d, 1d, 12h, 30m, 90s and plain seconds", () => {
    assert.equal(ttlToMs("7d"), 7 * 86_400_000);
    assert.equal(ttlToMs("1d"), 86_400_000);
    assert.equal(ttlToMs("12h"), 12 * 3_600_000);
    assert.equal(ttlToMs("30m"), 30 * 60_000);
    assert.equal(ttlToMs("90s"), 90_000);
    assert.equal(ttlToMs("120"), 120_000);
    assert.equal(ttlToMs("nonsense"), 7 * 86_400_000, "a bad value falls back to 7 days");
  });

  it("the access token lasts 1 day and carries the user and role", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    assert.equal(res.status, 200);
    const claims = jwt.decode(res.body.data.accessToken);
    assert.equal(claims.exp - claims.iat, 86_400);
    assert.equal(claims.sub, user.id);
    assert.equal(claims.role, "member");
  });

  it("the refresh token lasts 7 days, in an httpOnly cookie limited to the auth routes", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    assert.ok(res.setCookie.includes("HttpOnly"));
    assert.ok(res.setCookie.includes("Max-Age=604800"));
    assert.ok(res.setCookie.includes("Path=/api/v1/auth"));
    const claims = jwt.decode(tokenFrom(res.setCookie));
    assert.equal(claims.exp - claims.iat, 7 * 86_400);
  });

  it("without 'remember me' the cookie ends when the browser closes (no Max-Age)", async () => {
    const user = await createUser(TAG);
    const res = await login(user, false);
    assert.equal(res.status, 200);
    assert.ok(!res.setCookie.includes("Max-Age"));
    assert.ok(!res.setCookie.includes("Expires="));
  });

  it("the access token opens protected routes and is required for them", async () => {
    const user = await createUser(TAG);
    const { accessToken } = (await login(user)).body.data;
    assert.equal((await api("/me/dashboard", { token: accessToken })).status, 200);
    assert.equal((await api("/me/dashboard")).status, 401);
    assert.equal((await api("/me/dashboard", { token: `${accessToken}x` })).status, 401);
  });
});

describe("refresh tokens are stored, hashed, in their own table", () => {
  it("login stores one row: the hash of the cookie token, never the token", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    const token = tokenFrom(res.setCookie);
    const rows = await rowsOf(user.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, sha256(token));
    assert.notEqual(rows[0].token_hash, token);
    assert.equal(rows[0].revoked_at, null);
    assert.ok(new Date(rows[0].expires_at) > new Date(Date.now() + 6 * 86_400_000));
    assert.equal(rows[0].remember, true);
  });

  it("each refresh swaps the token: the old one is revoked and points to the new one", async () => {
    const user = await createUser(TAG);
    const first = await login(user);
    const oldToken = tokenFrom(first.setCookie);

    const refreshed = await api("/auth/refresh", { method: "POST", cookie: cookieFrom(first.setCookie) });
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.data.accessToken);
    assert.equal(refreshed.body.data.user.id, user.id);
    const newToken = tokenFrom(refreshed.setCookie);
    assert.notEqual(newToken, oldToken);

    const rows = await rowsOf(user.id);
    assert.equal(rows.length, 2);
    const [old, fresh] = rows;
    assert.ok(old.revoked_at);
    assert.equal(old.replaced_by, fresh.id);
    assert.equal(fresh.revoked_at, null);
    assert.equal(fresh.token_hash, sha256(newToken));

    // the new token keeps the session going
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: `ssj_refresh=${newToken}` })).status, 200);
  });

  it("the 'remember me' choice survives refreshing", async () => {
    const user = await createUser(TAG);
    const first = await login(user, false);
    const refreshed = await api("/auth/refresh", { method: "POST", cookie: cookieFrom(first.setCookie) });
    assert.equal(refreshed.status, 200);
    assert.ok(!refreshed.setCookie.includes("Max-Age"), "still a browser-session cookie");
    const rows = await rowsOf(user.id);
    assert.equal(rows.at(-1).remember, false);
  });

  it("using an old token again is treated as theft: every session of that user ends", async () => {
    const user = await createUser(TAG);
    const first = await login(user);
    const oldCookie = cookieFrom(first.setCookie);
    const refreshed = await api("/auth/refresh", { method: "POST", cookie: oldCookie });
    const newCookie = cookieFrom(refreshed.setCookie);

    await ageSwaps(user.id);
    const replay = await api("/auth/refresh", { method: "POST", cookie: oldCookie });
    assert.equal(replay.status, 401);

    // even the legitimate newest token no longer works
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: newCookie })).status, 401);
    const live = (await rowsOf(user.id)).filter((r) => !r.revoked_at);
    assert.equal(live.length, 0);
  });

  it("two requests with the same cookie at the same moment are the same person, not theft", async () => {
    const user = await createUser(TAG);
    const cookie = cookieFrom((await login(user)).setCookie);

    // a page that loads twice (React's development double render, two tabs) sends the same cookie twice
    const [a, b] = await Promise.all([api("/auth/refresh", { method: "POST", cookie }), api("/auth/refresh", { method: "POST", cookie })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200, "the second one is not treated as a stolen token");
    assert.ok(a.body.data.accessToken && b.body.data.accessToken);

    // and whichever cookie the browser ends up with keeps working
    for (const res of [a, b]) assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(res.setCookie) })).status, 200);
    assert.ok((await rowsOf(user.id)).some((r) => !r.revoked_at), "the session is still alive");
  });

  it("a replay long after the swap is still theft", async () => {
    const user = await createUser(TAG);
    const oldCookie = cookieFrom((await login(user)).setCookie);
    await api("/auth/refresh", { method: "POST", cookie: oldCookie });
    await ageSwaps(user.id);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: oldCookie })).status, 401);
    assert.equal((await rowsOf(user.id)).filter((r) => !r.revoked_at).length, 0);
  });

  it("two devices have two independent sessions", async () => {
    const user = await createUser(TAG);
    const a = await login(user);
    const b = await login(user);
    assert.equal((await rowsOf(user.id)).length, 2);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(a.setCookie) })).status, 200);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(b.setCookie) })).status, 200);
  });

  it("logging out ends that session on the server", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    const cookie = cookieFrom(res.setCookie);

    const out = await api("/auth/logout", { method: "POST", cookie });
    assert.equal(out.status, 200);
    assert.ok(out.setCookie.includes("ssj_refresh="), "the cookie is cleared");
    const [row] = await rowsOf(user.id);
    assert.ok(row.revoked_at, "the token is revoked in the table");

    // the cookie value, if someone kept a copy, is dead
    assert.equal((await api("/auth/refresh", { method: "POST", cookie })).status, 401);
  });

  it("a request with no cookie is refused", async () => {
    assert.equal((await api("/auth/refresh", { method: "POST" })).status, 401);
  });

  it("a tampered token is refused", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    const token = tokenFrom(res.setCookie);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: `ssj_refresh=${token}x` })).status, 401);
  });

  it("a genuinely signed token the server never issued is refused", async () => {
    const user = await createUser(TAG);
    const forged = jwt.sign({ sub: user.id, rem: true, jti: "11111111-1111-4111-8111-111111111111" }, process.env.JWT_REFRESH_SECRET ?? "", {
      expiresIn: "7d",
    });
    const res = await api("/auth/refresh", { method: "POST", cookie: `ssj_refresh=${forged}` });
    assert.equal(res.status, 401);
  });

  it("an expired token is refused", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    await sql(`UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [user.id]);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(res.setCookie) })).status, 401);
  });

  it("a blocked account cannot refresh, and its sessions are ended", async () => {
    const user = await createUser(TAG);
    const res = await login(user);
    await sql(`UPDATE users SET is_blocked = TRUE WHERE id = $1`, [user.id]);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(res.setCookie) })).status, 401);
    assert.equal((await rowsOf(user.id)).filter((r) => !r.revoked_at).length, 0);
  });

  it("resetting the password ends every session", async () => {
    const user = await createUser(TAG);
    const a = await login(user);
    const b = await login(user);

    const rawToken = `autotest-reset-${Date.now()}`;
    await sql(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`, [
      user.id,
      sha256(rawToken),
    ]);
    const reset = await api("/auth/reset-password", { body: { token: rawToken, password: "Brand@New123", confirmPassword: "Brand@New123" } });
    assert.equal(reset.status, 200);

    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(a.setCookie) })).status, 401);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(b.setCookie) })).status, 401);
    // and the new password works
    assert.equal((await api("/auth/login", { body: { email: user.email, password: "Brand@New123" } })).status, 200);
  });

  it("wrong credentials give no tokens and store nothing", async () => {
    const user = await createUser(TAG);
    const res = await api("/auth/login", { body: { email: user.email, password: "Wrong@12345" } });
    assert.equal(res.status, 401);
    assert.equal(res.setCookie, null);
    assert.equal((await rowsOf(user.id)).length, 0);
  });
});

describe("a token that was ended on purpose does not take the person's other sessions with it", () => {
  it("showing a logged-out token again is refused, but the other device stays signed in", async () => {
    const user = await createUser(TAG);
    const laptop = await login(user);
    const phone = await login(user);
    const laptopCookie = cookieFrom(laptop.setCookie);

    await api("/auth/logout", { method: "POST", cookie: laptopCookie });
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: laptopCookie })).status, 401);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(phone.setCookie) })).status, 200, "the phone session must survive");
  });

  it("only a token that was swapped for a newer one counts as copied", async () => {
    const user = await createUser(TAG);
    const phone = await login(user);
    const tablet = await login(user);
    const phoneCookie = cookieFrom(phone.setCookie);

    // the phone refreshes normally: its first token is now swapped out
    const refreshed = await api("/auth/refresh", { method: "POST", cookie: phoneCookie });
    assert.equal(refreshed.status, 200);

    // someone replays the swapped-out token a while later: refused, and every session of the user ends
    await ageSwaps(user.id);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: phoneCookie })).status, 401);
    assert.equal((await api("/auth/refresh", { method: "POST", cookie: cookieFrom(tablet.setCookie) })).status, 401);
  });
});
