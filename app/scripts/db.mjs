// Database helper: applies migrations in order (each once, inside a transaction) and runs seeds.
//   node scripts/db.mjs migrate | seed | seed:dev | reset
// Uses DATABASE_URL (or DATABASE_URL_OVERRIDE when given). `reset` refuses to run on anything but localhost.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const root = path.resolve(import.meta.dirname, "..");
const url = process.env.DATABASE_URL_OVERRIDE || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}
const cmd = process.argv[2];
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

async function migrate() {
  await sql`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`revoke all on public.schema_migrations from public`;
  const dir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await sql`select name from public.schema_migrations`).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (name) values (${f})`;
    });
    console.log(`applied ${f}`);
  }
  console.log("migrations up to date");
}

async function runFile(rel) {
  await sql.unsafe(fs.readFileSync(path.join(root, rel), "utf8"));
  console.log(`ran ${rel}`);
}

async function reset() {
  if (!isLocal) throw new Error("reset only runs against a local database");
  await sql.unsafe(`drop schema if exists public cascade; drop schema if exists private cascade;
    create schema public; grant usage on schema public to anon, authenticated, service_role;`);
  console.log("local database wiped");
}

try {
  if (cmd === "migrate") await migrate();
  else if (cmd === "seed") await runFile("supabase/seed.sql");
  else if (cmd === "seed:dev") {
    if (!isLocal) throw new Error("seed:dev only runs against a local database");
    await runFile("supabase/seed.dev.sql");
  } else if (cmd === "seed:demo") await runFile("supabase/seed.demo.sql");
  else if (cmd === "demo:remove") await runFile("supabase/demo-remove.sql");
  else if (cmd === "reset") { await reset(); await migrate(); await runFile("supabase/seed.sql"); }
  else { console.error("usage: node scripts/db.mjs migrate|seed|seed:dev|seed:demo|demo:remove|reset"); process.exitCode = 1; }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
