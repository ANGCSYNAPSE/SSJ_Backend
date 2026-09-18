import { createSqlRepository } from "../db/sqlRepository.js";

export const DonationModel = createSqlRepository("donations");
