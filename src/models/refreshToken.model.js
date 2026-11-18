import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { sql } from "../config/database.js";
import { env } from "../config/env.js";

const hash = (token) => createHash("sha256").update(token).digest("hex");

const clip = (value, max) => (value ? String(value).slice(0, max) : null);

/**
 * Refresh tokens. The browser holds the token (in an httpOnly cookie); the database holds only its
 * hash, so a leaked table cannot be used to sign in. The access token is a short-lived signed JWT
 * and is not stored. Every refresh swaps the token for a new one; using a swapped-out token again means it
 * was copied, so every session of that user is ended.
 */
export const RefreshTokens = {
  /** Creates and stores a new refresh token for a user and returns it. */
  async issue(user, { remember = true, ip, userAgent } = {}) {
    const id = randomUUID();
    const token = jwt.sign({ sub: user.id, rem: remember, jti: id }, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshTtl });
    const { exp } = jwt.decode(token);
    await sql(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, remember, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7)`,
      [id, user.id, hash(token), remember, exp, clip(userAgent, 255), clip(ip, 64)],
    );
    // Tidy up now and then so the table does not grow forever.
    if (Math.random() < 0.05) await this.purgeExpired();
    return token;
  },

  /**
   * Swaps a valid token for a new one. Returns { userId, remember, token } on success, { reused: true }
   * when a revoked token is shown again (all of that user's sessions are ended), or null when the
   * token is unknown, expired or not genuine.
   */
  async rotate(token, context = {}) {
    let payload;
    try {
      payload = jwt.verify(token, env.jwt.refreshSecret);
    } catch {
      return null;
    }
    if (!payload.jti) return null;

    const [row] = await sql(`SELECT * FROM refresh_tokens WHERE id = $1`, [payload.jti]);
    if (!row || row.token_hash !== hash(token)) return null;
    if (row.revoked_at) {
      // A token that was swapped for a newer one (replaced_by) and is shown again was copied: end every session.
      // A token ended on purpose (logout, password change) is simply refused: it must not sign out the
      // person's other devices, least of all the one that just changed the password.
      if (row.replaced_by) {
        await this.revokeAllForUser(row.user_id);
        return { reused: true };
      }
      return null;
    }
    if (new Date(row.expires_at) < new Date()) return null;

    const next = await this.issue({ id: row.user_id }, { remember: row.remember, ...context });
    const nextId = jwt.decode(next).jti;
    await sql(`UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $2, last_used_at = NOW() WHERE id = $1`, [row.id, nextId]);
    return { userId: row.user_id, remember: row.remember, token: next };
  },

  /** Ends the session this token belongs to (logout). Unknown or broken tokens are ignored. */
  async revoke(token) {
    const payload = jwt.decode(token);
    if (!payload?.jti) return;
    await sql(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1 AND token_hash = $2`, [payload.jti, hash(token)]);
  },

  /** Ends every session of a user (password reset, blocked account, token reuse). */
  async revokeAllForUser(userId) {
    await sql(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1`, [userId]);
  },

  async purgeExpired() {
    await sql(`DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`);
  },
};
