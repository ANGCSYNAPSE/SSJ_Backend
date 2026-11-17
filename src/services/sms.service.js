import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Sends a text message. No SMS provider is connected yet, so every call says so: the signup code
 * screen shows "SMS is coming soon" and offers email instead. When a provider is chosen (MSG91,
 * Twilio and so on), implement `deliver` below and set its variables; nothing else needs to change.
 */
export const smsConfigured = Boolean(env.sms.provider);

async function deliver(_to, _text) {
  // Provider call goes here, for example an HTTPS request to the provider's OTP / SMS API.
  throw ApiError.serviceUnavailable("SMS is not available yet. Please use email.");
}

/** Indian mobile numbers are stored as 10 digits; providers want the country code. */
const withCountryCode = (mobile) => (mobile.startsWith("+") ? mobile : `+91${mobile}`);

export async function sendSms({ to, text }) {
  if (!smsConfigured) throw ApiError.serviceUnavailable("SMS is not available yet. Please use email.");
  await deliver(withCountryCode(to), text);
}

export const signupOtpText = (code, minutes) =>
  `${code} is your Shyam Jagat verification code. It is valid for ${minutes} minutes. Do not share it with anyone.`;
