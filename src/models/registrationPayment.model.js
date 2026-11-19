import { sql } from "../config/database.js";
import { createSqlRepository, rowToEntity } from "../db/sqlRepository.js";
import { getRegistrationFee } from "../config/plans.js";

const repo = createSqlRepository("registration_payments");

export const RegistrationPaymentModel = {
  ...repo,

  findByOrderId: (orderId) => repo.findOne("razorpay_order_id = $1", [orderId]),

  /** A person's attempts, newest first. */
  listForUser: (userId) => repo.list("user_id = $1", [userId]),

  /** How much a person has paid so far, in rupees, and when they last paid. */
  async paidSummary(userId) {
    const rows = await sql(
      `SELECT COALESCE(SUM(net_amount_in_rupees), 0)::float AS paid, MAX(paid_at) AS last_paid_at,
              (SELECT receipt FROM registration_payments WHERE user_id = $1 AND status = 'paid' ORDER BY paid_at DESC LIMIT 1) AS last_receipt
       FROM registration_payments WHERE user_id = $1 AND status = 'paid'`,
      [userId],
    );
    return { paid: rows[0].paid, lastPaidAt: rows[0].last_paid_at, lastReceipt: rows[0].last_receipt };
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

  /**
   * Records a refund against a payment and takes it off what the person has paid. Safe to call twice for the
   * same Razorpay refund (the admin's click and Razorpay's webhook both report it): the money is counted once.
   * Returns { inserted } so the caller knows whether this was the first time.
   */
  async recordRefund({ paymentId, refundId, amount, status = "pending", source = "admin", reason, createdBy }) {
    const [row] = await sql(
      `INSERT INTO payment_refunds (payment_id, razorpay_refund_id, amount_in_rupees, status, source, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (razorpay_refund_id) WHERE razorpay_refund_id IS NOT NULL
       DO UPDATE SET reason = COALESCE(payment_refunds.reason, EXCLUDED.reason),
                     created_by = COALESCE(payment_refunds.created_by, EXCLUDED.created_by),
                     source = CASE WHEN EXCLUDED.source = 'admin' THEN 'admin' ELSE payment_refunds.source END
       RETURNING id, (xmax = 0) AS inserted`,
      [paymentId, refundId ?? null, amount, status, source, reason ?? null, createdBy ?? null],
    );
    if (row.inserted && status !== "failed") {
      await sql(`UPDATE registration_payments SET refunded_amount = LEAST(amount_in_rupees, refunded_amount + $2) WHERE id = $1`, [paymentId, amount]);
    }
    return { id: row.id, inserted: row.inserted };
  },

  /** Razorpay says a refund finished (processed) or could not be made (failed; the money is counted as not refunded). */
  async settleRefund(refundId, status) {
    const [before] = await sql(`SELECT id, payment_id, amount_in_rupees, status FROM payment_refunds WHERE razorpay_refund_id = $1`, [refundId]);
    if (!before || before.status === status) return null;
    await sql(`UPDATE payment_refunds SET status = $2 WHERE id = $1`, [before.id, status]);
    if (status === "failed" && before.status !== "failed") {
      await sql(`UPDATE registration_payments SET refunded_amount = GREATEST(0, refunded_amount - $2) WHERE id = $1`, [before.payment_id, before.amount_in_rupees]);
    }
    return { paymentId: before.payment_id, amount: Number(before.amount_in_rupees) };
  },

  findByRazorpayPaymentId: (paymentId) => repo.findOne("razorpay_payment_id = $1", [paymentId]),

  async listRefunds(paymentId) {
    const rows = await sql(
      `SELECT r.id, r.razorpay_refund_id, r.amount_in_rupees, r.status, r.source, r.reason, r.created_at, u.full_name AS by
         FROM payment_refunds r LEFT JOIN users u ON u.id = r.created_by WHERE r.payment_id = $1 ORDER BY r.created_at DESC`,
      [paymentId],
    );
    return rows.map((r) => ({
      id: r.id,
      refundId: r.razorpay_refund_id,
      amount: Number(r.amount_in_rupees),
      status: r.status,
      source: r.source,
      reason: r.reason,
      createdAt: r.created_at,
      by: r.by,
    }));
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

  /**
   * People who still owe something (admins excluded): nothing paid yet, or part paid with a
   * balance. `state` filters to "pending" (nothing paid) or "partial" (part paid).
   */
  async listOwingUsers({ q, state, limit = 25, offset = 0 }) {
    const { total: TOTAL } = await getRegistrationFee();
    const params = [TOTAL];
    let search = "";
    if (q) {
      params.push(`%${q}%`);
      search = `AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.mobile ILIKE $${params.length})`;
    }
    const stateSql = state === "partial" ? "AND d.paid > 0" : state === "pending" ? "AND d.paid = 0" : "";
    const rows = await sql(
      `SELECT u.id, u.full_name, u.email, u.mobile, u.created_at, d.paid, COUNT(*) OVER()::int AS total_rows,
              (SELECT COALESCE(json_agg(r.type), '[]'::json) FROM all_registrations r WHERE r.user_id = u.id) AS registrations,
              last.status AS last_status, last.amount_in_rupees AS last_amount, last.created_at AS last_attempt_at
       FROM users u
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(net_amount_in_rupees), 0)::float AS paid FROM registration_payments
         WHERE user_id = u.id AND status = 'paid'
       ) d
       LEFT JOIN LATERAL (
         SELECT status, amount_in_rupees, created_at FROM registration_payments
         WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
       ) last ON TRUE
       WHERE u.deleted_at IS NULL AND u.role <> 'admin' AND d.paid < $1 ${stateSql} ${search}
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
        state: row.paid > 0 ? "partial" : "pending",
        paid: row.paid,
        balance: TOTAL - row.paid,
        lastAttempt: row.last_status
          ? { status: row.last_status, amount: Number(row.last_amount), at: row.last_attempt_at }
          : null,
      })),
    };
  },

  /** Money and head-counts for the admin dashboard. */
  async summary() {
    const fee = await getRegistrationFee();
    const TOTAL = fee.total;
    const [counts] = await sql(
      `SELECT COUNT(*) FILTER (WHERE d.paid >= $1)::int AS fully_paid,
              COUNT(*) FILTER (WHERE d.paid > 0 AND d.paid < $1)::int AS partial,
              COUNT(*) FILTER (WHERE d.paid = 0)::int AS unpaid,
              COALESCE(SUM(GREATEST($1 - d.paid, 0)), 0)::float AS outstanding,
              COUNT(*)::int AS members
       FROM users u
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(net_amount_in_rupees), 0)::float AS paid FROM registration_payments
         WHERE user_id = u.id AND status = 'paid'
       ) d
       WHERE u.deleted_at IS NULL AND u.role <> 'admin'`,
      [TOTAL],
    );
    const [collected] = await sql(
      `SELECT COALESCE(SUM(net_amount_in_rupees), 0)::float AS total, COUNT(*)::int AS payments,
              COALESCE(SUM(refunded_amount), 0)::float AS refunded,
              COALESCE(SUM(net_amount_in_rupees) FILTER (WHERE paid_at >= date_trunc('day', NOW())), 0)::float AS today_total,
              COUNT(*) FILTER (WHERE paid_at >= date_trunc('day', NOW()))::int AS today_count
       FROM registration_payments WHERE status = 'paid'`,
    );
    const [attempts] = await sql(
      `SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'created')::int AS abandoned
       FROM registration_payments`,
    );
    const expected = counts.members * TOTAL;
    return {
      fee: { total: TOTAL, minimum: fee.minimum },
      collected: {
        amount: collected.total,
        refunded: collected.refunded,
        payments: collected.payments,
        today: { amount: collected.today_total, count: collected.today_count },
      },
      members: { total: counts.members, fullyPaid: counts.fully_paid, partial: counts.partial, unpaid: counts.unpaid },
      outstanding: { amount: counts.outstanding, failedAttempts: attempts.failed, abandonedCheckouts: attempts.abandoned },
      collectionRate: expected === 0 ? 0 : Math.round((collected.total / expected) * 100),
    };
  },
};
