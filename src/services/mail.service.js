import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export async function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  if (!transporter) {
    console.log(`[mail] SMTP not configured — password reset link for ${to}: ${resetUrl}`);
    return;
  }

  await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject: "Reset your Shyam Jagat admin password",
    text: `Hi ${fullName},\n\nUse the link below to set a new password. It expires in ${env.passwordResetTtlMinutes} minutes.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Hi ${fullName},</p><p>Use the link below to set a new password. It expires in ${env.passwordResetTtlMinutes} minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });
}
