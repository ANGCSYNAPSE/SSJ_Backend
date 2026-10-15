import { z } from "zod";

const role = z.enum(["member", "artist", "temple_admin", "admin"]);

export const changeRoleSchema = z.object({ role });

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2, "Please enter the full name.").max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").optional(),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.").optional(),
  location: z.string().trim().max(255).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  role: role.optional(),
  status: z.enum(["active", "suspended", "pending"]).optional(),
});

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2, "Please enter the full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72)
    .regex(/(?=.*[a-zA-Z])(?=.*\d)/, "Password must include at least one letter and one number."),
  role: role.default("member"),
  location: z.string().trim().max(255).optional(),
  avatarUrl: z.string().url().optional(),
  status: z.enum(["active", "suspended", "pending"]).default("pending"),
});
