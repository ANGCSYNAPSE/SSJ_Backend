import { sql } from "../config/database.js";

function camelToSnake(key) {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function snakeToCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function rowToEntity(row) {
  if (!row) return null;
  const entity = {};
  for (const [key, value] of Object.entries(row)) {
    entity[snakeToCamel(key)] = value;
  }
  return entity;
}

/**
 * Generic table-backed repository over the Neon `sql` tagged-template client,
 * mirroring the shape the JSON-file backend used (list/findById/create/
 * update/remove) so every module's routes can stay near-identical to that
 * version. Column names are derived from JS camelCase field names
 * (fullName -> full_name); `jsonColumns` lists fields stored as JSONB that
 * need stringifying on write.
 */
export function createSqlRepository(table, { jsonColumns = [], defaultOrderBy = "created_at DESC" } = {}) {
  const toDbValue = (key, value) => (jsonColumns.includes(key) ? JSON.stringify(value) : value);
  // Double-quoted so a field name that happens to collide with a SQL
  // reserved word (e.g. "desc") is still a safe, unambiguous identifier.
  const quotedTable = `"${table}"`;
  const col = (key) => `"${camelToSnake(key)}"`;

  return {
    /** `where`/`params` are a raw SQL fragment (no leading WHERE) and its bound params. */
    async list(where = "", params = []) {
      const whereSql = where ? `WHERE ${where}` : "";
      const rows = await sql(`SELECT * FROM ${quotedTable} ${whereSql} ORDER BY ${defaultOrderBy}`, params);
      return rows.map(rowToEntity);
    },

    async findById(id) {
      const rows = await sql(`SELECT * FROM ${quotedTable} WHERE id = $1`, [id]);
      return rowToEntity(rows[0]);
    },

    async findOne(where, params = []) {
      const rows = await sql(`SELECT * FROM ${quotedTable} WHERE ${where} LIMIT 1`, params);
      return rowToEntity(rows[0]);
    },

    async create(data) {
      const entries = Object.entries(data).filter(([, v]) => v !== undefined);
      const columns = entries.map(([k]) => col(k));
      const values = entries.map(([k, v]) => toDbValue(k, v));
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const rows = await sql(
        `INSERT INTO ${quotedTable} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        values,
      );
      return rowToEntity(rows[0]);
    },

    async update(id, patch) {
      const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return this.findById(id);

      const setSql = entries.map(([k], i) => `${col(k)} = $${i + 1}`).join(", ");
      const values = entries.map(([k, v]) => toDbValue(k, v));

      const rows = await sql(
        `UPDATE ${quotedTable} SET ${setSql} WHERE id = $${values.length + 1} RETURNING *`,
        [...values, id],
      );
      return rowToEntity(rows[0]);
    },

    async remove(id) {
      const rows = await sql(`DELETE FROM ${quotedTable} WHERE id = $1 RETURNING id`, [id]);
      return rows.length > 0;
    },

    /** Bulk-assigns `"order"` from a list of `{ id, order }` pairs, e.g. after a drag-and-drop reorder. */
    async reorderMany(items) {
      await Promise.all(
        items.map(({ id, order }) => sql(`UPDATE ${quotedTable} SET "order" = $1 WHERE id = $2`, [order, id])),
      );
    },
  };
}
