import { createSqlRepository } from "../db/sqlRepository.js";

export const DonationContentModel = createSqlRepository("donation_content", {
  jsonColumns: ["data"],
});
