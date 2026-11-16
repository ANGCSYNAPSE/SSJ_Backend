import { z } from "zod";

/** The frontend sends "" for an untouched field; treat that as "not provided". */
const blankToUndefined = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const text = (message, min = 2, max = 200) =>
  z.string({ required_error: message }).trim().min(min, message).max(max);

const optionalText = (max = 200) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

const optionalUrl = z.preprocess(blankToUndefined, z.string().trim().url("Enter a valid link.").max(500).optional());

const optionalChoice = (options) => z.preprocess(blankToUndefined, z.enum(options).optional());

const list = z.array(z.string().trim().min(1).max(120)).max(40).default([]);

/** Public URLs of uploaded files (Cloudinary), e.g. a gallery. */
const urlList = (max) => z.array(z.string().trim().url().max(500)).max(max).default([]);

const optionalDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.")
    .refine((value) => {
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date < new Date();
    }, "Date of birth must be in the past.")
    .optional(),
);

export const EXPERIENCE = ["0-1 Years", "1-3 Years", "3-5 Years", "5-10 Years", "10+ Years"];
export const TRAVEL = ["Within City", "Within State", "Across India"];
export const GENDERS = ["Male", "Female", "Other", "Prefer Not to Say"];
export const TEMPLE_TYPES = ["Mandir", "Dham", "Ashram", "Shrine", "Temple Complex"];
export const DISTANCES = ["Within 500 Meters", "Within 1 Km", "Within 2 Km", "More than 2 Km"];
export const PRICING_MODES = ["Voluntary Donation (Seva)", "Fixed Price", "Both Options Available"];
export const MANDAL_TYPES = [
  "Bhajan Mandal & Kirtan Samiti",
  "Religious / Charitable Trust",
  "Devotee Community Group",
  "Nishan Yatra Committee",
  "Seva & Social Welfare Society",
];
export const MEMBER_BANDS = [
  "Fewer than 25 Members",
  "25 - 50 Active Members",
  "50 - 100 Active Members",
  "More than 100 Members",
];

/** Artists, dancers and musicians collect identical details. */
const performerProfile = z.object({
  dateOfBirth: optionalDate,
  gender: optionalChoice(GENDERS),
  city: text("Please enter your city.", 2, 100),
  state: text("Please choose your state.", 2, 100),
  profilePhoto: optionalUrl,
  primarySpecialty: text("Please choose your primary specialty.", 2, 100),
  secondarySpecialty: optionalText(100),
  experience: z.enum(EXPERIENCE, { errorMap: () => ({ message: "Please choose your experience." }) }),
  guruName: optionalText(150),
  bio: z
    .string({ required_error: "Please add a short bio." })
    .trim()
    .min(20, "Tell us a little more (at least 20 characters).")
    .max(500, "Please keep the bio under 500 characters."),
  portfolioLink: optionalUrl,
  availableEvents: list,
  regions: list,
  honorarium: optionalText(50),
  travelWillingness: optionalChoice(TRAVEL),
  consentContact: z.boolean().default(false),
  workFiles: urlList(5),
});

const templeProfile = z.object({
  templeName: text("Please enter the temple name.", 3, 255),
  deity: text("Please enter the presiding deity.", 2, 150),
  templeType: z.enum(TEMPLE_TYPES, { errorMap: () => ({ message: "Please choose a temple type." }) }),
  yearEstablished: optionalText(20),
  trustName: optionalText(255),
  registrationNumber: optionalText(100),
  address: text("Please enter the full address.", 5, 300),
  city: text("Please enter the city or town.", 2, 100),
  state: text("Please choose the state.", 2, 100),
  pinCode: z.string({ required_error: "Please enter the PIN code." }).trim().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code."),
  mapsLink: optionalUrl,
  openingTime: optionalText(30),
  closingTime: optionalText(30),
  aartiTimings: optionalText(300),
  services: list,
  description: z
    .string({ required_error: "Please describe the temple." })
    .trim()
    .min(20, "Tell us a little more (at least 20 characters).")
    .max(1000, "Please keep the description under 1000 characters."),
  consentComms: z.boolean().default(false),
  primaryPhoto: optionalUrl,
  gallery: urlList(10),
});

