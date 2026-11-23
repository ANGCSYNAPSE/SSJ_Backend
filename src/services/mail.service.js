import nodemailer from "nodemailer";
import { env, isProduction } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { contactMessageEmail, donationReceiptEmail, passwordResetCodeEmail, passwordResetEmail, paymentReceiptEmail, refundEmail, securityNoticeEmail, signupOtpEmail, volunteerWelcomeEmail, welcomeEmail } from "./mailTemplates.js";

/** Test mode only: every email "sent" during a test run. */
export const mailOutbox = [];

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
async function deliver({ to, subject, text, html, replyTo }, { log }) {
  // Under test, mail is collected here instead of sent, so tests can read the codes and nothing real is ever emailed.
  if (env.nodeEnv === "test") {
    mailOutbox.push({ to, subject, text, html, replyTo });
    return;
  }
  if (!transporter) {
    if (isProduction) throw ApiError.serviceUnavailable("Email is not available right now. Please try again later.");
    console.log(`[mail] SMTP not configured. To: ${to} | ${subject}\n${log ?? text}`);
    return;
  }
  try {
    await transporter.sendMail({ from: env.smtp.from, to, subject, text, html, ...(replyTo ? { replyTo } : {}) });
  } catch (error) {
    // The provider's message ("535 Authentication failed", ...) is for the server log, not for the person signing up.
    console.error(`[mail] could not send "${subject}" to ${to}: ${error.message}`);
    throw ApiError.serviceUnavailable("We could not send the email right now. Please try again in a few minutes.");
  }
}

export async function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  const mail = passwordResetEmail({ fullName, resetUrl, minutes: env.passwordResetTtlMinutes });
  await deliver({ to, ...mail }, { log: `Reset link: ${resetUrl}` });
}

export async function sendRefundEmail({ to, fullName, amount, refundId, paid, balance, manual }) {
  const mail = refundEmail({ fullName, amount, refundId, paid, balance, manual, siteUrl: env.siteUrl, supportEmail: env.supportEmail });
  await deliver({ to, ...mail }, {});
}

/** The website's contact form, emailed to the team's inbox. Replying answers the visitor directly. */
export async function sendContactMessageEmail({ name, email, phone, subject, message, receivedAt }) {
  const mail = contactMessageEmail({ name, email, phone, subject, message, receivedAt });
  await deliver({ to: env.contactInbox, replyTo: `"${String(name).replace(/["\r\n]/g, "")}" <${email}>`, ...mail }, {});
}

export async function sendPaymentReceiptEmail({ to, fullName, receiptNo, paidAt, amount, paymentRef, offline, note, total, paid, balance }) {
  const mail = paymentReceiptEmail({ fullName, email: to, receiptNo, paidAt, amount, paymentRef, offline, note, total, paid, balance, siteUrl: env.siteUrl, supportEmail: env.supportEmail });
  await deliver({ to, ...mail }, {});
}

export async function sendDonationReceiptEmail({ to, donorName, receiptNo, paidAt, amount, cause, paymentRef }) {
  const mail = donationReceiptEmail({ donorName, receiptNo, paidAt, amount, cause, paymentRef, siteUrl: env.siteUrl, supportEmail: env.supportEmail });
  await deliver({ to, ...mail }, {});
}

export async function sendPasswordResetCodeEmail({ to, fullName, code, minutes }) {
  const mail = passwordResetCodeEmail({ fullName, code, minutes });
  await deliver({ to, ...mail }, { log: `Password reset code: ${code}` });
}

export async function sendSignupOtpEmail({ to, fullName, code, minutes }) {
  const mail = signupOtpEmail({ fullName, code, minutes });
  await deliver({ to, ...mail }, { log: `Verification code: ${code}` });
}

export async function sendWelcomeEmail({ to, fullName, paid, balance, receipt }) {
  const mail = welcomeEmail({ fullName, paid, balance, receipt, siteUrl: env.siteUrl });
  await deliver({ to, ...mail }, {});
}

export async function sendVolunteerWelcomeEmail({ to, fullName }) {
  const mail = volunteerWelcomeEmail({ fullName, siteUrl: env.siteUrl });
  await deliver({ to, ...mail }, {});
}

/** A heads-up to the account's email that its email or password changed. Failure to send never blocks the change. */
export async function sendSecurityNoticeEmail({ to, fullName, what, detail }) {
  const mail = securityNoticeEmail({ fullName, what, detail });
  await deliver({ to, ...mail }, {});
}
