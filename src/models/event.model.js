import { createSqlRepository } from "../db/sqlRepository.js";

export const EventModel = createSqlRepository("events", { jsonColumns: ["focusKeywords"] });
export const EventVolunteerModel = createSqlRepository("event_volunteers");
