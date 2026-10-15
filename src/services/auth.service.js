import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "../config/database.js";
import { sendPasswordResetEmail } from "./mail.service.js";
import { env } from "../config/env.js";
import { UserModel } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken, signRefreshToken } from "../utils/tokens.js";

/**
 * Business logic for authentication. Controllers stay thin: they parse input
 * and shape responses, everything below is the actual rule set.
 */
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

export const AuthService = {
  async signup({ fullName, email, mobile, password }) {
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
    const user = await UserModel.create({
      fullName,
      email,
      mobile,
      passwordHash,
    });

    return {
      user,
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
    };
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
      user,
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

  async refresh(userId) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ApiError.unauthorized("Session is no longer valid.");
    }

    return {
      user,
      accessToken: signAccessToken(user),
      refreshToken: signRefreshToken(user),
    };
  },
};
