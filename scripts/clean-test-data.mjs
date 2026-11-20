/**
 * Removes everything the automated tests leave behind: any account, signup, donation or message whose email starts
 * with "autotest+". Safe to run any time no test run is in progress; real people are never touched.
 *
 *   npm run clean:test-data
 */
import "dotenv/config";
import { sql } from "../src/config/database.js";

const like = "autotest+%";
const count = async (text) => (await sql(text, [like]))[0].n;

const before = {
  users: await count(`SELECT COUNT(*)::int AS n FROM users WHERE email LIKE $1 OR full_name = 'Auto Test'`),
  signups: await count(`SELECT COUNT(*)::int AS n FROM pending_signups WHERE email LIKE $1`),
};

// What the test accounts sent or own, then the accounts themselves (their registrations, sessions and notifications go with them).
await sql(`DELETE FROM notification_broadcasts WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1 OR full_name = 'Auto Test')`, [like]);
await sql(`DELETE FROM donations WHERE email LIKE $1`, [like]);
await sql(`DELETE FROM contact_submissions WHERE email LIKE $1`, [like]);
await sql(
  `DELETE FROM registration_payments
    WHERE pending_signup_id IN (SELECT id FROM pending_signups WHERE email LIKE $1)
       OR user_id IN (SELECT id FROM users WHERE email LIKE $1 OR full_name = 'Auto Test')`,
  [like],
);
await sql(`DELETE FROM pending_signups WHERE email LIKE $1`, [like]);
await sql(`DELETE FROM users WHERE email LIKE $1 OR full_name = 'Auto Test'`, [like]);

const after = {
  users: await count(`SELECT COUNT(*)::int AS n FROM users WHERE email LIKE $1`),
  signups: await count(`SELECT COUNT(*)::int AS n FROM pending_signups WHERE email LIKE $1`),
};
console.log(`Removed ${before.users} test accounts and ${before.signups} test signups. Left: ${after.users} accounts, ${after.signups} signups.`);
process.exit(0);
