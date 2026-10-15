import { z } from "zod";

const PRIORITIES = ["low", "medium", "high"];
const PLACEMENTS = ["leaderboard", "banner", "rectangle"];

export const createAdSchema = z.object({
  placement: z.enum(PLACEMENTS),
  title: z.string().trim().min(1).max(255).optional(),
  advertiser: z.string().trim().max(255).optional(),
  adType: z.string().trim().max(100).optional(),
  revenueRupees: z.number().min(0).optional(),
  priority: z.enum(PRIORITIES).default("medium"),
  description: z.string().trim().max(2000).optional(),
  isDraft: z.boolean().default(false),
  page: z.string().optional(),
  imageUrl: z.string().min(1, "imageUrl is required"),
  linkUrl: z.string().optional(),
  ctaLabel: z.string().optional(),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});

export const updateAdSchema = z.object({
  placement: z.enum(PLACEMENTS).optional(),
  title: z.string().trim().min(1).max(255).optional(),
  advertiser: z.string().trim().max(255).optional(),
  adType: z.string().trim().max(100).optional(),
  revenueRupees: z.number().min(0).optional(),
  priority: z.enum(PRIORITIES).optional(),
  description: z.string().trim().max(2000).optional(),
  isDraft: z.boolean().optional(),
  page: z.string().optional(),
  imageUrl: z.string().min(1).optional(),
  linkUrl: z.string().optional(),
  ctaLabel: z.string().optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
