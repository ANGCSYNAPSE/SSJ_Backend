import { createSqlRepository } from "../db/sqlRepository.js";

export const EventModel = createSqlRepository("events");
export const EventVolunteerModel = createSqlRepository("event_volunteers");
