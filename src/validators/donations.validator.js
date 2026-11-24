import { z } from "zod";

/** Optional free text: blank becomes "not given". */
const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createDonationOrderSchema = z.object({
  amount: z.number().positive("amount must be a positive number of rupees").max(10_000_000, "amount is too large"),
  cause: z.string().trim().min(1).max(255),
  donorName: z.string().trim().min(2),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(7).optional(),
  anonymous: z.boolean().default(false),
  wantReceipt: z.boolean().default(true),
  // Give Seva (all optional; the ordinary donation page sends none of them).
  sevaType: z.string().trim().regex(/^[a-z0-9-]{1,60}$/, "invalid seva").optional(),
  occasion: text(60),
  dedicatedTo: text(120),
  message: text(500),
  instructions: text(900),
  gotra: text(60),
  attend: z.enum(["yes", "maybe", "no"]).optional(),
  witness: z.enum(["none", "photos", "video", "live"]).optional(),
  witnessTime: z.enum(["morning", "afternoon", "evening"]).optional(),
  videoNumber: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s-]{6,19}$/, "videoNumber must be a phone number")
    .optional(),
  updates: z.enum(["whatsapp", "call", "email", "none"]).optional(),
  preferredDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "preferredDate must be YYYY-MM-DD")
    .optional(),
  city: text(80),
  payMethod: z.enum(["any", "upi", "card", "netbanking", "wallet"]).optional(),
});

export const verifyDonationSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
