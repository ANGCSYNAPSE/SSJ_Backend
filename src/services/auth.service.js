import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { UserModel } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken, signRefreshToken } from "../utils/tokens.js";

/**
 * Business logic for authentication. Controllers stay thin: they parse input
 * and shape responses, everything below is the actual rule set.
 */
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
