// HTTP checks for every route against a running server with OTP_DELIVERY=simulate.
//   BASE_URL=http://localhost:3100 node scripts/api-check.mjs
// Uses made-up numbers in the +91 90000 xxxxx range. Run against local or a test deploy only.
const BASE = process.env.BASE_URL || "http://localhost:3100";
let failed = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? `  (${extra})` : ""}`); if (!cond) failed++; };

function jar() {
  let cookie = "";
  return async (path, { method, body, headers } = {}) => {
    const res = await fetch(BASE + path, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  };
}

const rnd = () => `90000${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
const a = jar();

// Health and headers
let r = await a("/healthz");
check("healthz 200", r.status === 200 && r.json?.db === "up");
check("CSP header", (r.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'"));
check("nosniff header", r.headers.get("x-content-type-options") === "nosniff");

// Deep link
r = await a("/j/heer01");
check("/j/CODE redirects to /join?code=", [307, 308].includes(r.status) && r.headers.get("location")?.includes("/join?code=heer01"));

// Lookup
r = await a("/api/sanghs/by-code/heer01");
check("code lookup is case-insensitive", r.status === 200 && r.json?.sangh?.joinCode === "HEER01");
check("lookup returns only public fields", r.json && Object.keys(r.json.sangh).sort().join() === "city,id,joinCode,logoUrl,name");
r = await a("/api/sanghs/by-code/NOPE99");
check("unknown code 404", r.status === 404 && r.json?.error === "code_not_found" && !!r.json?.requestId);
r = await a("/api/sanghs/by-code/abc");
check("malformed code 400", r.status === 400 && r.json?.error === "invalid_code");
r = await a("/api/sanghs/search?q=heer&city=mumbai");
check("search with city", r.status === 200 && r.json.sanghs.length === 1);

// OTP
const p1 = rnd();
r = await a("/api/otp/send", { body: { phone: "12345" } });
check("bad phone 400", r.status === 400 && r.json?.error === "invalid_phone");
r = await a("/api/otp/send", { body: "{not json" });
check("bad json 400", r.status === 400 && r.json?.error === "bad_request");
r = await a("/api/otp/send", { body: { phone: "9".repeat(20000) } });
check("oversized body 413", r.status === 413 && r.json?.error === "too_large");
r = await a("/api/otp/send", { body: { phone: p1, channel: "whatsapp" } });
check("send 200 (simulated)", r.status === 200 && r.json?.simulated === true && r.json?.resendAfterSec === 30, JSON.stringify(r.json));
r = await a("/api/otp/send", { body: { phone: p1, channel: "sms" } });
check("resend inside 30 s is 429 with Retry-After", r.status === 429 && Number(r.headers.get("retry-after")) > 0);

const heer = (await a("/api/sanghs/by-code/HEER01")).json.sangh;
const shan = (await a("/api/sanghs/by-code/SHAN01")).json.sangh;
r = await a("/api/otp/verify", { body: { intent: "join", phone: p1, code: "0000", sanghId: heer.id } });
check("wrong code 400 with attemptsLeft", r.status === 400 && r.json?.error === "wrong_code" && r.json?.attemptsLeft === 4);
r = await a("/api/me");
check("no session → 401", r.status === 401);
r = await a("/api/otp/verify", { body: { intent: "join", phone: p1, code: "1234", sanghId: heer.id } });
check("join 200 joined + cookie", r.status === 200 && r.json?.status === "joined");
r = await a("/api/otp/verify", { body: { intent: "join", phone: p1, code: "1234", sanghId: heer.id } });
check("code is single-use (410)", r.status === 410);

r = await a("/api/me");
check("me 200, phone masked", r.status === 200 && r.json.sangh.joinCode === "HEER01" && !r.json.phone.includes(p1.slice(2, 8)));
const classId = r.json.classes[0].id;

r = await a("/api/profiles", { body: { name: "Kid", relation: "child" } });
check("child without consent 400", r.status === 400 && r.json?.error === "consent_required");
r = await a("/api/profiles", { body: { name: "Kid", relation: "child", consent: true } });
check("child with consent 201", r.status === 201 && r.json.profile.relation === "child");
const kid = r.json.profile.id;
r = await a(`/api/profiles/${kid}`, { method: "PATCH", body: { classId, answers: {} } });
check("setup missing required answer 400", r.status === 400 && r.json?.fields?.area === "required");
r = await a(`/api/profiles/${kid}`, { method: "PATCH", body: { classId, answers: { area: "Malad", dob: "2016-02-03" } } });
check("setup 200", r.status === 200 && r.json.profile.setupDone === true);
r = await a("/api/profiles/00000000-0000-0000-0000-000000000000", { method: "PATCH", body: { classId, answers: { area: "x" } } });
check("setup someone else's / missing profile 404", r.status === 404);

// Same number tries another sangh (new browser)
const b = jar();
await new Promise((res) => setTimeout(res, 0));
await b("/api/sanghs/by-code/SHAN01");
// The 30 s resend wait applies per number, so use the next allowed send: wait it out via a fresh number instead.
const p2 = rnd();
await b("/api/otp/send", { body: { phone: p2 } });
await b("/api/otp/verify", { body: { intent: "join", phone: p2, code: "1234", sanghId: heer.id } });
await b("/api/session/logout", { body: {} });
// Now p2 belongs to HEER01; joining SHAN01 must answer 409 naming HEER01.
// (The per-number limit allows 3 sends per 10 minutes; this is send #2 for p2, after the 30 s wait.)
console.log("     …waiting 31 s for the resend timer");
await new Promise((res) => setTimeout(res, 31000));
r = await b("/api/otp/send", { body: { phone: p2 } });
check("second send after 30 s ok", r.status === 200);
r = await b("/api/otp/verify", { body: { intent: "join", phone: p2, code: "1234", sanghId: shan.id } });
check("number in another sangh → 409 other_sangh", r.status === 409 && r.json?.sangh?.joinCode === "HEER01");

// Login path for an unknown number
const c = jar();
const p3 = rnd();
await c("/api/otp/send", { body: { phone: p3 } });
r = await c("/api/otp/verify", { body: { intent: "login", phone: p3, code: "1234" } });
check("login with unknown number → 404 not_member", r.status === 404 && r.json?.error === "not_member");

// Admin endpoint without rights
r = await a("/api/admin/remove-number", { body: { phone: p2 } });
check("non-admin remove-number 403", r.status === 403);

// Per-IP lookup limit (30 per minute) — run last, it blocks lookups from this IP for up to a minute.
const burst = await Promise.all(Array.from({ length: 35 }, () => c("/api/sanghs/by-code/HEER01")));
check("per-IP lookup limit returns 429", burst.some((x) => x.status === 429));

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
