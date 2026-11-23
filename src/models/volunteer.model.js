import { createSqlRepository, rowToEntity } from "../db/sqlRepository.js";
import { sql } from "../config/database.js";

const repository = createSqlRepository("volunteers", { jsonColumns: ["interests", "skills"] });

/** What a volunteer sees of their own record (the admin's private note stays out). */
export const toVolunteer = (row) =>
  row && {
    id: row.id,
    status: row.status,
    interests: row.interests ?? [],
    skills: row.skills ?? [],
    availability: row.availability ?? null,
    city: row.city,
    state: row.state,
    about: row.about ?? null,
    createdAt: row.createdAt,
  };

export const VolunteerModel = {
  ...repository,

  async findByUser(userId) {
    const [row] = await sql(`SELECT * FROM volunteers WHERE user_id = $1`, [userId]);
    return rowToEntity(row);
  },
};
