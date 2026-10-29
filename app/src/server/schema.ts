import "server-only";

// The newest file in supabase/migrations. /healthz compares it with the database, so a deploy whose
// code is newer than its database ("Something went wrong" on every screen) shows at once.
// A test keeps this in step with the folder.
export const LATEST_MIGRATION = "20261030000001_points_board.sql";

/** Postgres codes for "no such column / table / function": the database is missing a migration. */
export const SCHEMA_BEHIND_CODES = new Set(["42703", "42P01", "42883"]);
