import { sql } from "../config/database.js";

/**
 * The columns safe to return to a client — password_hash is deliberately
 * excluded from every projection in this module.
 */
const PUBLIC_COLUMNS = sql`
  id, full_name, email, mobile, role, is_verified, created_at
`;

/** Maps a snake_case DB row to the camelCase shape the API exposes. */
function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    role: row.role,
    isVerified: row.is_verified,
    createdAt: row.created_at,
  };
}

export const UserModel = {
  async findById(id) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, created_at
      FROM users
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    return toUser(row);
  },

  async findByEmail(email) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, created_at
      FROM users
      WHERE email = ${email} AND deleted_at IS NULL
    `;
    return toUser(row);
  },

  /** Includes the hash — only for the login path, never returned to a client. */
  async findByEmailWithPassword(email) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, created_at,
             password_hash
      FROM users
      WHERE email = ${email} AND deleted_at IS NULL
    `;
    if (!row) return null;
    return { ...toUser(row), passwordHash: row.password_hash };
  },

  async findByMobile(mobile) {
    const [row] = await sql`
      SELECT id, full_name, email, mobile, role, is_verified, created_at
      FROM users
      WHERE mobile = ${mobile} AND deleted_at IS NULL
    `;
    return toUser(row);
  },

  async create({ fullName, email, mobile, passwordHash, role = "member" }) {
    const [row] = await sql`
      INSERT INTO users (full_name, email, mobile, password_hash, role)
      VALUES (${fullName}, ${email}, ${mobile}, ${passwordHash}, ${role})
      RETURNING id, full_name, email, mobile, role, is_verified, created_at
    `;
    return toUser(row);
  },

  async touchLastLogin(id) {
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${id}`;
  },
};
