import "server-only";
import postgres from "postgres";
import { config } from "./config";

// One pool per server process. `prepare: false` keeps it working behind Supabase's
// transaction-mode pooler (port 6543), which is what a serverless or multi-instance deploy uses.
const g = globalThis as unknown as { __myniyamSql?: postgres.Sql };

export function sql(): postgres.Sql {
  if (!g.__myniyamSql) {
    const c = config();
    g.__myniyamSql = postgres(c.DATABASE_URL, {
      prepare: false,
      max: c.DB_POOL_MAX,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
      transform: { undefined: null },
    });
  }
  return g.__myniyamSql;
}

export type Tx = postgres.TransactionSql;

/**
 * Runs `fn` as the signed-in account: switches to the `authenticated` role and sets the
 * same JWT claims Supabase would, so row-level security decides what is visible.
 */
export async function asAccount<T>(accountId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: accountId, role: "authenticated" });
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

/** Postgres error code, if `e` came from the database. */
export function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}
