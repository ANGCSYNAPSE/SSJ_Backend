import { z } from "zod";

export const createContactSubmissionSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(200),
  phone: z.string().trim().max(30).optional(),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(5, "Please write your message.").max(2000, "Please keep the message under 2000 characters."),
});
