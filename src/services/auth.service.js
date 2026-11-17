import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "../config/database.js";
import { sendPasswordResetEmail } from "./mail.service.js";
import { env } from "../config/env.js";
import { UserModel, toUser } from "../models/user.model.js";
import { listProfilesForUser, missingFieldsFor, profileRepository } from "../models/profile.model.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken, signRefreshToken } from "../utils/tokens.js";

/**
 * Business logic for authentication. Controllers stay thin: they parse input
 * and shape responses, everything below is the actual rule set.
 */
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

const USER_COLUMNS =
  "id, full_name, email, mobile, role, is_verified, is_blocked, is_member, location, avatar_url, created_at";

export const AuthService = {
  /** Adds the categories (artist, temple, ...) the user has registered for. */
  async withProfiles(user) {
    if (!user) return user;
    return { ...user, profiles: await listProfilesForUser(user.id) };
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
            `INSERT INTO users (id, full_name, email, mobile, password_hash, is_member)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLUMNS}`,
            [userId, fullName, email, mobile, passwordHash, becomeMember],
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
      user = await UserModel.create({ fullName, email, mobile, passwordHash, isMember: becomeMember });
    }

    return {
      user: await this.withProfiles(user),
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
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
      refreshToken: signRefreshToken(user),
    };
  },

  /**
   * Always resolves quietly, whether or not the email is registered, so the
   * endpoint can't be used to discover which emails have accounts.
   */
  async requestPasswordReset(email) {
    const user = await UserModel.findByEmail(email);
    if (!user || user.isBlocked) return;

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + env.passwordResetTtlMinutes * 60_000);

    // Only the newest link should work.
    await sql`UPDATE password_resets SET used_at = NOW() WHERE user_id = ${user.id} AND used_at IS NULL`;
    await sql`
      INSERT INTO password_resets (user_id, token_hash, expires_at)
      VALUES (${user.id}, ${hashToken(token)}, ${expiresAt.toISOString()})
    `;

    await sendPasswordResetEmail({
      to: user.email,
      fullName: user.fullName,
      resetUrl: `${env.adminUrl}/reset-password?token=${token}`,
    });
  },

  async resetPassword({ token, password }) {
    const [row] = await sql`
      SELECT id, user_id FROM password_resets
      WHERE token_hash = ${hashToken(token)} AND used_at IS NULL AND expires_at > NOW()
    `;
    if (!row) {
      throw ApiError.badRequest("This reset link is invalid or has expired. Please request a new one.");
    }

    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
    await UserModel.setPassword(row.user_id, passwordHash);
    await sql`UPDATE password_resets SET used_at = NOW() WHERE user_id = ${row.user_id} AND used_at IS NULL`;
  },

  async refresh(userId, { remember = true } = {}) {
    const user = await UserModel.findById(userId);
    if (!user || user.isBlocked) {
      throw ApiError.unauthorized("Session is no longer valid.");
    }

    return {
      user: await this.withProfiles(user),
      accessToken: signAccessToken(user),
      // A new refresh token each time: the session slides, so someone who keeps using the site stays signed in.
      refreshToken: signRefreshToken(user, { remember }),
    };
  },
};
