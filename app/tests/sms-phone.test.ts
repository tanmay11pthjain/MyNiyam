// Login codes sent by our own SMS phone (OTP_DELIVERY=phone), with a stand-in for the ntfy relay.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const posts: { path: string; body: { to: string; message: string; id: string } }[] = [];
let failNext = 0;
let statusLines: string[] = [];
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url?.includes("-status/json")) { res.end(statusLines.join("\n") + "\n"); return; }
      if (failNext > 0) { failNext--; res.statusCode = 429; res.end("{}"); return; }
      posts.push({ path: req.url ?? "", body: JSON.parse(data) });
      res.end('{"id":"x"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OTP_DELIVERY = "phone";
  process.env.SMS_PHONE_RELAY = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.SMS_PHONE_TOPIC = "myniyam-sms-testtopic123456";
});

afterAll(async () => {
  const { sql } = await import("@/server/db");
  await sql().end();
  server.close();
});

let n = 0;
const phone = () => `+9197${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;

describe("OTP by our SMS phone", () => {
  it("sends a random code to the phone's topic, logs it, and the code works", async () => {
    const { sendOtp, verifyOtp } = await import("@/server/otp");
    const { sql } = await import("@/server/db");
    const p = phone();
    const r = await sendOtp(p, "whatsapp");
    expect(r).toMatchObject({ ok: true, channel: "sms", simulated: false, sendsLeft: 2, resendAfterSec: 60 });
    const sent = posts.at(-1)!;
    expect(sent.path).toBe("/myniyam-sms-testtopic123456");
    expect(sent.body.to).toBe(p);
    const code = sent.body.message.match(/^(\d{4}) is your MyNiyam login code/)![1];
    const [row] = await sql()`select id, code, status, delivery from private.otp_log where phone = ${p}`;
    expect(row).toMatchObject({ code, status: "queued", delivery: "phone" });
    expect(sent.body.id).toBe(String(row.id));
    expect(await verifyOtp(p, code === "0000" ? "0001" : "0000")).toMatchObject({ ok: false, reason: "wrong_code" });
    expect(await verifyOtp(p, code)).toEqual({ ok: true });
  });

  it("a failed hand-over doesn't use up a code or start a wait", async () => {
    const { sendOtp } = await import("@/server/otp");
    const { sql } = await import("@/server/db");
    const p = phone();
    failNext = 1;
    expect(await sendOtp(p, "sms")).toEqual({ ok: false, reason: "send_failed" });
    const [row] = await sql()`select status, error from private.otp_log where phone = ${p}`;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/rate-limiting/);
    expect(await sendOtp(p, "sms")).toMatchObject({ ok: true, sendsLeft: 2 });
  });

  it("many people at once each get their own code", async () => {
    const { sendOtp } = await import("@/server/otp");
    const before = posts.length;
    const nums = Array.from({ length: 25 }, phone);
    const rs = await Promise.all(nums.map((p) => sendOtp(p, "sms")));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(new Set(posts.slice(before).map((x) => x.body.to))).toEqual(new Set(nums));
  });

  it("the OTP log picks up what the phone reported", async () => {
    const { sendOtp } = await import("@/server/otp");
    const { otpLog } = await import("@/server/otp-log");
    const a = phone(), b = phone();
    await sendOtp(a, "sms"); const idA = posts.at(-1)!.body.id;
    await sendOtp(b, "sms"); const idB = posts.at(-1)!.body.id;
    const t = Math.floor(Date.now() / 1000);
    const ev = (m: object) => JSON.stringify({ event: "message", time: t, message: JSON.stringify(m) });
    statusLines = [
      JSON.stringify({ event: "open" }),
      ev({ id: idA, status: "sent" }), ev({ id: idA, status: "delivered" }),
      ev({ id: idB, status: "failed", error: "No mobile network" }),
      ev({ id: null, status: "sent" }), "not json",
    ];
    const log = await otpLog(a.slice(-10));
    expect(log).toMatchObject({ delivery: "phone", relayOk: true });
    expect(log.lastPhoneReport).not.toBeNull();
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ phone: a, status: "delivered" });
    const lb = await otpLog(b);
    expect(lb.rows[0]).toMatchObject({ status: "failed", error: "No mobile network" });
  });
});
