import { z } from "zod";

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
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: "Password is required." }).min(1, "Please enter your password."),
  remember: z.boolean().optional().default(true),
});
