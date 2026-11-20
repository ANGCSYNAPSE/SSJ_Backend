import bcrypt from "bcryptjs";
import { z } from "zod";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "../config/database.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { UserModel } from "../models/user.model.js";
import { RegistrationPaymentModel } from "../models/registrationPayment.model.js";
import { NotificationModel } from "../models/notification.model.js";
import { PAYMENT_APP, PAYMENT_PURPOSE, allowedPayment, feeState, getRegistrationFee } from "../config/plans.js";
import { PROFILE_SCHEMAS } from "../validators/profiles.validator.js";
import { AuthService } from "./auth.service.js";
import { sendSignupOtpEmail, sendWelcomeEmail } from "./mail.service.js";
import { sendSms, signupOtpText, smsConfigured } from "./sms.service.js";
import { confirmPayment, createRazorpayOrder, verifyPaymentSignature } from "./razorpay.service.js";

/**
 * Signup is: details (step 1) -> email code -> the rest of the details (step 2) -> payment of at least
 * the minimum -> account. Until the payment succeeds the person is only a *pending signup*: no account,
 * no sign-in. Coming back later (signing in with the same email and password) resumes at the step they
 * had reached.
 */
export const OTP_MINUTES = 10;
export const RESEND_AFTER_SECONDS = 45;
const MAX_RESENDS = 5;
const MAX_OTP_ATTEMPTS = 5;
/** A pending signup is kept this long after its last activity. */
const PENDING_DAYS = 7;

/** A plain member has no category form: their details are just where they live. */
const MEMBER_DETAILS = z.object({
  city: z.string().trim().min(1, "Please enter your city.").max(80),
  state: z.string().trim().min(1, "Please choose your state.").max(80),
});

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
const maskMobile = (mobile) => `${"*".repeat(Math.max(0, mobile.length - 4))}${mobile.slice(-4)}`;

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
  const rules = await getRegistrationFee();
  const next = allowedPayment(paid, rules);
  return {
    status: feeState(paid, rules),
    total: rules.total,
    minimum: rules.minimum,
    paid,
    balance: next.balance,
    nextMin: next.min,
    nextMax: next.max,
    /** The account can be created once at least the minimum is paid. */
    canComplete: paid >= rules.minimum,
  };
}

/**
 * Where a pending signup stands, which is the screen to show:
 * otp (verify the email) -> details (step 2) -> pay -> complete (paid; create the account).
 */
function stageOf(pending, fee) {
  if (!pending.email_verified_at) return "otp";
  if (!pending.details_saved_at) return "details";
  return fee.canComplete ? "complete" : "pay";
}

const summary = (pending, fee) => ({
  pendingId: pending.id,
  email: maskEmail(pending.email),
  mobile: maskMobile(pending.mobile),
  category: pending.category ?? null,
  /** Which ways a code can be sent. SMS turns on when a provider is connected. */
  channels: { email: true, sms: smsConfigured },
  emailVerified: Boolean(pending.email_verified_at),
  stage: stageOf(pending, fee),
  otpMinutes: OTP_MINUTES,
  resendAfterSeconds: RESEND_AFTER_SECONDS,
  fee,
});

/** True when a code was sent and can still be used, so there is no need to send another. */
async function hasActiveCode(pendingId) {
  const [row] = await sql(`SELECT 1 FROM otp_codes WHERE pending_signup_id = $1 AND expires_at > NOW() AND attempts < $2 LIMIT 1`, [
    pendingId,
    MAX_OTP_ATTEMPTS,
  ]);
  return Boolean(row);
}

