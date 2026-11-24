import { z } from "zod";

/**
 * The links a person can put on their profile and card. Each must be an https address on the platform it is named for, so a
 * link cannot quietly point somewhere else (and "javascript:" or a bare word is refused). An empty value removes the link.
 */
const HOSTS = {
  youtube: ["youtube.com", "youtu.be"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com", "fb.me"],
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  website: null, // any website
};

export const LINK_KEYS = Object.keys(HOSTS);

const onHost = (hostname, allowed) => allowed.some((h) => hostname === h || hostname.endsWith("." + h));

const linkField = (key) =>
  z
    .string()
    .trim()
    .max(300)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v))
    .superRefine((value, ctx) => {
      if (value === null || value === undefined) return;
      let url;
      try {
        url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Please write a full link, for example https://youtube.com/yourchannel" });
        return;
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") ctx.addIssue({ code: "custom", message: "This is not a web link." });
      else if (HOSTS[key] && !onHost(url.hostname.toLowerCase(), HOSTS[key])) ctx.addIssue({ code: "custom", message: "This link is not a " + key + " link." });
    })
    .transform((value) => {
      if (!value) return null;
      const url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value);
      url.protocol = "https:";
      return url.toString();
    });

export const socialLinksSchema = z.object(Object.fromEntries(LINK_KEYS.map((k) => [k, linkField(k)]))).strict();

/** Drops the empty links, so only what the person filled in is stored. */
export const cleanLinks = (links) => Object.fromEntries(Object.entries(links ?? {}).filter(([, v]) => typeof v === "string" && v));
