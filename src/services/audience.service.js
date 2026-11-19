import { sql } from "../config/database.js";
import { getRegistrationFee } from "../config/plans.js";

/**
 * Who a broadcast goes to. An audience is one of:
 *   { mode: "all" }                                   every signed-up person (not admins, not blocked)
 *   { mode: "segment", segment: { ... } }             everyone who matches ALL the filters given
 *   { mode: "users", userIds: [...] }                 exactly these people (admins may be included, e.g. to send yourself a test)
 *
 * Segment filters:
 *   fee:          "paid" (fee paid in full) | "partial" (a balance is due) | "unpaid" (nothing paid)
 *   categories:   registered as any of these (artist, dancer, musician, temple, dharamshala, mandal)
 *   profile:      "incomplete" (a registration still has required details missing) | "complete"
 *   registration: "none" (plain members, no category) | "any" (registered in at least one category)
 *   verified:     "yes" (an admin has verified the account) | "no" (not verified yet)
 */
const MAX_AUDIENCE = 20_000;

/** The SQL that selects the audience's user ids, with its parameters. */
async function build(audience) {
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (audience.mode === "users") {
    return { text: `SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND u.id = ANY(${add(audience.userIds)}::uuid[])`, params };
  }

  const where = ["u.deleted_at IS NULL", "u.is_blocked = FALSE", "u.role <> 'admin'"];
  const segment = audience.mode === "segment" ? audience.segment ?? {} : {};

  if (segment.fee) {
    const { total } = await getRegistrationFee();
    const paid = "(SELECT COALESCE(SUM(p.net_amount_in_rupees), 0) FROM registration_payments p WHERE p.user_id = u.id AND p.status = 'paid')";
    where.push(segment.fee === "paid" ? `${paid} >= ${add(total)}` : segment.fee === "partial" ? `${paid} > 0 AND ${paid} < ${add(total)}` : `${paid} = 0`);
  }
  if (segment.categories?.length) {
    where.push(`EXISTS (SELECT 1 FROM all_registrations r WHERE r.user_id = u.id AND r.type::text = ANY(${add(segment.categories)}::text[]))`);
  }
  if (segment.profile) {
    const typeFilter = segment.categories?.length ? ` AND r.type::text = ANY(${add(segment.categories)}::text[])` : "";
    where.push(
      segment.profile === "incomplete"
        ? `EXISTS (SELECT 1 FROM all_registrations r WHERE r.user_id = u.id AND r.is_complete = FALSE${typeFilter})`
        : `EXISTS (SELECT 1 FROM all_registrations r WHERE r.user_id = u.id AND r.is_complete = TRUE${typeFilter})`,
    );
  }
  if (segment.registration === "none") where.push("NOT EXISTS (SELECT 1 FROM all_registrations r WHERE r.user_id = u.id)");
  if (segment.registration === "any") where.push("EXISTS (SELECT 1 FROM all_registrations r WHERE r.user_id = u.id)");
  if (segment.verified) where.push(segment.verified === "yes" ? "u.is_verified = TRUE" : "u.is_verified = FALSE");

  return { text: `SELECT u.id FROM users u WHERE ${where.join(" AND ")}`, params };
}

/** Every person the audience reaches (capped, so one click can never become an unbounded write). */
export async function audienceUserIds(audience) {
  const { text, params } = await build(audience);
  const rows = await sql(`${text} LIMIT ${MAX_AUDIENCE}`, params);
  return rows.map((row) => row.id);
}

/** How many people an audience reaches, and a few of their names, for the admin's "this will reach N people" line. */
export async function audiencePreview(audience) {
  const { text, params } = await build(audience);
  const [{ count }] = await sql(`SELECT COUNT(*)::int AS count FROM (${text}) a`, params);
  const sample = await sql(
    `SELECT u.full_name FROM users u WHERE u.id IN (${text} LIMIT 5) ORDER BY u.full_name`,
    params,
  );
  return { count: Math.min(count, MAX_AUDIENCE), capped: count > MAX_AUDIENCE, sample: sample.map((row) => row.full_name) };
}
