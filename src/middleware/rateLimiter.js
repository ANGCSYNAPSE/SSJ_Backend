import rateLimit from "express-rate-limit";

const shared = {
  // Tests make many deliberate bad requests in a row; they must not trip the limits.
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
    errors: null,
  },
};

/** Baseline limit applied to the whole API. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  max: 300,
});

/** The signup availability check can reveal which emails are registered, so keep it modest. */
export const availabilityLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  max: 60,
});

/** Tighter limit on credential endpoints to slow brute-force attempts. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
});

/**
 * The signup steps (code, resend, payment) are several calls per person, so the limit is looser than
 * for login; each code also has its own cap on wrong tries. Only failed requests count.
 */
export const signupFlowLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  max: 40,
  skipSuccessfulRequests: true,
});
