import bcrypt from "bcryptjs";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "../config/database.js";
import { sendPasswordResetCodeEmail, sendSecurityNoticeEmail } from "./mail.service.js";
import { env } from "../config/env.js";
import { UserModel, toUser } from "../models/user.model.js";
import { listProfilesForUser, missingFieldsFor, profileRepository } from "../models/profile.model.js";
import { RegistrationPaymentModel } from "../models/registrationPayment.model.js";
import { feeState, getRegistrationFee } from "../config/plans.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken } from "../utils/tokens.js";
import { RefreshTokens } from "../models/refreshToken.model.js";

/**
 * Business logic for authentication. Controllers stay thin: they parse input
 * and shape responses, everything below is the actual rule set.
 */
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

const USER_COLUMNS =
  "id, full_name, email, mobile, role, is_verified, verified_at, email_verified_at, mobile_verified_at, is_blocked, is_member, location, avatar_url, created_at";

const RESET_CODE_MINUTES = 15;
const RESET_TOKEN_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_SECONDS = 45;
const RESET_MAX_PER_HOUR = 5;
const resetCodeHash = (userId, code) => createHmac("sha256", env.jwt.refreshSecret).update(`pwreset:${userId}:${code}`).digest("hex");

export const AuthService = {
  /** Adds the categories (artist, temple, ...) the user has registered for. */
  async withProfiles(user) {
    if (!user) return user;
    const [profiles, { paid }, fee] = await Promise.all([listProfilesForUser(user.id), RegistrationPaymentModel.paidSummary(user.id), getRegistrationFee()]);
    // Admins never pay a fee.
    return { ...user, profiles, registrationFee: user.role === "admin" ? "paid" : feeState(paid, fee) };
  },

  /**
   * Whether an email / mobile already belongs to an account. When the email's owner left a
   * registration unfinished, says which category, so the form can send them to finish it.
   */
  async checkAvailability({ email, mobile }) {
    const [byEmail, byMobile] = await Promise.all([
      email ? UserModel.findByEmail(email) : null,
      mobile ? UserModel.findByMobile(mobile) : null,
    ]);

    let incomplete = null;
    if (byEmail) {
      const unfinished = (await listProfilesForUser(byEmail.id)).find((p) => p.isComplete === false);
      if (unfinished) incomplete = { category: unfinished.category, missing: unfinished.missing.length };
    }
    return { emailTaken: Boolean(byEmail), mobileTaken: Boolean(byMobile), incomplete };
  },

  async signup({ fullName, email, mobile, password, becomeMember = false, category, profile }) {
    const [byEmail, byMobile] = await Promise.all([
      UserModel.findByEmail(email),
      UserModel.findByMobile(mobile),
    ]);

    // Reported per-field so the form can highlight the offending input.
    const conflicts = [];
    if (byEmail) {
      conflicts.push({
        field: "email",
        message: "An account with this email already exists.",
      });
    }
    if (byMobile) {
      conflicts.push({
        field: "mobile",
        message: "An account with this mobile number already exists.",
      });
    }
    if (conflicts.length > 0) {
      throw ApiError.conflict("This account already exists.", conflicts);
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
    return this.createAccount({ fullName, email, mobile, passwordHash, becomeMember, category, profile });
  },

  /**
   * Writes the account (and its category row, if any) and signs it in. `emailVerified` is true when
   * the person has already proved they own the email (the signup code step).
   */
  async createAccount({ fullName, email, mobile, passwordHash, becomeMember = false, category, profile, location, emailVerified = false }) {
    let user;
    if (category) {
      // The account and its category row are written together: a failed
      // category insert must not leave behind a half-registered user.
      const userId = randomUUID();
      const [profileText, profileValues] = profileRepository(category).insertQuery({
        ...profile,
        userId,
        missingFields: missingFieldsFor(category, profile),
      });
      try {
        const [[userRow]] = await sql.transaction((txn) => [
          txn(
            `INSERT INTO users (id, full_name, email, mobile, password_hash, is_member, email_verified_at)
             VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN NOW() END) RETURNING ${USER_COLUMNS}`,
            [userId, fullName, email, mobile, passwordHash, becomeMember, emailVerified],
          ),
          txn(profileText, profileValues),
        ]);
        user = toUser(userRow);
      } catch (error) {
        if (error?.code === "23505") {
          throw ApiError.conflict("This account already exists.");
        }
        throw error;
      }
    } else {
      try {
        const [row] = await sql(
          `INSERT INTO users (full_name, email, mobile, password_hash, is_member, email_verified_at, location)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN NOW() END, $7) RETURNING ${USER_COLUMNS}`,
          [fullName, email, mobile, passwordHash, becomeMember, emailVerified, location ?? null],
        );
        user = toUser(row);
      } catch (error) {
        if (error?.code === "23505") {
          throw ApiError.conflict("This account already exists.");
        }
        throw error;
      }
    }

    return {
      user: await this.withProfiles(user),
      accessToken: signAccessToken(user),
    };
  },

  /** Adds a category profile to an account that already exists (e.g. a member who now wants to list a temple). */
  async addProfile(userId, category, profile) {
    const repo = profileRepository(category);
    if (await repo.findOne("user_id = $1", [userId])) {
      throw ApiError.conflict("You have already registered in this category.");
    }
    return repo.create({ ...profile, userId, missingFields: missingFieldsFor(category, profile) });
  },

  async login({ email, password }) {
    const record = await UserModel.findByEmailWithPassword(email);

    // Hash a dummy value when the user is absent so the response time does not
    // reveal whether the email is registered.
    if (!record) {
      await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinva");
      throw ApiError.unauthorized();
    }

    const matches = await bcrypt.compare(password, record.passwordHash);
    if (!matches) {
      throw ApiError.unauthorized();
    }

    const { passwordHash: _ignored, ...user } = record;
    await UserModel.touchLastLogin(user.id);

    return {
      user: await this.withProfiles(user),
      accessToken: signAccessToken(user),
    };
  },

  /**
   * Always resolves quietly, whether or not the email is registered, so the
   * endpoint can't be used to discover which emails have accounts.
   */
  /**
   * Forgot password, step 1: emails a 6-digit code. Always looks the same from outside (no hint whether the
   * email has an account). One code every 45 seconds and five an hour per account; extra asks are quietly ignored.
   */
  async requestPasswordReset(email) {
    const answer = { resendAfterSeconds: RESET_RESEND_SECONDS };
    const user = await UserModel.findByEmail(email);
    if (!user || user.isBlocked) return answer;

    const [row] = await sql`
      SELECT send_count, EXTRACT(EPOCH FROM (NOW() - sent_at)) AS since_sent,
             (NOW() - window_started_at) < INTERVAL '1 hour' AS in_window
      FROM password_reset_codes WHERE user_id = ${user.id}`;
    if (row && Number(row.since_sent) < RESET_RESEND_SECONDS) return answer;
    if (row && row.in_window && row.send_count >= RESET_MAX_PER_HOUR) return answer;

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await sendPasswordResetCodeEmail({ to: user.email, fullName: user.fullName, code, minutes: RESET_CODE_MINUTES });
    } catch (error) {
      // Saying "could not send" would reveal that the account exists; the problem goes to the log instead.
      console.error("[mail] password reset code not sent:", error.message);
      return answer;
    }
    const keepWindow = Boolean(row && row.in_window);
    await sql`
      INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
      VALUES (${user.id}, ${resetCodeHash(user.id, code)}, NOW() + (${String(RESET_CODE_MINUTES)} || ' minutes')::interval)
      ON CONFLICT (user_id) DO UPDATE SET
        code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, sent_at = NOW(),
        send_count = CASE WHEN ${keepWindow}::boolean THEN password_reset_codes.send_count + 1 ELSE 1 END,
        window_started_at = CASE WHEN ${keepWindow}::boolean THEN password_reset_codes.window_started_at ELSE NOW() END`;
    return answer;
  },

  /**
   * Forgot password, step 2: checks the emailed code and hands back a one-time reset token for step 3.
   * Every failure says the same thing, so nothing reveals whether the email has an account.
   */
  async verifyPasswordResetCode({ email, code }) {
    const refused = ApiError.badRequest("That code is not right or has expired. Please check it, or ask for a new one.");
    const user = await UserModel.findByEmail(email);
    if (!user || user.isBlocked) throw refused;

    const [row] = await sql`SELECT code_hash, attempts, expires_at FROM password_reset_codes WHERE user_id = ${user.id}`;
    if (!row || new Date(row.expires_at) < new Date() || row.attempts >= RESET_MAX_ATTEMPTS) throw refused;

    const expected = Buffer.from(resetCodeHash(user.id, code), "hex");
    const actual = Buffer.from(row.code_hash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await sql`UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = ${user.id}`;
      throw refused;
    }

    const token = randomBytes(32).toString("hex");
    await sql`DELETE FROM password_reset_codes WHERE user_id = ${user.id}`;
    await sql`UPDATE password_resets SET used_at = NOW() WHERE user_id = ${user.id} AND used_at IS NULL`;
    await sql`
      INSERT INTO password_resets (user_id, token_hash, expires_at)
      VALUES (${user.id}, ${hashToken(token)}, NOW() + (${String(RESET_TOKEN_MINUTES)} || ' minutes')::interval)`;
    return { resetToken: token, minutes: RESET_TOKEN_MINUTES };
  },

  async resetPassword({ token, password }) {
    const [row] = await sql`
      SELECT id, user_id FROM password_resets
      WHERE token_hash = ${hashToken(token)} AND used_at IS NULL AND expires_at > NOW()
    `;
    if (!row) {
      throw ApiError.badRequest("This reset link is invalid or has expired. Please request a new one.");
    }

    // The current password cannot be "reset" to itself. The link stays usable so they can pick a different one.
    const [current] = await sql`SELECT password_hash FROM users WHERE id = ${row.user_id}`;
    if (current && (await bcrypt.compare(password, current.password_hash))) {
      throw ApiError.badRequest("Choose a password you have not used for this account.", [
        { field: "password", message: "This is your current password. Please choose a different one." },
      ]);
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
    await UserModel.setPassword(row.user_id, passwordHash);
    await sql`UPDATE password_resets SET used_at = NOW() WHERE user_id = ${row.user_id} AND used_at IS NULL`;
    // A new password ends every signed-in session of that account.
    await RefreshTokens.revokeAllForUser(row.user_id);

    // The owner is told, so a reset they did not ask for is noticed. A failed email must not undo the reset.
    const [owner] = await sql`SELECT email, full_name FROM users WHERE id = ${row.user_id}`;
    if (owner) {
      sendSecurityNoticeEmail({ to: owner.email, fullName: owner.full_name, what: "password", detail: "it was reset from the forgot-password link" }).catch((error) =>
        console.error("[mail] security notice failed:", error.message),
      );
    }
  },

  async refresh(userId) {
    const user = await UserModel.findById(userId);
    if (!user || user.isBlocked) {
      throw ApiError.unauthorized("Session is no longer valid.");
    }

    return {
      user: await this.withProfiles(user),
      accessToken: signAccessToken(user),
    };
  },
};
