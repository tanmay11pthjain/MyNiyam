import "server-only";
import { z } from "zod";

// Every tunable lives here, with a default and an env override. Secrets come only from env.
const int = (d: number) => z.coerce.number().int().positive().default(d);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: int(5),
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_DAYS: int(60),

  // OTP
  // "simulate": nothing is sent and the code is always 1234. "msg91": a random code is sent by MSG91.
  // "phone": a random code is sent as an SMS by our own phone running the MyNiyam SMS Gateway app
  // (the server posts it to the app's ntfy topic, SMS_PHONE_TOPIC).
  OTP_DELIVERY: z.enum(["simulate", "msg91", "phone"]).default("simulate"),
  OTP_TTL_SEC: int(300),             // a code lives 5 minutes
  OTP_SENDS_PER_WINDOW: int(3),      // 3 codes per number...
  OTP_WINDOW_SEC: int(86_400),       // ...per 24 hours
  // Seconds to wait before the next code: 60 s after the 1st, 120 s after the 2nd (the last one repeats).
  OTP_RESEND_WAITS: z.string().regex(/^\d+(,\d+)*$/).default("60,120"),
  OTP_MAX_ATTEMPTS: int(5),          // wrong guesses before the code is burned
  // The phone gateway (OTP_DELIVERY=phone). The topic is a secret: anyone who knows it can send SMS
  // from the phone. Copy it from the gateway app's "Cloud connection" box.
  SMS_PHONE_RELAY: z.string().url().default("https://ntfy.sh"),
  SMS_PHONE_TOPIC: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  // A private demo on a public URL with simulated codes: only these +91 numbers (comma-separated) can log in.
  DEMO_PHONES: z.string().default(""),

  // Per-IP limits (fixed windows)
  RL_OTP_SEND_PER_IP_HOUR: int(60),  // many families share one IP (pathshala Wi-Fi, mobile networks)
  RL_VERIFY_PER_IP_HOUR: int(60),
  RL_LOOKUP_PER_IP_MIN: int(30),

  MAX_PROFILES_PER_ACCOUNT: int(8),  // also enforced by a trigger in the database
  MAX_PATHSHALAS_PER_PHONE: int(5),  // also enforced by a trigger in the database (accounts_limit)
  MAX_BODY_BYTES: int(16_384),

  // Admin panel
  // Comma-separated +91 numbers that may approve sanghs and assign their admins.
  SUPER_ADMIN_PHONE: z.string().default(""),
  ADMIN_SESSION_IDLE_DAYS: int(30),  // an admin session ends after this many days unused
  RL_ADMIN_PER_IP_MIN: int(120),     // admin API calls per IP per minute

  // Image uploads (logo, profile photos). The browser shrinks them to 512 px JPEG before sending.
  MAX_UPLOAD_BYTES: int(600_000),
  // Supabase Storage (server only). Without these, files go to LOCAL_STORAGE_DIR (local dev only).
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  STORAGE_BUCKET: z.string().default("myniyam"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),

  // MSG91 (server only)
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SMS_TEMPLATE_ID: z.string().optional(),
  MSG91_WHATSAPP_NUMBER: z.string().optional(),     // integrated WhatsApp number, e.g. 919XXXXXXXXX
  MSG91_WHATSAPP_TEMPLATE: z.string().optional(),   // approved authentication template name
  MSG91_WHATSAPP_NAMESPACE: z.string().optional(),
  MSG91_WHATSAPP_LANGUAGE: z.string().default("en"),

  // Reminders (web push). Make a key pair once with `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:hello@myniyam.app"),
  // The reminder job (/api/cron/remind) must send "Authorization: Bearer <CRON_SECRET>".
  CRON_SECRET: z.string().min(24).optional(),
  REMIND_BATCH: int(500),             // reminders sent per run, at most

  // Error alerts: a Sentry project's DSN. Without it, errors only go to the host's logs.
  SENTRY_DSN: z.string().url().optional(),
});

export type Config = z.infer<typeof schema> & {
  sessionSecret: string; whatsappEnabled: boolean; smsEnabled: boolean; superAdmins: string[]; supabaseStorage: boolean;
  demoPhones: string[]; demoOnly: boolean; pushEnabled: boolean; resendWaits: number[];
};

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Bad or missing environment variables: ${names}. See .env.example.`);
  }
  const c = parsed.data;
  if (c.OTP_DELIVERY === "simulate" && c.NODE_ENV === "production" && process.env.ALLOW_OTP_SIMULATION_IN_PRODUCTION !== "true") {
    throw new Error("OTP_DELIVERY=simulate in production lets anyone log in with 1234. Set OTP_DELIVERY=msg91 (or ALLOW_OTP_SIMULATION_IN_PRODUCTION=true for a private demo).");
  }
  if (c.OTP_DELIVERY === "phone" && !c.SMS_PHONE_TOPIC) {
    throw new Error("OTP_DELIVERY=phone needs SMS_PHONE_TOPIC: the topic shown in the MyNiyam SMS Gateway app.");
  }
  const demoPhones = c.DEMO_PHONES.split(",").map((p) => p.trim()).filter(Boolean);
  if (demoPhones.some((p) => !/^\+91[6-9]\d{9}$/.test(p))) throw new Error("DEMO_PHONES must be +91 numbers like +917000000001, separated by commas.");
  const demoOnly = c.OTP_DELIVERY === "simulate" && c.NODE_ENV === "production";
  if (demoOnly && !demoPhones.length) throw new Error("A demo with simulated codes needs DEMO_PHONES: the only numbers that may log in.");
  let sessionSecret = c.SESSION_SECRET;
  if (!sessionSecret) {
    if (c.NODE_ENV === "production") throw new Error("SESSION_SECRET is required (32+ random characters).");
    sessionSecret = "dev-only-session-secret-change-me-0123456789";
  }
  const superAdmins = c.SUPER_ADMIN_PHONE.split(",").map((p) => p.trim()).filter(Boolean);
  if (superAdmins.some((p) => !/^\+91[6-9]\d{9}$/.test(p))) throw new Error("SUPER_ADMIN_PHONE must be +91 numbers like +919820012345, separated by commas.");
  const supabaseStorage = Boolean(c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY);
  cached = {
    ...c,
    superAdmins,
    resendWaits: c.OTP_RESEND_WAITS.split(",").map(Number),
    demoPhones,
    demoOnly,
    supabaseStorage,
    sessionSecret,
    smsEnabled: Boolean(c.MSG91_AUTH_KEY && c.MSG91_SMS_TEMPLATE_ID),
    whatsappEnabled: Boolean(c.MSG91_AUTH_KEY && c.MSG91_WHATSAPP_NUMBER && c.MSG91_WHATSAPP_TEMPLATE),
    pushEnabled: Boolean(c.VAPID_PUBLIC_KEY && c.VAPID_PRIVATE_KEY),
  };
  return cached;
}
