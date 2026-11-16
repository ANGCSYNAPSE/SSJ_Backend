import { sql } from "../config/database.js";

/**
 * The columns safe to return to a client — password_hash is deliberately
 * excluded from every projection in this module.
 */
const PUBLIC_COLUMNS = sql`
  id, full_name, email, mobile, role, is_verified, created_at
`;

/** Maps a snake_case DB row to the camelCase shape the API exposes. */
export function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    role: row.role,
    isVerified: row.is_verified,
    isBlocked: row.is_blocked,
    isMember: row.is_member ?? false,
    location: row.location ?? null,
    avatarUrl: row.avatar_url ?? null,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
  };
}

export const UserModel = {
  async findById(id) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at
      FROM users
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    return toUser(row);
  },

  async findByEmail(email) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at
      FROM users
      WHERE email = ${email} AND deleted_at IS NULL
    `;
    return toUser(row);
  },

  /** Includes the hash — only for the login path, never returned to a client. */
  async findByEmailWithPassword(email) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at,
             password_hash
      FROM users
      WHERE email = ${email} AND deleted_at IS NULL
    `;
    if (!row) return null;
    return { ...toUser(row), passwordHash: row.password_hash };
  },

  async findByMobile(mobile) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at
      FROM users
      WHERE mobile = ${mobile} AND deleted_at IS NULL
    `;
    return toUser(row);
  },

  async create({
    fullName,
    email,
    mobile,
    passwordHash,
    role = "member",
    location = null,
    avatarUrl = null,
    isVerified = false,
    isBlocked = false,
    isMember = false,
  }) {
    const [row] = await sql`
      INSERT INTO users (full_name, email, mobile, password_hash, role, location, avatar_url, is_verified, is_blocked, is_member)
      VALUES (${fullName}, ${email}, ${mobile}, ${passwordHash}, ${role}, ${location}, ${avatarUrl}, ${isVerified}, ${isBlocked}, ${isMember})
      RETURNING id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at
    `;
    return toUser(row);
  },

  /** Admin profile edit. Only the keys present in `patch` are written. */
  async update(id, patch) {
    const columns = {
      fullName: "full_name",
      email: "email",
      mobile: "mobile",
      location: "location",
      avatarUrl: "avatar_url",
      role: "role",
      isVerified: "is_verified",
      isBlocked: "is_blocked",
      isMember: "is_member",
    };
    const entries = Object.entries(patch).filter(([key, value]) => key in columns && value !== undefined);
    if (entries.length === 0) return this.findById(id);

    const setSql = entries.map(([key], i) => `${columns[key]} = $${i + 1}`).join(", ");
    const values = entries.map(([, value]) => value);
    const rows = await sql(
      `UPDATE users SET ${setSql} WHERE id = $${values.length + 1} AND deleted_at IS NULL
       RETURNING id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, last_login_at, created_at`,
      [...values, id],
    );
    return toUser(rows[0]);
  },

  /** Soft delete: the row stays for referential history but the account is gone everywhere. */
  async softDelete(id) {
    const rows = await sql`
      UPDATE users SET deleted_at = NOW()
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  },

  async setPassword(id, passwordHash) {
    await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${id}`;
  },

  async touchLastLogin(id) {
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${id}`;
  },

  /** Admin user-management list — every non-deleted account. */
  async list() {
    const rows = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, last_login_at, created_at
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `;
    return rows.map(toUser);
  },

  async setBlocked(id, isBlocked) {
    const [row] = await sql`
      UPDATE users SET is_blocked = ${isBlocked}
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at
    `;
    return toUser(row);
  },

  async setRole(id, role) {
    const [row] = await sql`
      UPDATE users SET role = ${role}
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at
    `;
    return toUser(row);
  },
};