/**
 * Makes a new code, delivers the same code by the chosen channel ("email", "sms" or "both") and stores it
 * (hashed) in otp_codes, replacing any earlier one. Nothing is stored if delivery fails.
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
  await sql(`DELETE FROM otp_codes WHERE pending_signup_id = $1`, [pending.id]);
  await sql(
    `INSERT INTO otp_codes (pending_signup_id, channel, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)`,
    [pending.id, channel, hashCode(pending.id, code), String(OTP_MINUTES)],
  );
  await sql(`UPDATE pending_signups SET otp_sent_at = NOW() WHERE id = $1`, [pending.id]);
  // Expired codes of other people are of no use to anyone.
  await sql(`DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 day'`);
  return { email: wantsEmail, sms: wantsSms && smsConfigured };
}

const keepAlive = (id) => sql(`UPDATE pending_signups SET expires_at = NOW() + ($2 || ' days')::interval WHERE id = $1`, [id, String(PENDING_DAYS)]);

export const SignupService = {
  /**
   * Step 1. Checks the details first (an email or mobile that already has an account is refused here,
   * before anything is sent), then saves them as a pending signup and sends a code only if one is needed:
   * never for an account that exists, never when a usable code is already out, never when the email is
   * already verified. Run again by someone who came back, it continues the same pending signup.
   */
  async start({ fullName, email, mobile, password, becomeMember = false, category, profile }, channel = "email") {
    const [byEmail, byMobile] = await Promise.all([UserModel.findByEmail(email), UserModel.findByMobile(mobile)]);
    const conflicts = [];
    if (byEmail) conflicts.push({ field: "email", message: "An account with this email already exists. Please sign in." });
    if (byMobile) conflicts.push({ field: "mobile", message: "An account with this mobile number already exists. Please sign in." });
    if (conflicts.length > 0) throw ApiError.conflict("This account already exists.", conflicts);

    const [existing] = await sql(
      `SELECT * FROM pending_signups WHERE lower(email) = lower($1) AND completed_user_id IS NULL ORDER BY created_at DESC LIMIT 1`,
      [email],
    );

    // Someone else's pending signup may already hold this mobile number.
    const [mobileHolder] = await sql(
      `SELECT id FROM pending_signups WHERE mobile = $1 AND completed_user_id IS NULL AND lower(email) <> lower($2) AND expires_at > NOW() LIMIT 1`,
      [mobile, email],
    );
    if (mobileHolder) {
      throw ApiError.conflict("This mobile number is being used for another registration.", [
        { field: "mobile", message: "This mobile number is being used for another registration." },
      ]);
    }

    let pending;
    if (existing) {
      const samePassword = await bcrypt.compare(password, existing.password_hash);
      if (!samePassword && (existing.email_verified_at || existing.details_saved_at)) {
        // Verified already (or further): only the person who chose the password may continue.
        throw ApiError.conflict("A registration with this email is already in progress. Use the password you chose before, or sign in.", [
          { field: "password", message: "Use the password you chose earlier for this registration." },
        ]);
      }
      const passwordHash = samePassword ? existing.password_hash : await bcrypt.hash(password, env.bcryptRounds);
      // A different category means a different form, so the details saved so far no longer apply.
      const categoryChanged = (existing.category ?? null) !== (category ?? null);
      [pending] = await sql(
        `UPDATE pending_signups
         SET full_name = $2, mobile = $3, password_hash = $4, become_member = $5, category = $6,
             profile = CASE WHEN $8 THEN $7::jsonb ELSE profile END,
             details_saved_at = CASE WHEN $8 THEN NULL ELSE details_saved_at END,
             expires_at = NOW() + ($9 || ' days')::interval
         WHERE id = $1 RETURNING *`,
        [existing.id, fullName, mobile, passwordHash, becomeMember, category ?? null, profile ? JSON.stringify(profile) : null, categoryChanged, String(PENDING_DAYS)],
      );
    } else {
      const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
      [pending] = await sql(
        `INSERT INTO pending_signups (full_name, email, mobile, password_hash, become_member, category, profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING *`,
        [fullName, email, mobile, passwordHash, becomeMember, category ?? null, profile ? JSON.stringify(profile) : null],
      );
    }

    let sentBy = { email: false, sms: false };
    if (!pending.email_verified_at && !(await hasActiveCode(pending.id))) {
      sentBy = await sendNewCode(pending, channel);
    }
    return { ...summary(pending, await feeOf(pending.id)), sentBy };
  },

  /**
   * Someone signs in with an email and password that belong to an unfinished signup (not an account).
   * Returns where to resume, with their saved details, or null when this is not such a signup.
   * A new code is sent only if they still have to verify and no usable code is out.
   */
  async resumeFromLogin({ email, password }) {
    const [pending] = await sql(
      `SELECT * FROM pending_signups WHERE lower(email) = lower($1) AND completed_user_id IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    if (!pending || !(await bcrypt.compare(password, pending.password_hash))) return null;

    await keepAlive(pending.id);
    let sentBy = { email: false, sms: false };
    if (!pending.email_verified_at && !(await hasActiveCode(pending.id))) {
      sentBy = await sendNewCode(pending, "email");
    }
    return { ...(await this.describe(pending)), sentBy };
  },

  /**
   * Google proved this email, so an unfinished signup with it can carry on without the password it was started
   * with. Returns where to resume, or null when there is no such signup.
   */
  async resumeFromGoogle(profile) {
    const [pending] = await sql(
      `SELECT * FROM pending_signups WHERE lower(email) = lower($1) AND completed_user_id IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [profile.email],
    );
    if (!pending) return null;
    const [verified] = await sql(
      `UPDATE pending_signups SET email_verified_at = COALESCE(email_verified_at, NOW()), google_sub = COALESCE(google_sub, $2) WHERE id = $1 RETURNING *`,
      [pending.id, profile.sub],
    );
    await keepAlive(verified.id);
    return { ...(await this.describe(verified)), sentBy: { email: false, sms: false } };
  },

  /**
   * Begins a registration for someone who signed in with Google. Google has proved the email, so there is no
   * password and no emailed code: it starts at the details step. They can set a password later from "Forgot
   * password". The account itself is still only created after the minimum fee is paid.
   */
  async startWithGoogle({ profile, mobile }) {
    const email = profile.email;
    const [byEmail, byMobile] = await Promise.all([UserModel.findByEmail(email), UserModel.findByMobile(mobile)]);
    const conflicts = [];
    if (byEmail) conflicts.push({ field: "email", message: "An account with this email already exists. Please sign in with Google." });
    if (byMobile) conflicts.push({ field: "mobile", message: "An account with this mobile number already exists. Please sign in." });
    if (conflicts.length > 0) throw ApiError.conflict("This account already exists.", conflicts);

    const [mobileHolder] = await sql(
      `SELECT id FROM pending_signups WHERE mobile = $1 AND completed_user_id IS NULL AND lower(email) <> lower($2) AND expires_at > NOW() LIMIT 1`,
      [mobile, email],
    );
    if (mobileHolder) {
      throw ApiError.conflict("This mobile number is being used for another registration.", [
        { field: "mobile", message: "This mobile number is being used for another registration." },
      ]);
    }

    const [existing] = await sql(
      `SELECT id FROM pending_signups WHERE lower(email) = lower($1) AND completed_user_id IS NULL ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    let pending;
    if (existing) {
      [pending] = await sql(
        `UPDATE pending_signups
         SET mobile = $2, email_verified_at = COALESCE(email_verified_at, NOW()), google_sub = $3,
             expires_at = NOW() + ($4 || ' days')::interval
         WHERE id = $1 RETURNING *`,
        [existing.id, mobile, profile.sub, String(PENDING_DAYS)],
      );
    } else {
      // No password was chosen: the stored one is random and nobody knows it.
      const unusablePassword = await bcrypt.hash(randomBytes(32).toString("hex"), env.bcryptRounds);
      const fullName = profile.name.length >= 2 ? profile.name : email.split("@")[0].padEnd(2, "x");
      [pending] = await sql(
        `INSERT INTO pending_signups (full_name, email, mobile, password_hash, become_member, email_verified_at, google_sub)
         VALUES ($1, $2, $3, $4, FALSE, NOW(), $5) RETURNING *`,
        [fullName, email, mobile, unusablePassword, profile.sub],
      );
    }
    return { ...(await this.describe(pending)), sentBy: { email: false, sms: false } };
  },

  /** The saved details of a pending signup, for the screens that carry on from where the person stopped. */
  async describe(pending) {
    const fee = await feeOf(pending.id);
    return {
      ...summary(pending, fee),
      account: { fullName: pending.full_name, email: pending.email, mobile: pending.mobile },
      becomeMember: pending.become_member,
      details: pending.profile ?? null,
    };
  },

  /** Refreshes the state of a pending signup (a page reload, or coming back from the login screen). */
  async resume(pendingId) {
    const pending = await loadPending(pendingId);
    await keepAlive(pending.id);
    return this.describe(pending);
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
    const sent = await sendNewCode(pending, channel);
    await sql(`UPDATE pending_signups SET resend_count = resend_count + 1 WHERE id = $1`, [pending.id]);
    return { sent: true, sentBy: sent, resendAfterSeconds: RESEND_AFTER_SECONDS };
  },

  /**
   * Checks the code. On success the verification is recorded on the pending signup and the code row is
   * deleted, so a used code can never be used again.
   */
  async verifyOtp(pendingId, code) {
    const pending = await loadPending(pendingId);
    if (pending.email_verified_at) return summary(pending, await feeOf(pending.id));

    const [otp] = await sql(`SELECT * FROM otp_codes WHERE pending_signup_id = $1 ORDER BY created_at DESC LIMIT 1`, [pending.id]);
    if (!otp || new Date(otp.expires_at) < new Date()) {
      throw ApiError.badRequest("This code has expired. Please ask for a new one.");
    }
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw ApiError.tooManyRequests("Too many wrong codes. Please ask for a new one.");
    }
    if (!sameHash(hashCode(pending.id, code), otp.code_hash)) {
      await sql(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
      const left = MAX_OTP_ATTEMPTS - otp.attempts - 1;
      throw ApiError.badRequest(
        left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code is not right. Please ask for a new one.",
      );
    }
    await sql(`DELETE FROM otp_codes WHERE pending_signup_id = $1`, [pending.id]);
    const [verified] = await sql(`UPDATE pending_signups SET email_verified_at = NOW() WHERE id = $1 RETURNING *`, [pending.id]);
    await keepAlive(pending.id);
    return summary(verified, await feeOf(pending.id));
  },

  /**
   * Step 2: saves the rest of the details (the artist, temple, ... form, or a member's city and state) on
   * a verified signup. The same rules as a real registration apply, so mistakes are reported per field.
   */
  async setProfile(pendingId, profile) {
    const pending = await loadPending(pendingId);
    if (!pending.email_verified_at) throw ApiError.badRequest("Please verify your email first.");
    const schema = pending.category ? PROFILE_SCHEMAS[pending.category] : MEMBER_DETAILS;
    const parsed = schema.safeParse(profile ?? {});
    if (!parsed.success) {
      throw ApiError.badRequest(
        "Validation failed.",
        parsed.error.issues.map((issue) => ({ field: ["profile", ...issue.path].join("."), message: issue.message })),
      );
    }
    const [saved] = await sql(`UPDATE pending_signups SET profile = $2::jsonb, details_saved_at = NOW() WHERE id = $1 RETURNING *`, [
      pending.id,
      JSON.stringify(parsed.data),
    ]);
    return summary(saved, await feeOf(pending.id));
  },

  /** A Razorpay order for a signup that has verified its email and finished its details. */
  async createPaymentOrder(pendingId, amount) {
    const pending = await loadPending(pendingId);
    if (!pending.email_verified_at) throw ApiError.badRequest("Please verify your email first.");
    if (!pending.details_saved_at) throw ApiError.badRequest("Please finish your details first.");

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

  /** Checks the payment Razorpay reports, then creates the account (the caller signs the person in). */
  async verifyPayment(pendingId, { orderId, paymentId, signature }) {
    const pending = await loadPending(pendingId);
    const row = await RegistrationPaymentModel.findByOrderId(orderId);
    if (!row || row.pendingSignupId !== pending.id) throw ApiError.notFound("Payment not found.");
    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
      await RegistrationPaymentModel.markFailed(orderId, paymentId, "Signature mismatch");
      throw ApiError.badRequest("Payment could not be verified.");
    }
    // A valid signature is not proof of payment: ask Razorpay whether the money really moved.
    const check = await confirmPayment({ orderId, paymentId, amountInPaise: Math.round(Number(row.amountInRupees) * 100) });
    if (check.state === "mismatch") {
      await RegistrationPaymentModel.markFailed(orderId, paymentId, "Payment did not match the order");
      throw ApiError.badRequest("Payment could not be verified.");
    }
    if (check.state !== "captured") {
      // The account is created only for confirmed money. The webhook (or a reconcile) settles the payment, and
      // signing in with the same email and password then finishes the registration without paying again.
      throw ApiError.conflict(
        "Your payment is being confirmed by Razorpay. Please wait a minute, then sign in with your email and password to finish your registration. You will not be charged twice.",
      );
    }
    await RegistrationPaymentModel.markPaid(orderId, paymentId);
    return this.complete(pendingId);
  },

  /**
   * Creates the account once the email is verified, the details are saved and at least the minimum is
   * paid. Also what a returning person reaches when they paid but the page was lost before the account
   * was made. Returns { user, accessToken }; the caller issues the refresh token.
   */
  async complete(pendingId) {
    const pending = await loadPending(pendingId);
    if (!pending.email_verified_at) throw ApiError.badRequest("Please verify your email first.");
    if (!pending.details_saved_at) throw ApiError.badRequest("Please finish your details first.");
    const fee = await feeOf(pending.id);
    if (!fee.canComplete) throw ApiError.badRequest(`Please pay at least ₹${fee.minimum} to finish.`);

    const result = await AuthService.createAccount({
      fullName: pending.full_name,
      email: pending.email,
      mobile: pending.mobile,
      passwordHash: pending.password_hash,
      becomeMember: pending.become_member,
      category: pending.category ?? undefined,
      profile: pending.profile ?? undefined,
      // A plain member's details are where they live, kept on the account itself.
      location: pending.category ? undefined : [pending.profile?.city, pending.profile?.state].filter(Boolean).join(", ") || undefined,
      emailVerified: true,
    });

    // Signed up with Google: the account remembers it, so the next Google sign-in finds it.
    if (pending.google_sub) {
      await sql(`UPDATE users SET google_sub = $2 WHERE id = $1 AND google_sub IS NULL`, [result.user.id, pending.google_sub]).catch((error) =>
        console.error("[google] could not link the new account:", error.message),
      );
    }

    // The payments made so far now belong to the new account.
    await sql(`UPDATE registration_payments SET user_id = $2 WHERE pending_signup_id = $1`, [pending.id, result.user.id]);
    await sql(`UPDATE pending_signups SET completed_user_id = $2, password_hash = 'completed', profile = NULL WHERE id = $1`, [
      pending.id,
      result.user.id,
    ]);
    await sql(`DELETE FROM otp_codes WHERE pending_signup_id = $1`, [pending.id]);

    // A first message in the bell: a welcome, and the receipt for what was paid.
    await NotificationModel.notify(result.user.id, {
      kind: "success",
      category: "system",
      title: "Welcome to Shyam Jagat",
      message: `Your account is ready and your payment of ₹${fee.paid.toLocaleString("en-IN")} was received. Jai Shri Shyam!`,
      link: "/profile",
      dedupeKey: "welcome",
    });

    const user = await AuthService.withProfiles(await UserModel.findById(result.user.id));
    const { receipt } = await RegistrationPaymentModel.paidSummary(user.id);
    // A failed email must not undo a paid, created account.
    sendWelcomeEmail({ to: user.email, fullName: user.fullName, paid: fee.paid, balance: fee.balance, receipt }).catch((error) =>
      console.error("[mail] welcome email failed:", error.message),
    );

    return { user, accessToken: result.accessToken };
  },
};
