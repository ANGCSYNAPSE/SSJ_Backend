import { sql } from "../config/database.js";
import { createSqlRepository, rowToEntity } from "../db/sqlRepository.js";

const repo = createSqlRepository("registration_payments");

export const RegistrationPaymentModel = {
  ...repo,

  findByOrderId: (orderId) => repo.findOne("razorpay_order_id = $1", [orderId]),

  /** A person's attempts, newest first. */
  listForUser: (userId) => repo.list("user_id = $1", [userId]),

  async hasPaid(userId) {
    const rows = await sql(`SELECT 1 FROM registration_payments WHERE user_id = $1 AND status = 'paid' LIMIT 1`, [userId]);
    return rows.length > 0;
  },

  /** The paid row for a user, if any. */
  async findPaid(userId) {
    const rows = await sql(
      `SELECT * FROM registration_payments WHERE user_id = $1 AND status = 'paid' ORDER BY paid_at DESC LIMIT 1`,
      [userId],
    );
    return rowToEntity(rows[0]);
  },

  /** Marks an order paid (idempotent: an already-paid order keeps its first paid_at). */
  async markPaid(orderId, paymentId) {
    const rows = await sql(
      `UPDATE registration_payments
       SET status = 'paid', razorpay_payment_id = COALESCE($2, razorpay_payment_id), paid_at = COALESCE(paid_at, NOW()), failure_reason = NULL
       WHERE razorpay_order_id = $1 RETURNING *`,
      [orderId, paymentId ?? null],
    );
    return rowToEntity(rows[0]);
  },

  /** A failed attempt never overwrites a payment that already succeeded. */
  async markFailed(orderId, paymentId, reason) {
    const rows = await sql(
      `UPDATE registration_payments
       SET status = 'failed', razorpay_payment_id = COALESCE($2, razorpay_payment_id), failure_reason = $3
       WHERE razorpay_order_id = $1 AND status <> 'paid' RETURNING *`,
      [orderId, paymentId ?? null, reason ?? null],
    );
    return rowToEntity(rows[0]);
  },

  /**
   * Admin list of payment attempts with the payer, filtered and paged. `status` is the row's
   * status; `q` matches name, email or mobile.
   */
  async listForAdmin({ status, plan, q, from, to, userId, limit = 25, offset = 0 }) {
    const where = [];
    const params = [];
    const add = (sqlText, value) => {
      params.push(value);
      where.push(sqlText.replace("?", `$${params.length}`));
    };
    if (status) add("p.status = ?", status);
    if (plan) add("p.plan = ?", plan);
    if (userId) add("p.user_id = ?", userId);
    if (from) add("p.created_at >= ?", from);
    if (to) add("p.created_at < ?", to);
    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      where.push(`(u.full_name ILIKE $${i} OR u.email ILIKE $${i} OR u.mobile ILIKE $${i})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await sql(
      `SELECT p.*, u.full_name, u.email, u.mobile, COUNT(*) OVER()::int AS total_rows
       FROM registration_payments p JOIN users u ON u.id = p.user_id
       ${whereSql} ORDER BY p.created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params,
    );
    return {
      total: rows[0]?.total_rows ?? 0,
      items: rows.map((row) => {
        const { totalRows: _totalRows, amountInRupees, ...entity } = rowToEntity(row);
        return { ...entity, amount: Number(amountInRupees) };
      }),
    };
  },

  /** Users who have not paid yet (admins excluded), with their last attempt and registrations. */
  async listPendingUsers({ q, limit = 25, offset = 0 }) {
    const params = [];
    let search = "";
    if (q) {
      params.push(`%${q}%`);
      search = `AND (u.full_name ILIKE $1 OR u.email ILIKE $1 OR u.mobile ILIKE $1)`;
    }
    const rows = await sql(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.created_at, COUNT(*) OVER()::int AS total_rows,
              (SELECT COALESCE(json_agg(r.type), '[]'::json) FROM all_registrations r WHERE r.user_id = u.id) AS registrations,
              last.status AS last_status, last.plan AS last_plan, last.amount_in_rupees AS last_amount, last.created_at AS last_attempt_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT status, plan, amount_in_rupees, created_at FROM registration_payments
         WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
       ) last ON TRUE
       WHERE u.deleted_at IS NULL AND u.role <> 'admin'
         AND NOT EXISTS (SELECT 1 FROM registration_payments p WHERE p.user_id = u.id AND p.status = 'paid')
         ${search}
       ORDER BY u.created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params,
    );
    return {
      total: rows[0]?.total_rows ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        mobile: row.mobile,
        joinedAt: row.created_at,
        registrations: row.registrations,
        lastAttempt: row.last_status
          ? { status: row.last_status, plan: row.last_plan, amount: Number(row.last_amount), at: row.last_attempt_at }
          : null,
      })),
    };
  },

  /** Money and head-counts for the admin dashboard. */
  async summary() {
    const [paid] = await sql(
      `SELECT COUNT(DISTINCT user_id)::int AS payers, COALESCE(SUM(amount_in_rupees), 0)::float AS total
       FROM registration_payments WHERE status = 'paid'`,
    );
    const byPlan = await sql(
      `SELECT plan, COUNT(*)::int AS count, COALESCE(SUM(amount_in_rupees), 0)::float AS total
       FROM registration_payments WHERE status = 'paid' GROUP BY plan ORDER BY plan`,
    );
    const [pending] = await sql(
      `SELECT COUNT(*)::int AS users FROM users u
       WHERE u.deleted_at IS NULL AND u.role <> 'admin'
         AND NOT EXISTS (SELECT 1 FROM registration_payments p WHERE p.user_id = u.id AND p.status = 'paid')`,
    );
    const [attempts] = await sql(
      `SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'created')::int AS abandoned
       FROM registration_payments p
       WHERE NOT EXISTS (SELECT 1 FROM registration_payments q WHERE q.user_id = p.user_id AND q.status = 'paid')`,
    );
    const [today] = await sql(
      `SELECT COALESCE(SUM(amount_in_rupees), 0)::float AS total, COUNT(*)::int AS count
       FROM registration_payments WHERE status = 'paid' AND paid_at >= date_trunc('day', NOW())`,
    );
    const everyone = paid.payers + pending.users;
    return {
      collected: { amount: paid.total, payers: paid.payers, today: { amount: today.total, count: today.count } },
      byPlan: byPlan.map((row) => ({ plan: row.plan, count: row.count, amount: row.total })),
      pending: { users: pending.users, failedAttempts: attempts.failed, abandonedCheckouts: attempts.abandoned },
      collectionRate: everyone === 0 ? 0 : Math.round((paid.payers / everyone) * 100),
    };
  },
};
