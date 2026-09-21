import { z } from "zod";

export const createProductSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/),
  description: z.string().trim().optional(),
  image: z.string().min(1).optional(),
  category: z.string().trim().optional(),
  price: z.number().min(0).default(0),
  stock: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().trim().optional(),
  image: z.string().min(1).optional(),
  category: z.string().trim().optional(),
  price: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
