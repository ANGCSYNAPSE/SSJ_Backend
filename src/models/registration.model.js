import { createSqlRepository } from "../db/sqlRepository.js";

export const RegistrationModel = createSqlRepository("registrations", {
  jsonColumns: ["details", "attachments"],
});
