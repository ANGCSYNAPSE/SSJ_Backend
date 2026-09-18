import { createSqlRepository } from "../db/sqlRepository.js";

export const SettingsModel = createSqlRepository("settings", {
  jsonColumns: ["socialLinks"],
});
