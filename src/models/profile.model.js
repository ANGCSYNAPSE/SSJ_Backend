import { sql } from "../config/database.js";
import { createSqlRepository } from "../db/sqlRepository.js";
import { REQUIRED_FIELDS } from "../validators/profiles.validator.js";

/**
 * One entry per signup category. Each category lives in its own table
 * (see migration 024); `jsonColumns` are the list-valued fields stored as JSONB.
 * `omitFromPublic` strips private fields from the public directory listing.
 */
const CATEGORY_CONFIG = {
  artist: { table: "artists", jsonColumns: ["availableEvents", "regions", "workFiles", "missingFields"], person: true },
  dancer: { table: "dancers", jsonColumns: ["availableEvents", "regions", "workFiles", "missingFields"], person: true },
  musician: { table: "musicians", jsonColumns: ["availableEvents", "regions", "workFiles", "missingFields"], person: true },
  temple: { table: "temples", jsonColumns: ["services", "gallery", "missingFields"], person: false },
  dharamshala: { table: "dharamshalas", jsonColumns: ["amenities", "propertyPhotos", "missingFields"], person: false },
  mandal: { table: "mandals", jsonColumns: ["sevaTypes", "missingFields"], person: false },
};

const PRIVATE_FIELDS = ["userId", "adminNote", "missingFields"];
const PERSONAL_FIELDS = ["dateOfBirth", "consentContact"];

const repositories = Object.fromEntries(
  Object.entries(CATEGORY_CONFIG).map(([category, { table, jsonColumns }]) => [
    category,
    createSqlRepository(table, { jsonColumns }),
  ]),
);

const isBlank = (value) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);

/** Required details (see REQUIRED_FIELDS) that `data` doesn't have yet; empty means the profile is complete. */
export const missingFieldsFor = (category, data) => REQUIRED_FIELDS[category].filter((field) => isBlank(data[field]));

/** Re-checks a saved profile after an edit and stores the new list of missing details if it changed. */
export async function syncCompleteness(category, row) {
  if (!row) return row;
  const missing = missingFieldsFor(category, row);
  if (JSON.stringify(missing) === JSON.stringify(row.missingFields ?? [])) return row;
  return repositories[category].update(row.id, { missingFields: missing });
}

export const isCategory = (value) => Object.hasOwn(CATEGORY_CONFIG, value);

export const profileRepository = (category) => repositories[category];

export const categoryTable = (category) => CATEGORY_CONFIG[category].table;

/** The profile row `userId` holds in `category`, or null. */
export const findProfileByUser = (category, userId) => repositories[category].findOne("user_id = $1", [userId]);

/** Every category a user has registered for, as `{ id, category, status }`. */
export async function listProfilesForUser(userId) {
  const rows = await sql(
    `SELECT id, type, status, is_complete, missing_fields FROM all_registrations WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    category: row.type,
    status: row.status,
    isComplete: row.is_complete,
    missing: row.missing_fields,
  }));
}

/** Admin roll-up across all categories, optionally filtered. */
export async function listAllRegistrations({ type, status, complete } = {}) {
  const conditions = [];
  const params = [];
  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (complete !== undefined) conditions.push(`is_complete = ${complete === "true" ? "TRUE" : "FALSE"}`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await sql(
    `SELECT id, user_id, type, status, display_name, full_name, email, phone, created_at, is_complete, missing_fields
     FROM all_registrations ${where} ORDER BY created_at DESC`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    displayName: row.display_name,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    createdAt: row.created_at,
    isComplete: row.is_complete,
    missing: row.missing_fields,
  }));
}

/** A profile joined with its owner's account details, for the admin detail view. */
export async function findProfileWithAccount(category, id) {
  const profile = await repositories[category].findById(id);
  if (!profile) return null;
  const [owner] = await sql(`SELECT id, full_name, email, mobile FROM users WHERE id = $1`, [profile.userId]);
  return {
    ...profile,
    account: owner ? { id: owner.id, fullName: owner.full_name, email: owner.email, mobile: owner.mobile } : null,
  };
}

/** Approved profiles of one category, with private fields removed — safe for the public site. */
export async function listPublicProfiles(category) {
  const { table, person } = CATEGORY_CONFIG[category];
  const rows = await sql(
    `SELECT t.*, u.full_name AS owner_name
     FROM "${table}" t JOIN users u ON u.id = t.user_id
     WHERE t.status = 'approved' ORDER BY t.created_at DESC`,
  );
  const omit = person ? [...PRIVATE_FIELDS, ...PERSONAL_FIELDS] : PRIVATE_FIELDS;
  return rows.map((row) => {
    const entity = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()), value]),
    );
    for (const field of omit) delete entity[field];
    return entity;
  });
}
