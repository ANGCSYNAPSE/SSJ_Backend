import { Router } from "express";
import { sql } from "../config/database.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";

/** What happened on the website lately, for the admin's bell. Mounted at /api/v1/admin/activity (admin only). */
export const adminActivityRouter = Router();

/**
 * @openapi
 * /api/v1/admin/activity:
 *   get:
 *     tags: [Notifications]
 *     summary: Recent happenings and what needs the admin's attention (admin)
 *     description: "Returns { attention: { registrations, unverified, messages }, items: [{ id, kind, title, detail, link, at }] }, newest first. Built from live data; the admin app remembers what it has already shown."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Activity }
 */
adminActivityRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [attention] = await sql(
      `SELECT (SELECT COUNT(*)::int FROM all_registrations WHERE status = 'pending' AND is_complete) AS registrations,
              (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND role <> 'admin' AND is_verified = FALSE AND is_blocked = FALSE) AS unverified,
              (SELECT COUNT(*)::int FROM contact_submissions WHERE is_handled = FALSE) AS messages`,
    );

    // A first payment lands within minutes of the signup it created; only later payments are news of their own.
    const rows = await sql(
      `SELECT * FROM (
         (SELECT 'signup' AS kind, u.id::text AS id, u.full_name AS who, NULL::text AS detail, NULL::numeric AS amount, u.created_at AS at
            FROM users u WHERE u.deleted_at IS NULL AND u.role <> 'admin' ORDER BY u.created_at DESC LIMIT 10)
         UNION ALL
         (SELECT 'registration', r.id::text, r.display_name, r.type::text, NULL::numeric, r.created_at
            FROM all_registrations r WHERE r.status = 'pending' AND r.is_complete ORDER BY r.created_at DESC LIMIT 10)
         UNION ALL
         (SELECT 'payment', p.id::text, u.full_name, NULL::text, p.amount_in_rupees, p.paid_at
            FROM registration_payments p JOIN users u ON u.id = p.user_id
           WHERE p.status = 'paid' AND p.paid_at > u.created_at + INTERVAL '15 minutes'
           ORDER BY p.paid_at DESC LIMIT 10)
         UNION ALL
         (SELECT 'donation', d.id::text, CASE WHEN d.anonymous THEN 'Anonymous' ELSE d.donor_name END, d.cause::text, d.amount_in_rupees, d.created_at
            FROM donations d WHERE d.status = 'paid' ORDER BY d.created_at DESC LIMIT 10)
         UNION ALL
         (SELECT 'message', c.id::text, c.name, c.subject::text, NULL::numeric, c.created_at
            FROM contact_submissions c WHERE c.is_handled = FALSE ORDER BY c.created_at DESC LIMIT 10)
       ) feed
       ORDER BY at DESC LIMIT 30`,
    );

    const describe = (row) => {
      switch (row.kind) {
        case "signup":
          return { title: `${row.who} joined`, detail: "New member", link: "/verification" };
        case "registration":
          return { title: `New ${row.detail} registration`, detail: `${row.who} is waiting for review`, link: "/registrations" };
        case "payment":
          return { title: `₹${Number(row.amount).toLocaleString("en-IN")} fee received`, detail: `From ${row.who}`, link: "/payments" };
        case "donation":
          return { title: `₹${Number(row.amount).toLocaleString("en-IN")} donation`, detail: `${row.who} · ${row.detail}`, link: "/donations" };
        default:
          return { title: `Message from ${row.who}`, detail: row.detail || "Contact form", link: "/contact-inquiries" };
      }
    };

    sendSuccess(res, {
      data: {
        attention,
        items: rows.map((row) => ({ id: `${row.kind}:${row.id}`, kind: row.kind, ...describe(row), at: row.at })),
      },
    });
  }),
);
