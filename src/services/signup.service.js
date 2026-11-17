import bcrypt from "bcryptjs";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { UserModel } from "../models/user.model.js";
import { RegistrationPaymentModel } from "../models/registrationPayment.model.js";
import { PAYMENT_APP, PAYMENT_PURPOSE, REGISTRATION_FEE, allowedPayment, feeState } from "../config/plans.js";
import { AuthService } from "./auth.service.js";
import { sendSignupOtpEmail, sendWelcomeEmail } from "./mail.service.js";
import { sendSms, signupOtpText, smsConfigured } from "./sms.service.js";
import { PROFILE_SCHEMAS } from "../validators/profiles.validator.js";
import { createRazorpayOrder, verifyPaymentSignature } from "./razorpay.service.js";

/**
 * Signup in four steps: the person's details are saved as a *pending* signup, an email code proves
 * the address, a payment of at least the minimum is made, and only then is the account created and
 * signed in. Nothing that looks like an account exists before that.
 */
export const OTP_MINUTES = 10;
export const RESEND_AFTER_SECONDS = 45;
const MAX_RESENDS = 5;
const MAX_OTP_ATTEMPTS = 5;

const hashCode = (pendingId, code) => createHmac("sha256", env.jwt.refreshSecret).update(`${pendingId}:${code}`).digest("hex");

const sameHash = (a, b) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

const maskEmail = (email) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

async function loadPending(id) {
  const [row] = await sql(`SELECT * FROM pending_signups WHERE id = $1`, [id]);
  if (!row) throw ApiError.notFound("This registration was not found. Please start again.");
  if (row.completed_user_id) throw ApiError.conflict("This account has already been created. Please sign in.");
  if (new Date(row.expires_at) < new Date()) throw ApiError.badRequest("This registration has expired. Please start again.");
  return row;
}

/** What has been paid so far on a pending signup, and what may be paid next. */
async function feeOf(pendingId) {
  const [row] = await sql(
    `SELECT COALESCE(SUM(amount_in_rupees), 0)::float AS paid FROM registration_payments
     WHERE pending_signup_id = $1 AND status = 'paid'`,
    [pendingId],
  );
  const paid = row.paid;
  const next = allowedPayment(paid);
  return {
    status: feeState(paid),
    total: REGISTRATION_FEE.total,
    minimum: REGISTRATION_FEE.minimum,
    paid,
    balance: next.balance,
    nextMin: next.min,
    nextMax: next.max,
    /** The account can be created once at least the minimum is paid. */
    canComplete: paid >= REGISTRATION_FEE.minimum,
  };
}

/**
 * Makes a new code and delivers the same code by the chosen channel: "email", "sms" or "both".
 * Whichever the person uses, the latest code is the one that works.
 */
async function sendNewCode(pending, channel = "email") {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const wantsEmail = channel === "email" || channel === "both";
  const wantsSms = channel === "sms" || channel === "both";

  if (wantsSms && !smsConfigured && !wantsEmail) {
    throw ApiError.serviceUnavailable("SMS is not available yet. Please use email.");
  }
  if (wantsEmail) {
    await sendSignupOtpEmail({ to: pending.email, fullName: pending.full_name, code, minutes: OTP_MINUTES });
  }
  if (wantsSms && smsConfigured) {
    try {
      await sendSms({ to: pending.mobile, text: signupOtpText(code, OTP_MINUTES) });
    } catch (error) {
      // With "both", a failed text must not block the email that already went out.
      if (!wantsEmail) throw error;
      console.error("[sms] could not send the signup code:", error.message);
    }
  }
  await sql(
    `UPDATE pending_signups
     SET otp_hash = $2, otp_expires_at = NOW() + ($3 || ' minutes')::interval, otp_attempts = 0, otp_sent_at = NOW()
     WHERE id = $1`,
    [pending.id, hashCode(pending.id, code), String(OTP_MINUTES)],
  );
  return { email: wantsEmail, sms: wantsSms && smsConfigured };
}

const maskMobile = (mobile) => `${"*".repeat(Math.max(0, mobile.length - 4))}${mobile.slice(-4)}`;

const summary = (pending, fee) => ({
  pendingId: pending.id,
  email: maskEmail(pending.email),
  mobile: maskMobile(pending.mobile),
  category: pending.category ?? null,
  /** Which ways a code can be sent. SMS turns on when a provider is connected. */
  channels: { email: true, sms: smsConfigured },
  emailVerified: Boolean(pending.email_verified_at),
  otpMinutes: OTP_MINUTES,
  resendAfterSeconds: RESEND_AFTER_SECONDS,
  fee,
});

