import { z } from "zod";

export const createOrganisationSchema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/),
  description: z.string().trim().optional(),
  logo: z.string().min(1).optional(),
  category: z.string().trim().optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().optional(),
  established: z.string().trim().optional(),
  isActive: z.boolean().default(true),
});

export const updateOrganisationSchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().trim().optional(),
  logo: z.string().min(1).optional(),
  category: z.string().trim().optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().optional(),
  established: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});
