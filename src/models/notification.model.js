import { sql } from "../config/database.js";

function toNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    title: row.title,
    message: row.message,
    link: row.link,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export const NotificationModel = {
  /** One row per recipient; ids that aren't a live account are skipped. Returns how many were sent. */
  async createMany({ userIds, kind, title, message, link, createdBy }) {
    const rows = await sql(
      `INSERT INTO notifications (user_id, kind, title, message, link, created_by)
       SELECT u.id, $2, $3, $4, $5, $6 FROM users u
       WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL
       RETURNING id`,
      [userIds, kind, title ?? null, message, link ?? null, createdBy],
    );
    return rows.length;
  },

  async listUnread(userId, limit = 20) {
    const rows = await sql(
      `SELECT * FROM notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map(toNotification);
  },

  /** Marks the given notifications read, or every unread one when `ids` is omitted. */
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
    const rows = await sql(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map(toNotification);
  },
};
