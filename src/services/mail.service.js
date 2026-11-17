import nodemailer from "nodemailer";
import { env, isProduction } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { passwordResetEmail, signupOtpEmail, welcomeEmail } from "./mailTemplates.js";

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

/**
 * Sends one email. Without SMTP configured, local development prints the message to the server
 * log (so a code or link can be copied from there); production refuses, because a person waiting
 * for a code that never arrives is worse than an honest error.
 */
async function deliver({ to, subject, text, html }, { log }) {
  if (!transporter) {
    if (isProduction) throw ApiError.serviceUnavailable("Email is not available right now. Please try again later.");
    console.log(`[mail] SMTP not configured. To: ${to} | ${subject}\n${log ?? text}`);
    return;
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, text, html });
}

export async function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  const mail = passwordResetEmail({ fullName, resetUrl, minutes: env.passwordResetTtlMinutes });
  await deliver({ to, ...mail }, { log: `Reset link: ${resetUrl}` });
}

export async function sendSignupOtpEmail({ to, fullName, code, minutes }) {
  const mail = signupOtpEmail({ fullName, code, minutes });
  await deliver({ to, ...mail }, { log: `Verification code: ${code}` });
}

export async function sendWelcomeEmail({ to, fullName, paid, balance, receipt }) {
  const mail = welcomeEmail({ fullName, paid, balance, receipt, siteUrl: env.siteUrl });
  await deliver({ to, ...mail }, {});
}
