import { z } from "zod";

export const createCommunitySchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/),
  description: z.string().trim().optional(),
  image: z.string().min(1).optional(),
  category: z.string().trim().optional(),
  memberCount: z.number().int().min(0).default(0),
  dailyDiscussions: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateCommunitySchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().trim().optional(),
  image: z.string().min(1).optional(),
  category: z.string().trim().optional(),
  memberCount: z.number().int().min(0).optional(),
  dailyDiscussions: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
