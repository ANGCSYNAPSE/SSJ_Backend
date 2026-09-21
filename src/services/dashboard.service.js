import { sql } from "../config/database.js";

const WEEK = "created_at >= NOW() - INTERVAL '7 days'";
const MONTH = "created_at >= date_trunc('month', NOW())";
const QUARTER = "created_at >= NOW() - INTERVAL '3 months'";

async function one(query, params = []) {
  const rows = await sql(query, params);
  return rows[0] ?? {};
}

/**
 * Every count/sum here is a real query against existing tables — nothing is
 * fabricated. Deltas (e.g. "N new this week") are only included when they
 * come from an actual timestamp on the row; metrics with no underlying data
 * source (page views, login events, booking flags) are intentionally left
 * off rather than invented.
 */
export async function getDashboardStats() {
  const [
    temples,
    artists,
    dharamshalas,
    donations,
    communities,
    events,
    blogPosts,
    users,
    pendingRegistrations,
    organisations,
    ads,
    volunteers,
  ] = await Promise.all([
    one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${WEEK})::int AS new_this_week
       FROM registrations WHERE type = 'temple' AND status = 'approved'`,
    ),
    one(
      `SELECT COUNT(*)::int AS total,
              (SELECT COUNT(*)::int FROM registrations WHERE type IN ('artist','dancer','musician') AND status = 'pending') AS pending_approval
       FROM registrations WHERE type IN ('artist','dancer','musician') AND status = 'approved'`,
    ),
    one(
      `SELECT COUNT(*)::int AS total
       FROM registrations WHERE type = 'dharamshala' AND status = 'approved'`,
    ),
    one(
      `SELECT COALESCE(SUM(amount_in_rupees), 0)::numeric AS total,
              COALESCE(SUM(amount_in_rupees) FILTER (WHERE ${MONTH}), 0)::numeric AS this_month,
              COALESCE(SUM(amount_in_rupees) FILTER (WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '1 month' AND created_at < date_trunc('month', NOW())), 0)::numeric AS last_month
       FROM donations WHERE status = 'paid'`,
    ),
    one(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(member_count), 0)::int AS members,
              COALESCE(SUM(daily_discussions), 0)::int AS daily_discussions
       FROM communities WHERE is_active = TRUE`,
    ),
    one(
      `SELECT COUNT(*)::int AS total
       FROM events WHERE is_published = TRUE AND (end_date IS NULL OR end_date >= NOW())`,
    ),
    one(`SELECT COUNT(*)::int AS total FROM blog_posts WHERE is_published = TRUE`),
    one(`SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL`),
    one(`SELECT COUNT(*)::int AS total FROM registrations WHERE status = 'pending'`),
    one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${MONTH})::int AS new_this_month
       FROM organisations WHERE is_active = TRUE`,
    ),
    one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${WEEK})::int AS new_this_week
       FROM ads WHERE is_active = TRUE`,
    ),
    one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ${QUARTER})::int AS new_this_quarter
       FROM event_volunteers`,
    ),
  ]);

  return {
    temples: { total: temples.total ?? 0, newThisWeek: temples.new_this_week ?? 0 },
    artists: { total: artists.total ?? 0, pendingApproval: artists.pending_approval ?? 0 },
    dharamshalas: { total: dharamshalas.total ?? 0 },
    donations: {
      totalRupees: Number(donations.total ?? 0),
      thisMonthRupees: Number(donations.this_month ?? 0),
      lastMonthRupees: Number(donations.last_month ?? 0),
    },
    communities: {
      total: communities.total ?? 0,
      members: communities.members ?? 0,
      dailyDiscussions: communities.daily_discussions ?? 0,
    },
    events: { activeOrUpcoming: events.total ?? 0 },
    blogPosts: { published: blogPosts.total ?? 0 },
    users: { total: users.total ?? 0 },
    registrations: { pending: pendingRegistrations.total ?? 0 },
    organisations: { total: organisations.total ?? 0, newThisMonth: organisations.new_this_month ?? 0 },
    ads: { active: ads.total ?? 0, newThisWeek: ads.new_this_week ?? 0 },
    volunteers: { total: volunteers.total ?? 0, newThisQuarter: volunteers.new_this_quarter ?? 0 },
  };
}

/** Last 12 calendar months of paid donations, oldest first, zero-filled for months with no donations. */
export async function getDonationTrends() {
  const rows = await sql(
    `SELECT date_trunc('month', created_at) AS month_start,
            SUM(amount_in_rupees)::numeric AS total
     FROM donations
     WHERE status = 'paid' AND created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
     GROUP BY 1
     ORDER BY 1`,
  );

  const byMonth = new Map(rows.map((row) => [row.month_start.toISOString().slice(0, 7), Number(row.total)]));

  const months = [];
  const cursor = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - 11);

  for (let i = 0; i < 12; i += 1) {
    const key = cursor.toISOString().slice(0, 7);
    months.push({
      month: cursor.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      totalRupees: byMonth.get(key) ?? 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

/** Merges the most recent rows from a few tables into one reverse-chronological feed. */
export async function getActivityFeed(limit = 10) {
  const rows = await sql(
    `SELECT * FROM (
       (SELECT 'temple_listed' AS kind, full_name AS actor, created_at
          FROM registrations WHERE type = 'temple' AND status = 'approved'
          ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'donation_received' AS kind, CASE WHEN anonymous THEN 'Anonymous' ELSE donor_name END AS actor, created_at
          FROM donations WHERE status = 'paid'
          ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'blog_submitted' AS kind, title AS actor, created_at
          FROM blog_posts
          ORDER BY created_at DESC LIMIT 5)
       UNION ALL
       (SELECT 'artist_approval_requested' AS kind, full_name AS actor, created_at
          FROM registrations WHERE type IN ('artist','dancer','musician') AND status = 'pending'
          ORDER BY created_at DESC LIMIT 5)
     ) feed
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );

  const messages = {
    temple_listed: (actor) => `New temple listed: ${actor}`,
    donation_received: (actor) => `${actor === "Anonymous" ? "Anonymous donation" : `Donation from ${actor}`} received`,
    blog_submitted: (actor) => `New blog post submitted: ${actor}`,
    artist_approval_requested: (actor) => `Artist approval requested by ${actor}`,
  };

  return rows.map((row) => ({
    kind: row.kind,
    message: messages[row.kind](row.actor),
    createdAt: row.created_at,
  }));
}
