import { z } from "zod";

export const createBlogCategorySchema = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/),
});

export const updateBlogCategorySchema = z.object({
  title: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/).optional(),
});

export const createBlogPostSchema = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().trim().min(1),
  content: z.string().trim().min(1),
  coverImage: z.string().optional(),
  categoryId: z.string().optional(),
  author: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).default([]),
  metaDescription: z.string().trim().optional(),
  isPublished: z.boolean().default(false),
  publishedAt: z.string().datetime().optional(),
});

export const updateBlogPostSchema = z.object({
  title: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/).optional(),
  excerpt: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  coverImage: z.string().optional(),
  categoryId: z.string().optional(),
  author: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  metaDescription: z.string().trim().optional(),
  isPublished: z.boolean().optional(),
  publishedAt: z.string().datetime().optional(),
});
