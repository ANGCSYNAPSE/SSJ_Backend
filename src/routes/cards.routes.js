import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sql } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

/**
 * A shareable digital card: a name, a photo and what the person is on Shyam Jagat, with a QR code that opens the card's own
 * page. Only what the person would put on a visiting card is public: never an email, a phone number or an address.
 * The page is open only while the owner has sharing switched on.
 */

// Letters and digits that cannot be mistaken for one another (no 0/O, 1/I/L).
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const makeCode = () => Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");

const CATEGORY_LABELS = { artist: "Artist", dancer: "Dancer", musician: "Musician", temple: "Temple", dharamshala: "Dharamshala", mandal: "Mandal" };

/** What a card says the person is: only what the team has approved, or what they have paid for. */
async function kindsOf(userId, isMember) {
  const [registrations, volunteer, paid] = await Promise.all([
    sql(`SELECT DISTINCT type::text AS type FROM all_registrations WHERE user_id = $1 AND status = 'approved'`, [userId]),
    sql(`SELECT 1 FROM volunteers WHERE user_id = $1 AND status = 'approved'`, [userId]),
    sql(`SELECT 1 FROM registration_payments WHERE user_id = $1 AND status = 'paid' LIMIT 1`, [userId]),
  ]);
  const kinds = [];
  if (isMember || paid.length > 0) kinds.push("Member");
  if (volunteer.length > 0) kinds.push("Volunteer");
  for (const r of registrations) kinds.push(CATEGORY_LABELS[r.type] ?? r.type);
  return kinds.length ? kinds : ["Devotee"];
}

const publicCard = async (row) => ({
  code: row.card_code,
  name: row.full_name,
  photoUrl: row.avatar_url ?? null,
  location: row.location ?? null,
  verified: Boolean(row.is_verified),
  memberSince: row.created_at,
  kinds: await kindsOf(row.id, row.is_member),
});

const cardUrl = (code) => `${env.siteUrl}/card/${code}`;

const SELECT = `SELECT id, full_name, avatar_url, location, is_verified, is_member, created_at, card_code, card_enabled FROM users`;

/**
 * @openapi
 * /api/v1/me/card:
 *   get:
 *     tags: [Cards]
 *     summary: My digital card (made on first use), with its share link and whether sharing is on
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The card }
 *   patch:
 *     tags: [Cards]
 *     summary: Switch sharing of my card on or off
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Saved }
 * /api/v1/cards/{code}:
 *   get:
 *     tags: [Cards]
 *     summary: A shared digital card, for anyone with its link (404 when sharing is off)
 *     responses:
 *       200: { description: The card }
 *       404: { description: No such card }
 */

/** The signed-in person's own card. Mounted at /api/v1/me/card. */
export const cardMeRouter = Router();

async function ensureCode(userId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const [row] = await sql(`UPDATE users SET card_code = COALESCE(card_code, $2) WHERE id = $1 RETURNING card_code`, [userId, makeCode()]);
      return row.card_code;
    } catch (error) {
      if (error?.code !== "23505") throw error; // a code already taken: try another
    }
  }
  throw ApiError.serviceUnavailable("Could not make your card just now. Please try again.");
}

const mine = async (userId) => {
  await ensureCode(userId);
  const [row] = await sql(`${SELECT} WHERE id = $1`, [userId]);
  return { enabled: row.card_enabled, url: cardUrl(row.card_code), card: await publicCard(row) };
};

cardMeRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    sendSuccess(res, { data: await mine(req.user.id) });
  }),
);

cardMeRouter.patch(
  "/",
  requireAuth,
  validate(z.object({ enabled: z.boolean() })),
  asyncHandler(async (req, res) => {
    await ensureCode(req.user.id);
    await sql(`UPDATE users SET card_enabled = $2 WHERE id = $1`, [req.user.id, req.validated.enabled]);
    sendSuccess(res, { message: req.validated.enabled ? "Your card can now be shared." : "Your card is private again.", data: await mine(req.user.id) });
  }),
);

/** A shared card. Mounted at /api/v1/cards. */
export const publicCardRouter = Router();

publicCardRouter.get(
  "/:code",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) throw ApiError.notFound("This card was not found.");
    const [row] = await sql(`${SELECT} WHERE card_code = $1 AND card_enabled = TRUE AND deleted_at IS NULL AND is_blocked = FALSE`, [code]);
    // A card that is off looks exactly like a card that does not exist.
    if (!row) throw ApiError.notFound("This card was not found.");
    sendSuccess(res, { data: await publicCard(row) });
  }),
);
