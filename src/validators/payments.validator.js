import { z } from "zod";

/** A payment towards the registration fee, in whole rupees. The route checks it against what is still owed. */
export const registrationOrderSchema = z.object({
  amount: z.number({ message: "Enter an amount in rupees." }).int("Enter a whole number of rupees.").positive(),
});

export const verifyRegistrationPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

const pageParams = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};

export const adminPaymentsQuerySchema = z.object({
  status: z.enum(["created", "paid", "failed"]).optional(),
  plan: z.enum(["part", "full", "manual"]).optional(),
  userId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  ...pageParams,
});

export const adminPendingQuerySchema = z.object({
  state: z.enum(["pending", "partial"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  ...pageParams,
});

/** An offline payment (UPI, cash, bank transfer) an admin records by hand. */
export const manualPaymentSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000),
  reference: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500).optional(),
});

/** The registration fee an admin sets: whole rupees, and the minimum first payment can never exceed the total. */
export const feeSettingsSchema = z
  .object({
    total: z.number({ message: "Enter the total fee in rupees." }).int("Use a whole number of rupees.").min(100, "The fee must be at least ₹100.").max(100000, "The fee cannot be more than ₹1,00,000."),
    minimum: z.number({ message: "Enter the minimum first payment in rupees." }).int("Use a whole number of rupees.").min(1, "The minimum must be at least ₹1."),
  })
  .refine((fee) => fee.minimum <= fee.total, { path: ["minimum"], message: "The minimum first payment cannot be more than the total fee." });
