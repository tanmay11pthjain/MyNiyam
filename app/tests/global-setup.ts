import { execFileSync } from "node:child_process";
import path from "node:path";

// Fresh schema + seed in the separate test database before the run. Refuses non-local URLs.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:myniyam-local@127.0.0.1:54329/myniyam_test";
  const env = { ...process.env, DATABASE_URL_OVERRIDE: url };
  const script = path.resolve(import.meta.dirname, "../scripts/db.mjs");
  execFileSync("node", [script, "reset"], { env, stdio: "inherit" });
  execFileSync("node", [script, "seed:dev"], { env, stdio: "inherit" });
}
