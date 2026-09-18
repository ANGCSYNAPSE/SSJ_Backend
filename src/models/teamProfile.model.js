import { createSqlRepository } from "../db/sqlRepository.js";

export const TeamProfileModel = createSqlRepository("team_profiles", {
  jsonColumns: ["milestones", "credentials", "socialLinks"],
});
