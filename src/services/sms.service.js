import { ApiError } from "../utils/ApiError.js";

/**
 * Text messages (one-time codes). Chosen by SMS_PROVIDER, read each time so it can be switched in the
 * environment without code changes:
 *
 *   msg91    sends the code through MSG91's OTP API using your DLT-approved template (production)
 *   console  prints the code in the server log (local development only)
 *   test     collects messages in `smsOutbox` (automated tests only)
 *   (blank)  no SMS: phone verification says it is not switched on yet
 *
 * MSG91 needs MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID (the template text must contain ##OTP##).
 * Indian rules (TRAI / DLT) require a registered sender, entity and template before any text is delivered.
 */

/** Test mode only: every text "sent" during a test run. */
export const smsOutbox = [];

const MSG91_BASE = () => process.env.MSG91_API_BASE ?? "https://control.msg91.com/api/v5";

export const smsProvider = () => (process.env.SMS_PROVIDER ?? "").trim().toLowerCase();

/** True when a code can be texted right now. */
export const smsAvailable = () => {
  const provider = smsProvider();
  if (provider === "msg91") return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_OTP_TEMPLATE_ID);
  return provider === "console" || provider === "test";
};

/** Kept for the signup screen, which asks whether text codes are on. Signup itself verifies the email; phone is verified from the profile. */
export const smsConfigured = false;

/** Indian mobile numbers are stored as 10 digits; MSG91 wants the country code without a plus sign. */
const international = (mobile) => {
  const digits = String(mobile).replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
};

/** Texts a one-time code. Throws a friendly 503 when the provider is off or refuses; the provider's own error goes to the log. */
export async function sendOtpSms({ to, code, minutes }) {
  const provider = smsProvider();
  if (!smsAvailable()) throw ApiError.serviceUnavailable("Phone verification is not switched on yet. Please try again later.");

  if (provider === "test") {
    smsOutbox.push({ to, code, minutes, text: signupOtpText(code, minutes) });
    return;
  }
  if (provider === "console") {
    console.log(`[sms] To: ${to} | code ${code} (valid ${minutes} min)`);
    return;
  }

  try {
    const url = new URL(`${MSG91_BASE()}/otp`);
    url.searchParams.set("template_id", process.env.MSG91_OTP_TEMPLATE_ID);
    url.searchParams.set("mobile", international(to));
    url.searchParams.set("otp", code);
    url.searchParams.set("otp_expiry", String(minutes));
    const res = await fetch(url, {
      method: "POST",
      headers: { authkey: process.env.MSG91_AUTH_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.type !== "success") {
      console.error(`[sms] MSG91 refused the message (${res.status}):`, JSON.stringify(payload));
      throw new Error("provider refused");
    }
  } catch (error) {
    if (error.message !== "provider refused") console.error(`[sms] could not reach MSG91: ${error.message}`);
    throw ApiError.serviceUnavailable("We could not send the text message right now. Please try again in a few minutes.");
  }
}

export const signupOtpText = (code, minutes) =>
  `${code} is your Shyam Jagat verification code. It is valid for ${minutes} minutes. Do not share it with anyone.`;

// Kept so older imports keep working; text sending now always goes through the one-time-code function.
export const sendSms = async ({ to, text }) => {
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) throw ApiError.serviceUnavailable("Text messages are only used for verification codes.");
  await sendOtpSms({ to, code, minutes: 10 });
};
