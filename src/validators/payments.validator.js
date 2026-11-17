import { z } from "zod";

export const registrationOrderSchema = z.object({
  plan: z.enum(["basic", "premium"], { message: "Choose a plan: basic or premium." }),
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
  plan: z.enum(["basic", "premium", "manual"]).optional(),
  userId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  ...pageParams,
});

export const adminPendingQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  ...pageParams,
});

/** An offline payment (UPI, cash, bank transfer) an admin records by hand. */
export const manualPaymentSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  reference: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500).optional(),
});