const dharamshalaProfile = z.object({
  name: text("Please enter the dharamshala name.", 3, 255),
  trustName: optionalText(255),
  licenseNumber: text("Please enter the registration or licence number.", 2, 100),
  distanceFromTemple: z.enum(DISTANCES, { errorMap: () => ({ message: "Please choose the distance." }) }),
  address: text("Please enter the full address.", 5, 300),
  state: text("Please choose the state.", 2, 100),
  managerName: optionalText(150),
  totalRooms: z.coerce
    .number({ invalid_type_error: "Enter the number of rooms." })
    .int("Enter a whole number.")
    .min(1, "Enter at least 1 room.")
    .max(5000),
  dormitoryBeds: optionalText(100),
  pricingMode: z.enum(PRICING_MODES, { errorMap: () => ({ message: "Please choose a pricing mode." }) }),
  suggestedPrice: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1000000).optional()),
  amenities: list,
  trustCertificate: optionalUrl,
  propertyPhotos: urlList(10),
  managerIdProof: optionalUrl,
});

const mandalProfile = z.object({
  mandalName: text("Please enter the mandal or organisation name.", 3, 255),
  mandalType: z.enum(MANDAL_TYPES, { errorMap: () => ({ message: "Please choose a category." }) }),
  foundingYear: z.preprocess(blankToUndefined, z.string().trim().regex(/^\d{4}$/, "Enter a 4-digit year.").optional()),
  registrationNumber: optionalText(100),
  state: text("Please choose the state.", 2, 100),
  city: text("Please enter the city or region.", 2, 100),
  address: text("Please enter the head office address.", 5, 300),
  officialPhone: optionalText(30),
  presidentName: text("Please enter the president's name.", 2, 150),
  presidentPhone: optionalText(30),
  memberCountBand: optionalChoice(MEMBER_BANDS),
  spokespersonName: optionalText(150),
  sevaTypes: list,
  recurringEvents: optionalText(500),
  logo: optionalUrl,
  registrationDocument: optionalUrl,
});

/**
 * Details a profile needs before it counts as complete. People may register
 * with these still blank and finish later, so they are not enforced here;
 * a value that *is* sent must still be valid. What's missing is recorded on the
 * profile (see `missingFieldsFor` in profile.model.js).
 */
const PERFORMER_REQUIRED = [
  "dateOfBirth", "gender", "city", "state", "profilePhoto", "primarySpecialty", "experience", "bio",
];

export const REQUIRED_FIELDS = {
  artist: PERFORMER_REQUIRED,
  dancer: PERFORMER_REQUIRED,
  musician: PERFORMER_REQUIRED,
  temple: [
    "templeName", "deity", "yearEstablished", "templeType", "trustName", "address", "city", "state",
    "pinCode", "openingTime", "closingTime", "aartiTimings", "description",
  ],
  dharamshala: [
    "name", "licenseNumber", "distanceFromTemple", "address", "state", "totalRooms", "pricingMode", "suggestedPrice",
  ],
  mandal: [
    "mandalName", "mandalType", "foundingYear", "state", "city", "address", "officialPhone",
    "spokespersonName", "recurringEvents",
  ],
};

const LENIENT_SCHEMAS = {
  artist: performerProfile.partial(),
  dancer: performerProfile.partial(),
  musician: performerProfile.partial(),
  temple: templeProfile.partial(),
  dharamshala: dharamshalaProfile.partial(),
  mandal: mandalProfile.partial(),
};

/** Creation: lenient, except the mandal's president (the account holder), which its row always carries. */
export const PROFILE_SCHEMAS = {
  ...LENIENT_SCHEMAS,
  mandal: LENIENT_SCHEMAS.mandal.required({ presidentName: true }),
};

export const CATEGORY_KEYS = Object.keys(PROFILE_SCHEMAS);

/** Edits: every field optional, defaults not re-applied. */
export const profileUpdateSchema = (category) => LENIENT_SCHEMAS[category];

export const registrationQuerySchema = z.object({
  type: z.enum(CATEGORY_KEYS).optional(),
  status: z.enum(["pending", "approved", "rejected", "blocked"]).optional(),
  complete: z.enum(["true", "false"]).optional(),
});
