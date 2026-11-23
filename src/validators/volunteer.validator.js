import { z } from "zod";

/**
 * The seva a volunteer can offer to help with: the services on the Initiatives page. The words are what the form shows
 * and what is stored, so the admin reads them as they were chosen. Change one here, change the form (site categories.ts).
 */
export const VOLUNTEER_INTERESTS = [
  "Food seva (Annadan)",
  "Night shelter (Rain Basera)",
  "Drinking water (Pani Ki Pyau)",
  "Ambulance help",
  "Gaushala seva",
  "Education support",
  "Health camps and care",
  "Dharamshala help",
  "Elders' care (Vriddhashram)",
  "Footwear seva (Juta Seva)",
  "Clean toilets (Swachh Shauchalay)",
  "Cleanliness drives (Swachh Vahini)",
];

export const VOLUNTEER_SKILLS = [
  "Teaching",
  "Cooking and serving",
  "Medical or first aid",
  "Driving",
  "Cleaning and maintenance",
  "Counselling and elder care",
  "Photography and video",
  "Computer and social media",
  "Organising events",
  "Fundraising",
  "Other",
];

export const VOLUNTEER_AVAILABILITY = ["Weekends", "Weekday evenings", "Weekdays", "Any day", "Only for special events"];

const text = (message, min = 2, max = 100) => z.string({ required_error: message }).trim().min(min, message).max(max);
const blankToUndefined = (value) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/** What a volunteer fills in (step 2 of the volunteer form), and what they may change later. */
export const volunteerProfile = z.object({
  city: text("Please enter your city."),
  state: text("Please choose your state."),
  interests: z
    .array(z.enum(VOLUNTEER_INTERESTS, { errorMap: () => ({ message: "Choose from the list." }) }))
    .min(1, "Choose at least one seva you would like to help with.")
    .max(VOLUNTEER_INTERESTS.length),
  skills: z.array(z.enum(VOLUNTEER_SKILLS, { errorMap: () => ({ message: "Choose from the list." }) })).max(VOLUNTEER_SKILLS.length).default([]),
  availability: z.enum(VOLUNTEER_AVAILABILITY, { errorMap: () => ({ message: "Choose when you can help." }) }),
  about: z.preprocess(blankToUndefined, z.string().trim().max(500, "Please keep this under 500 characters.").optional()),
});

/** Changes a volunteer makes to their own details: any of the above. */
export const volunteerSelfUpdateSchema = volunteerProfile.partial();

export const VOLUNTEER_STATUSES = ["pending", "approved", "rejected", "blocked"];

/** The admin's decision on a volunteer. */
export const volunteerReviewSchema = z.object({
  status: z.enum(VOLUNTEER_STATUSES),
  adminNote: z.string().trim().max(500).optional(),
});

export const volunteerListQuerySchema = z.object({
  status: z.enum(VOLUNTEER_STATUSES).optional(),
  interest: z.enum(VOLUNTEER_INTERESTS).optional(),
  state: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
});
