import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Sign in with Google. The browser gets a signed ID token from Google (the "credential"); it is checked here:
 * signed by Google, meant for THIS app's client id (GOOGLE_CLIENT_ID), not expired. Only a Google account whose
 * email Google itself has verified is accepted. No client secret is needed for this.
 */
let client = null;
let testVerifier = null;

/** Tests replace the Google check with their own (never possible outside test mode). */
export function setGoogleVerifierForTests(fn) {
  if (env.nodeEnv !== "test") throw new Error("only available in test mode");
  testVerifier = fn;
}

export const googleConfigured = () => Boolean(env.google.clientId);

/** Returns { sub, email, name, picture } for a valid credential, or throws a plain error for the person. */
export async function verifyGoogleCredential(credential) {
  if (testVerifier) return testVerifier(credential);
  if (!googleConfigured()) throw ApiError.serviceUnavailable("Google sign-in is not set up yet. Please use your email and password.");

  let payload;
  try {
    client ??= new OAuth2Client(env.google.clientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.google.clientId });
    payload = ticket.getPayload();
  } catch (error) {
    console.error("[google] credential refused:", error.message);
    throw ApiError.unauthorized("We could not verify your Google sign-in. Please try again.");
  }
  if (!payload?.sub || !payload.email) throw ApiError.unauthorized("We could not verify your Google sign-in. Please try again.");
  if (!payload.email_verified) throw ApiError.badRequest("The email on your Google account is not verified, so we cannot use it.");
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: (payload.name ?? "").trim(), picture: payload.picture ?? null };
}