export const SignupService = {
  /**
   * Saves the details and emails the first code. Run again with the same email (the person came
   * back), it refreshes the same pending signup, so a payment already made is not lost.
   */
  async start({ fullName, email, mobile, password, becomeMember = false, category, profile }, channel = "email") {
    const [byEmail, byMobile] = await Promise.all([UserModel.findByEmail(email), UserModel.findByMobile(mobile)]);
    const conflicts = [];
    if (byEmail) conflicts.push({ field: "email", message: "An account with this email already exists." });
    if (byMobile) conflicts.push({ field: "mobile", message: "An account with this mobile number already exists." });
    if (conflicts.length > 0) throw ApiError.conflict("This account already exists.", conflicts);

    const [existing] = await sql(
      `SELECT * FROM pending_signups WHERE lower(email) = lower($1) AND completed_user_id IS NULL ORDER BY created_at DESC LIMIT 1`,
      [email],
    );

    let pending;
    if (existing) {
      const { paid } = await feeOf(existing.id);
      if (paid > 0 && !(await bcrypt.compare(password, existing.password_hash))) {
        throw ApiError.conflict("A registration with this email is already in progress. Use the password you chose before.", [
          { field: "password", message: "Use the password you chose earlier for this registration." },
        ]);
      }
      const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
      [pending] = await sql(
        `UPDATE pending_signups
         SET full_name = $2, mobile = $3, password_hash = $4, become_member = $5, category = $6, profile = $7::jsonb,
             email_verified_at = NULL, otp_hash = NULL, otp_attempts = 0, resend_count = 0,
             expires_at = NOW() + INTERVAL '7 days'
         WHERE id = $1 RETURNING *`,
        [existing.id, fullName, mobile, passwordHash, becomeMember, category ?? null, profile ? JSON.stringify(profile) : null],
      );
    } else {
      const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
      [pending] = await sql(
        `INSERT INTO pending_signups (full_name, email, mobile, password_hash, become_member, category, profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
        [fullName, email, mobile, passwordHash, becomeMember, category ?? null, profile ? JSON.stringify(profile) : null],
      );
    }

    const sent = await sendNewCode(pending, channel);
    return { ...summary(pending, await feeOf(pending.id)), sentBy: sent };
  },

  async resend(pendingId, channel = "email") {
    const pending = await loadPending(pendingId);
    if (pending.email_verified_at) throw ApiError.conflict("Your email is already verified.");
    if (pending.resend_count >= MAX_RESENDS) {
      throw ApiError.tooManyRequests("Too many codes requested. Please start the registration again.");
    }
    const waited = pending.otp_sent_at ? (Date.now() - new Date(pending.otp_sent_at).getTime()) / 1000 : Infinity;
    if (waited < RESEND_AFTER_SECONDS) {
      throw ApiError.tooManyRequests(`Please wait ${Math.ceil(RESEND_AFTER_SECONDS - waited)} seconds before asking for another code.`);
    }
    await sql(`UPDATE pending_signups SET resend_count = resend_count + 1 WHERE id = $1`, [pending.id]);
    const sent = await sendNewCode(pending, channel);
    return { sent: true, sentBy: sent, resendAfterSeconds: RESEND_AFTER_SECONDS };
  },

  async verifyOtp(pendingId, code) {
    const pending = await loadPending(pendingId);
    if (pending.email_verified_at) return summary(pending, await feeOf(pending.id));
    if (!pending.otp_hash || !pending.otp_expires_at || new Date(pending.otp_expires_at) < new Date()) {
      throw ApiError.badRequest("This code has expired. Please ask for a new one.");
    }
    if (pending.otp_attempts >= MAX_OTP_ATTEMPTS) {
      throw ApiError.tooManyRequests("Too many wrong codes. Please ask for a new one.");
    }
    if (!sameHash(hashCode(pending.id, code), pending.otp_hash)) {
      await sql(`UPDATE pending_signups SET otp_attempts = otp_attempts + 1 WHERE id = $1`, [pending.id]);
      const left = MAX_OTP_ATTEMPTS - pending.otp_attempts - 1;
      throw ApiError.badRequest(left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code is not right. Please ask for a new one.");
    }
    const [verified] = await sql(
      `UPDATE pending_signups SET email_verified_at = NOW(), otp_hash = NULL, otp_expires_at = NULL WHERE id = $1 RETURNING *`,
      [pending.id],
    );
    return summary(verified, await feeOf(pending.id));
  },

  /**
   * Saves the registration details (the artist, temple, ... form) on a verified signup, ready for the
   * payment step. The same rules as a real registration apply, so mistakes are reported per field.
   */
  async setProfile(pendingId, profile) {
    const pending = await loadPending(pendingId);
    if (!pending.email_verified_at) throw ApiError.badRequest("Please verify your email first.");
    if (!pending.category) throw ApiError.badRequest("This registration has no category.");
    const parsed = PROFILE_SCHEMAS[pending.category].safeParse(profile ?? {});
    if (!parsed.success) {
      throw ApiError.badRequest(
        "Validation failed.",
        parsed.error.issues.map((issue) => ({ field: ["profile", ...issue.path].join("."), message: issue.message })),
      );
    }
    const [saved] = await sql(`UPDATE pending_signups SET profile = $2::jsonb WHERE id = $1 RETURNING *`, [
      pending.id,
      JSON.stringify(parsed.data),
    ]);
    return summary(saved, await feeOf(pending.id));
  },

  /** A Razorpay order for a verified signup, for an amount the fee rules allow. */
  async createPaymentOrder(pendingId, amount) {
    const pending = await loadPending(pendingId);
    if (!pending.email_verified_at) throw ApiError.badRequest("Please verify your email first.");

    const fee = await feeOf(pending.id);
    if (fee.balance <= 0) throw ApiError.conflict("The registration fee is already paid in full.");
    if (amount > fee.nextMax) throw ApiError.badRequest(`Only ₹${fee.nextMax} is due.`);
    if (amount < fee.nextMin) {
      throw ApiError.badRequest(
        fee.nextMin === fee.balance ? `Please pay the remaining ₹${fee.balance}.` : `The minimum payment is ₹${fee.nextMin}.`,
      );
    }
    const kind = amount === fee.balance ? "full" : "part";
    const receipt = `SJ-REG-P${pending.id.slice(0, 7)}-${Date.now()}`;
    const order = await createRazorpayOrder({
      amountInPaise: amount * 100,
      receipt,
      notes: { app: PAYMENT_APP, purpose: PAYMENT_PURPOSE, pending_signup_id: pending.id, kind, name: pending.full_name },
    });
    await RegistrationPaymentModel.create({
      pendingSignupId: pending.id,
      plan: kind,
      amountInRupees: amount,
      status: "created",
      receipt,
      razorpayOrderId: order.id,
      source: "razorpay",
    });
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: env.razorpay.keyId,
      kind,
      label: kind === "full" ? "Registration fee" : "Registration fee (part payment)",
      prefill: { name: pending.full_name, email: pending.email, contact: pending.mobile },
    };
  },

  /** Checks the payment Razorpay reports, then creates the account and signs the person in. */
  async verifyPayment(pendingId, { orderId, paymentId, signature }) {
    const pending = await loadPending(pendingId);
    const row = await RegistrationPaymentModel.findByOrderId(orderId);
    if (!row || row.pendingSignupId !== pending.id) throw ApiError.notFound("Payment not found.");
    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
      await RegistrationPaymentModel.markFailed(orderId, paymentId, "Signature mismatch");
      throw ApiError.badRequest("Payment could not be verified.");
    }
    await RegistrationPaymentModel.markPaid(orderId, paymentId);
    return this.complete(pendingId);
  },

  /**
   * Creates the account once the email is verified and at least the minimum is paid. Also what a
   * returning person (who paid, then lost the page) reaches after verifying their email again.
   */
  async complete(pendingId) {
    const pending = await loadPending(pendingId);
    if (!pending.email_verified_at) throw ApiError.badRequest("Please verify your email first.");
    const fee = await feeOf(pending.id);
    if (!fee.canComplete) throw ApiError.badRequest(`Please pay at least ₹${REGISTRATION_FEE.minimum} to finish.`);

    const result = await AuthService.createAccount({
      fullName: pending.full_name,
      email: pending.email,
      mobile: pending.mobile,
      passwordHash: pending.password_hash,
      becomeMember: pending.become_member,
      category: pending.category ?? undefined,
      profile: pending.profile ?? undefined,
      emailVerified: true,
    });

    // The payments made so far now belong to the new account.
    await sql(`UPDATE registration_payments SET user_id = $2 WHERE pending_signup_id = $1`, [pending.id, result.user.id]);
    await sql(`UPDATE pending_signups SET completed_user_id = $2, password_hash = 'completed', profile = NULL WHERE id = $1`, [
      pending.id,
      result.user.id,
    ]);

    const user = await AuthService.withProfiles(await UserModel.findById(result.user.id));
    const { receipt } = await RegistrationPaymentModel.paidSummary(user.id);
    // A failed email must not undo a paid, created account.
    sendWelcomeEmail({ to: user.email, fullName: user.fullName, paid: fee.paid, balance: fee.balance, receipt }).catch((error) =>
      console.error("[mail] welcome email failed:", error.message),
    );

    return { ...result, user };
  },
};
