import { z } from "zod";

export const createEventSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  image: z.string().optional(),
  location: z.string().trim().min(1),
  venueAddress: z.string().trim().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  type: z.string().trim().min(1),
  registrationLimit: z.number().int().positive().optional(),
  organizerName: z.string().trim().optional(),
  contactNumber: z.string().trim().optional(),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  metaTitle: z.string().trim().max(60).optional(),
  metaDescription: z.string().trim().max(160).optional(),
  focusKeywords: z.array(z.string().trim().min(1)).default([]),
  isIndexed: z.boolean().default(true),
  isPublished: z.boolean().default(false),
});

export const updateEventSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  image: z.string().optional(),
  location: z.string().trim().min(1).optional(),
  venueAddress: z.string().trim().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  type: z.string().trim().min(1).optional(),
  registrationLimit: z.number().int().positive().optional(),
  organizerName: z.string().trim().optional(),
  contactNumber: z.string().trim().optional(),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  metaTitle: z.string().trim().max(60).optional(),
  metaDescription: z.string().trim().max(160).optional(),
  focusKeywords: z.array(z.string().trim().min(1)).optional(),
  isIndexed: z.boolean().optional(),
  isPublished: z.boolean().optional(),
});

export const createEventVolunteerSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  message: z.string().optional(),
});
