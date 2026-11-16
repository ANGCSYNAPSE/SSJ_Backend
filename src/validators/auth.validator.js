import { z } from "zod";
import { CATEGORY_KEYS, PROFILE_SCHEMAS } from "./profiles.validator.js";

const email = z
  .string({ required_error: "Email address is required." })
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.");

const mobile = z
  .string({ required_error: "Mobile number is required." })
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.");

const password = z
  .string({ required_error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.")
  .regex(
    /(?=.*[a-zA-Z])(?=.*\d)/,
    "Password must include at least one letter and one number.",
  );

export const signupSchema = z
  .object({
    fullName: z
      .string({ required_error: "Full name is required." })
      .trim()
      .min(2, "Please enter your full name.")
      .max(120, "Full name is too long."),
    mobile,
    email,
    password,
    confirmPassword: z.string({
      required_error: "Please confirm your password.",
    }),
    acceptTerms: z.literal(true, {
      errorMap: () => ({
        message: "Please accept the Terms of Service to continue.",
      }),
    }),
    // "Become a Member" checkbox on the plain sign-up path.
    becomeMember: z.boolean().optional().default(false),
    // Set when the person is registering as an artist, temple, etc. The
    // category's own fields travel in `profile` and are validated below.
    category: z.enum(CATEGORY_KEYS).optional(),
    profile: z.record(z.unknown()).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  .transform((data, ctx) => {
    if (!data.category) {
      const { profile: _ignored, ...rest } = data;
      return rest;
    }

    const parsed = PROFILE_SCHEMAS[data.category].safeParse(data.profile ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["profile", ...issue.path] });
      }
      return z.NEVER;
    }
    return { ...data, profile: parsed.data };
  });

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: "Password is required." }).min(1, "Please enter your password."),
  remember: z.boolean().optional().default(true),
});

export const forgotPasswordSchema = z.object({ email });

/** Signup asks this on its first step, before the person fills in the rest of a long form. */
export const checkAvailabilitySchema = z
  .object({ email: email.optional(), mobile: mobile.optional() })
  .refine((v) => v.email || v.mobile, { message: "Send an email or a mobile number." });

export const resetPasswordSchema = z
  .object({
    token: z.string({ required_error: "Reset token is missing." }).min(1),
    password,
    confirmPassword: z.string({ required_error: "Please confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });
