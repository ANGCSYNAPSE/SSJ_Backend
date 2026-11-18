/**
 * Sets a new password for an administrator, straight in the database. For when you cannot sign in
 * to the admin panel and email reset is not available.
 *
 *   node scripts/set-admin-password.mjs <admin-email> <new-password>
 *   node scripts/set-admin-password.mjs --list
 *
 * Passwords are stored only as hashes, so an existing password can never be read back; this sets a new one.
 * It also ends every signed-in session of that admin, and un-blocks the account if it was blocked.
 * Run it from the SSJ_Backend folder (it reads the DATABASE_URL in .env).
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { sql } from "../src/config/database.js";

const [first, second] = process.argv.slice(2);

if (first === "--list") {
  const rows = await sql(`SELECT full_name, email, is_blocked, last_login_at FROM users WHERE role = 'admin' AND deleted_at IS NULL ORDER BY created_at`);
  for (const r of rows) console.log(`${r.email}  (${r.full_name})${r.is_blocked ? "  BLOCKED" : ""}  last sign-in: ${r.last_login_at ?? "never"}`);
  process.exit(0);
}

const email = first?.trim().toLowerCase();
const password = second;
if (!email || !password) {
  console.error("Usage: node scripts/set-admin-password.mjs <admin-email> <new-password>\n       node scripts/set-admin-password.mjs --list");
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error("The password needs at least 8 characters, with a letter and a number.");
  process.exit(1);
}

const [admin] = await sql(`SELECT id, full_name FROM users WHERE lower(email) = $1 AND role = 'admin' AND deleted_at IS NULL`, [email]);
if (!admin) {
  console.error(`No administrator with the email ${email}. Run with --list to see them.`);
  process.exit(1);
}

const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12));
await sql(`UPDATE users SET password_hash = $2, is_blocked = FALSE WHERE id = $1`, [admin.id, hash]);
await sql(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1`, [admin.id]);
console.log(`Done. ${admin.full_name} (${email}) can now sign in with the new password.`);
process.exit(0);
