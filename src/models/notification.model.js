import { sql } from "../config/database.js";

/** What a message is about. Drives the icon in the bell and the filter on the notifications page. */
export const NOTIFICATION_CATEGORIES = ["announcement", "event", "update", "seva", "payment", "registration", "system"];

function toNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    category: row.category ?? "announcement",
    title: row.title,
    message: row.message,
    link: row.link,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export const NotificationModel = {
  /**
   * One row per recipient; ids that aren't a live account are skipped. Returns how many were sent.
   * `broadcastId` ties the rows to one admin broadcast.
   */
  async createMany({ userIds, kind = "info", category = "announcement", title, message, link, createdBy, broadcastId }) {
    const rows = await sql(
      `INSERT INTO notifications (user_id, kind, category, title, message, link, created_by, broadcast_id)
       SELECT u.id, $2, $3, $4, $5, $6, $7, $8 FROM users u
       WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL
       RETURNING id`,
      [userIds, kind, category, title ?? null, message, link ?? null, createdBy ?? null, broadcastId ?? null],
    );
    return rows.length;
  },

  /**
   * A system message to one person (payment received, registration approved...). With a `dedupeKey` it is
   * sent at most once per person, so a payment confirmed by both the browser and the webhook gives one message.
   * Never throws: a missed notification must not undo the payment or the review it describes.
   */
  async notify(userId, { kind = "info", category = "system", title, message, link, dedupeKey }) {
    try {
      await sql(
        `INSERT INTO notifications (user_id, kind, category, title, message, link, dedupe_key)
         SELECT u.id, $2, $3, $4, $5, $6, $7 FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [userId, kind, category, title ?? null, message, link ?? null, dedupeKey ?? null],
      );
    } catch (error) {
      console.error("[notifications] could not notify:", error.message);
    }
  },

  async listUnread(userId, limit = 20) {
    const rows = await sql(
      `SELECT * FROM notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map(toNotification);
  },

  async countUnread(userId) {
    const [row] = await sql(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]);
    return row.n;
  },

  /**
   * The signed-in person's notifications, newest first, paged by `before` (the createdAt of the last item
   * they already have). Optionally only unread ones, or one category.
   */
  async feed(userId, { limit = 20, before, unreadOnly = false, category } = {}) {
    const params = [userId];
    const where = ["user_id = $1"];
    if (before) {
      params.push(before);
      where.push(`created_at < $${params.length}`);
    }
    if (unreadOnly) where.push("read_at IS NULL");
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    const rows = await sql(
      `SELECT * FROM notifications WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${Number(limit) + 1}`,
      params,
    );
    const items = rows.slice(0, limit).map(toNotification);
    return { items, nextCursor: rows.length > limit ? items.at(-1).createdAt : null };
  },

  /** Marks the given notifications read, or every unread one when `ids` is omitted. Only the owner's rows are touched. */
  async markRead(userId, ids) {
    const rows = await sql(
      `UPDATE notifications SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
       RETURNING id`,
      [userId, ids ?? null],
    );
    return rows.length;
  },

  /** What an admin has sent to one user, newest first. */
  async listForUser(userId, limit = 50) {
    const rows = await sql(`SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return rows.map(toNotification);
  },
};
