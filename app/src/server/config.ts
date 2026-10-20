import "server-only";
import { z } from "zod";

// Every tunable lives here, with a default and an env override. Secrets come only from env.
const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const int = (d: number) => z.coerce.number().int().positive().default(d);
const int0 = (d: number) => z.coerce.number().int().nonnegative().default(d);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: int(5),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_DAYS: int(60),

  // OTP
  OTP_TEST_MODE: bool.default(false), // dev only: no message is sent and the code is always 123456
  OTP_TTL_SEC: int(300),             // a code lives 5 minutes
  OTP_SENDS_PER_WINDOW: int(3),      // 3 sends per number...
  OTP_WINDOW_SEC: int(600),          // ...per 10 minutes
  OTP_RESEND_AFTER_SEC: int0(30),     // "Send by SMS instead" appears after 30 s
  OTP_MAX_ATTEMPTS: int(5),          // wrong guesses before the code is burned

  // Per-IP limits (fixed windows)
  RL_OTP_SEND_PER_IP_HOUR: int(20),
  RL_VERIFY_PER_IP_HOUR: int(60),
  RL_LOOKUP_PER_IP_MIN: int(30),

  MAX_PROFILES_PER_ACCOUNT: int(8),  // also enforced by a trigger in the database
  MAX_BODY_BYTES: int(16_384),

  // MSG91 (server only)
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SMS_TEMPLATE_ID: z.string().optional(),
  MSG91_WHATSAPP_NUMBER: z.string().optional(),     // integrated WhatsApp number, e.g. 919XXXXXXXXX
  MSG91_WHATSAPP_TEMPLATE: z.string().optional(),   // approved authentication template name
  MSG91_WHATSAPP_NAMESPACE: z.string().optional(),
  MSG91_WHATSAPP_LANGUAGE: z.string().default("en"),
});

export type Config = z.infer<typeof schema> & { sessionSecret: string; whatsappEnabled: boolean; smsEnabled: boolean };

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Bad or missing environment variables: ${names}. See .env.example.`);
  }
  const c = parsed.data;
  if (c.OTP_TEST_MODE && c.NODE_ENV === "production" && process.env.ALLOW_OTP_TEST_MODE_IN_PRODUCTION !== "true") {
    throw new Error("OTP_TEST_MODE is on in production. Turn it off (or set ALLOW_OTP_TEST_MODE_IN_PRODUCTION=true for a private demo).");
  }
  let sessionSecret = c.SESSION_SECRET;
  if (!sessionSecret) {
    if (c.NODE_ENV === "production") throw new Error("SESSION_SECRET is required (32+ random characters).");
    sessionSecret = "dev-only-session-secret-change-me-0123456789";
  }
  cached = {
    ...c,
    sessionSecret,
    smsEnabled: Boolean(c.MSG91_AUTH_KEY && c.MSG91_SMS_TEMPLATE_ID),
    whatsappEnabled: Boolean(c.MSG91_AUTH_KEY && c.MSG91_WHATSAPP_NUMBER && c.MSG91_WHATSAPP_TEMPLATE),
  };
  return cached;
}
