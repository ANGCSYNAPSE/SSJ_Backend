import { z } from "zod";

/** Only paths inside the site, so a message can't send someone to an outside address. */
const internalLink = z
  .string()
  .trim()
  .max(255)
  .regex(/^\/(?!\/)[\w\-./?=&%#]*$/, "Use a path inside the site, like /complete-profile.");

const blankToUndefined = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const sendNotificationSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, "Choose at least one person.").max(200),
  message: z.string().trim().min(1, "Write a message.").max(500, "Keep it under 500 characters."),
  title: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  kind: z.enum(["info", "success", "warning"]).default("info"),
  link: z.preprocess(blankToUndefined, internalLink.optional()),
});

export const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
});
