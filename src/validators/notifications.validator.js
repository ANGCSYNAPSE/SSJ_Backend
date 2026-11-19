import { z } from "zod";

/** Only paths inside the site, so a message can't send someone to an outside address. */
const internalLink = z
  .string()
  .trim()
  .max(255)
  .regex(/^\/(?!\/)[\w\-./?=&%#]*$/, "Use a path inside the site, like /events or /complete-profile.");

const blankToUndefined = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const CATEGORIES = ["announcement", "event", "update", "seva", "payment", "registration", "system"];
const REGISTRATION_TYPES = ["artist", "dancer", "musician", "temple", "dharamshala", "mandal"];

const messageFields = {
  message: z.string().trim().min(1, "Write a message.").max(500, "Keep it under 500 characters."),
  title: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  kind: z.enum(["info", "success", "warning"]).default("info"),
  category: z.enum(CATEGORIES).default("announcement"),
  link: z.preprocess(blankToUndefined, internalLink.optional()),
};

/** A message to chosen people (the "Message" button on a registration). */
export const sendNotificationSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, "Choose at least one person.").max(200),
  ...messageFields,
});

export const audienceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({
    mode: z.literal("segment"),
    segment: z
      .object({
        fee: z.enum(["paid", "partial", "unpaid"]).optional(),
        categories: z.array(z.enum(REGISTRATION_TYPES)).max(6).optional(),
        profile: z.enum(["incomplete", "complete"]).optional(),
        registration: z.enum(["none", "any"]).optional(),
        verified: z.enum(["yes", "no"]).optional(),
      })
      .refine((s) => Object.values(s).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0)), {
        message: "Choose at least one filter, or send to everyone.",
      }),
  }),
  z.object({ mode: z.literal("users"), userIds: z.array(z.string().uuid()).min(1, "Choose at least one person.").max(500) }),
]);

/** A message to a whole audience at once. */
export const broadcastSchema = z.object({ audience: audienceSchema, ...messageFields });

export const audiencePreviewSchema = z.object({ audience: audienceSchema });

export const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
});

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime({ offset: true }).optional(),
  unread: z.enum(["true", "false"]).optional(),
  category: z.enum(CATEGORIES).optional(),
});
