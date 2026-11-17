import dotenv from "dotenv";

dotenv.config();

/** Reads a required variable, failing fast at boot rather than at first use. */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See backend/.env.example.`,
    );
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 5000),

  databaseUrl: required("DATABASE_URL"),

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "1d",
    refreshTtl: process.env.JWT_REFRESH_TTL ?? "7d",
  },

  // Comma-separated list of allowed browser origins. Trailing slashes are
  // stripped defensively — a browser's `Origin` header never has one, so a
  // stored value like "https://x.vercel.app/" would otherwise never match
  // and silently fail CORS (the same class of bug a trailing slash caused
  // in the frontend's API_URL).
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),

  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),

  uploads: {
    maxMb: Number(process.env.MAX_UPLOAD_MB ?? 8),
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  // Where the admin panel lives; password reset emails link back to it.
  adminUrl: (process.env.ADMIN_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
  // The public website; emails link back to it.
  siteUrl: (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  // The old one-step signup skips the email code and the payment, so it stays off unless a test needs it.
  allowDirectSignup: process.env.ALLOW_DIRECT_SIGNUP === "true",
  passwordResetTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30),

  // Optional. Without SMTP_HOST, reset links are printed to the server log
  // instead of emailed (fine for local development).
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? "Shyam Jagat <no-reply@shyamjagat.com>",
  },

  // Text messages. Empty until an SMS provider is chosen; signup then offers email only.
  sms: {
    provider: process.env.SMS_PROVIDER,
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    apiBase: process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com/v1",
  },
};

export const isProduction = env.nodeEnv === "production";
