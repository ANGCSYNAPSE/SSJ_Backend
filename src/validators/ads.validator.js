import { z } from "zod";

const PRIORITIES = ["low", "medium", "high"];
const PLACEMENTS = ["leaderboard", "banner", "rectangle"];
export const TEMPLATES = ["image", "split"];
export const THEMES = ["maroon", "navy", "charcoal", "forest", "royal", "teal", "custom"];
const HEX = /^#[0-9a-fA-F]{6}$/;

const adFields = {
  placement: z.enum(PLACEMENTS),
  title: z.string().trim().min(1).max(255),
  advertiser: z.string().trim().max(255),
  adType: z.string().trim().max(100),
  revenueRupees: z.number().min(0),
  priority: z.enum(PRIORITIES),
  description: z.string().trim().max(2000),
  isDraft: z.boolean(),
  page: z.string(),
  imageUrl: z.string(),
  linkUrl: z.string().trim().max(2000),
  ctaLabel: z.string().trim().max(40),
  isActive: z.boolean(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  template: z.enum(TEMPLATES),
  headline: z.string().trim().max(160),
  subline: z.string().trim().max(200),
  theme: z.enum(THEMES),
  bgFrom: z.string().regex(HEX, "Use a colour like #6a1b1b"),
  bgTo: z.string().regex(HEX, "Use a colour like #4a1010"),
  ctaColor: z.string().regex(HEX, "Use a colour like #e8751a"),
  /** The 1st, 2nd... spot of its size on the page (top to bottom); null = any spot. */
  slotPosition: z.number().int().min(1).max(9).nullable(),
};

// An ad is either a picture on its own, or a designed panel with text. Each needs its own essentials.
const needsItsContent = (ad, ctx) => {
  const template = ad.template ?? "image";
  if (template === "image" && !ad.imageUrl) {
    ctx.addIssue({ code: "custom", path: ["imageUrl"], message: "Upload the ad picture." });
  }
  if (template === "split" && !ad.headline) {
    ctx.addIssue({ code: "custom", path: ["headline"], message: "Write the headline for the ad." });
  }
  if (ad.theme === "custom" && (!ad.bgFrom || !ad.bgTo)) {
    ctx.addIssue({ code: "custom", path: ["bgFrom"], message: "Choose both background colours." });
  }
};

export const createAdSchema = z
  .object({
    ...adFields,
    title: adFields.title.optional(),
    advertiser: adFields.advertiser.optional(),
    adType: adFields.adType.optional(),
    revenueRupees: adFields.revenueRupees.optional(),
    priority: adFields.priority.default("medium"),
    description: adFields.description.optional(),
    isDraft: adFields.isDraft.default(false),
    page: adFields.page.optional(),
    imageUrl: adFields.imageUrl.optional(),
    linkUrl: adFields.linkUrl.optional(),
    ctaLabel: adFields.ctaLabel.optional(),
    isActive: adFields.isActive.default(true),
    startsAt: adFields.startsAt.optional(),
    endsAt: adFields.endsAt.optional(),
    template: adFields.template.default("image"),
    headline: adFields.headline.optional(),
    subline: adFields.subline.optional(),
    theme: adFields.theme.default("maroon"),
    bgFrom: adFields.bgFrom.optional(),
    bgTo: adFields.bgTo.optional(),
    ctaColor: adFields.ctaColor.optional(),
    slotPosition: adFields.slotPosition.optional(),
  })
  .superRefine(needsItsContent);

export const updateAdSchema = z.object(
  Object.fromEntries(Object.entries(adFields).map(([key, schema]) => [key, schema.optional()])),
);

/** How the ad slots on the site rotate their ads. One set of rules for the whole site, edited in the admin. */
export const adRotationSchema = z.object({
  /** Seconds each ad stays before the next one shows (3 seconds to 10 minutes). */
  seconds: z.number().int().min(3).max(600),
  /** tiles = the current ad in the middle with the next and previous peeking in behind it; fade = one ad at a time. */
  transition: z.enum(["tiles", "fade"]),
  pauseOnHover: z.boolean(),
});
