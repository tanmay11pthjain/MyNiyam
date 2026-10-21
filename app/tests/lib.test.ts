import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, normalizeIndianPhone } from "@/lib/phone";
import { joinCodeFromScan, normalizeJoinCode } from "@/lib/join-code";
import { ageFrom, checkFormFields, missingRequired, parseFormFields, validateAnswers } from "@/lib/forms";
import { OTP_LENGTH, OTP_PATTERN } from "@/lib/otp-code";

describe("phone", () => {
  it.each([
    ["9820012345", "+919820012345"],
    ["98200 12345", "+919820012345"],
    ["+91 98200-12345", "+919820012345"],
    ["919820012345", "+919820012345"],
    ["09820012345", "+919820012345"],
  ])("normalises %s", (input, out) => expect(normalizeIndianPhone(input)).toBe(out));

  it.each(["", "12345", "5820012345", "98200123456", "+1 415 555 0100", "abcdefghij"])("rejects %s", (input) =>
    expect(normalizeIndianPhone(input)).toBeNull());

  it("formats and masks", () => {
    expect(formatPhone("+919820012345")).toBe("+91 98200 12345");
    expect(maskPhone("+919820012345")).toBe("+91 98•••••345");
  });
});

describe("login code", () => {
  it("is exactly 4 digits", () => {
    expect(OTP_LENGTH).toBe(4);
    expect(OTP_PATTERN.test("1234")).toBe(true);
    expect(OTP_PATTERN.test("0000")).toBe(true);
    for (const bad of ["123", "12345", "123456", "dddd", "12a4", " 1234", ""]) expect(OTP_PATTERN.test(bad)).toBe(false);
  });
});

describe("join code", () => {
  it("is case-insensitive and ignores spaces", () => {
    expect(normalizeJoinCode("heer01")).toBe("HEER01");
    expect(normalizeJoinCode(" hee r-01 ")).toBe("HEER01");
  });
  it("needs exactly 6 letters or numbers", () => {
    expect(normalizeJoinCode("HEER1")).toBeNull();
    expect(normalizeJoinCode("HEER011")).toBeNull();
    expect(normalizeJoinCode("HEER_1")).toBeNull();
  });
  it("reads codes from QR contents", () => {
    expect(joinCodeFromScan("https://app.myniyam.in/j/heer01")).toBe("HEER01");
    expect(joinCodeFromScan("https://app.myniyam.in/j/HEER01/")).toBe("HEER01");
    expect(joinCodeFromScan("https://app.myniyam.in/join?code=HEER01")).toBe("HEER01");
    expect(joinCodeFromScan("HEER01")).toBe("HEER01");
    expect(joinCodeFromScan("https://example.com/menu")).toBeNull();
    expect(joinCodeFromScan("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
  });
});

describe("form fields", () => {
  const fields = parseFormFields([
    { key: "dob", type: "date", label: { en: "DOB" } },
    { key: "area", type: "text", required: true, max: 10, label: { en: "Area" } },
    { key: "std", type: "select", label: { en: "Std" }, options: [{ value: "1-4", en: "1 to 4" }] },
    { key: "age", type: "number", min: 3, max: 99, label: { en: "Age" } },
    { key: "pic", type: "photo", label: { en: "Photo" } }, // answered by upload, not in answers
    { key: "pic2", type: "hologram", label: { en: "?" } }, // unknown type: dropped
    { nonsense: true },
  ]);
  const today = new Date("2026-10-20T00:00:00Z");

  it("keeps only known, well-formed fields", () => expect(fields.map((f) => f.key)).toEqual(["dob", "area", "std", "age", "pic"]));

  it("accepts good answers and drops unknown keys", () => {
    const r = validateAnswers(fields, { dob: "2015-04-01", area: " Malad ", std: "1-4", age: "11", extra: "x" }, today);
    expect(r).toEqual({ ok: true, answers: { dob: "2015-04-01", area: "Malad", std: "1-4", age: 11 } });
  });

  it("reports each bad answer", () => {
    const r = validateAnswers(fields, { dob: "2030-01-01", area: "", std: "9-12", age: "200" }, today);
    expect(r).toEqual({ ok: false, errors: { dob: "bad_date", area: "required", std: "bad_option", age: "out_of_range" } });
  });

  it("treats optional blanks as skipped", () => {
    expect(validateAnswers(fields, { area: "Pune" }, today)).toEqual({ ok: true, answers: { area: "Pune" } });
  });
});

describe("join form builder", () => {
  it("keeps a standard field's type and options, but takes the admin's labels and required flag", () => {
    const r = checkFormFields([{ key: "gender", type: "select", required: true, label: { en: "Boy or girl" }, options: [{ value: "x", en: "X" }] }]);
    expect(r.ok && r.fields[0]).toMatchObject({ key: "gender", required: true, label: { en: "Boy or girl" }, options: [{ value: "male" }, { value: "female" }] });
  });
  it("refuses wrong types, duplicate keys and custom fields of standard-only types", () => {
    expect(checkFormFields([{ key: "dob", type: "text", label: { en: "x" } }])).toEqual({ ok: false, reason: "invalid_field" });
    expect(checkFormFields([{ key: "q_a", type: "yesno", label: { en: "A" } }, { key: "q_a", type: "yesno", label: { en: "B" } }])).toEqual({ ok: false, reason: "duplicate_key" });
    expect(checkFormFields([{ key: "q_pic", type: "photo", label: { en: "x" } }])).toEqual({ ok: false, reason: "invalid_field" });
  });
  it("checks yes/no and location answers", () => {
    const f = parseFormFields([{ key: "q", type: "yesno", label: { en: "Q" } }, { key: "gps", type: "gps", label: { en: "Where" } }]);
    expect(validateAnswers(f, { q: "yes", gps: "19.18,72.84" })).toEqual({ ok: true, answers: { q: "yes", gps: "19.18,72.84" } });
    expect(validateAnswers(f, { q: "maybe", gps: "999,1" })).toEqual({ ok: false, errors: { q: "bad_option", gps: "bad_location" } });
  });
  it("lists required questions not answered yet, including class and photo", () => {
    const f = parseFormFields([
      { key: "class", type: "class", required: true, label: { en: "Class" } },
      { key: "photo", type: "photo", required: true, label: { en: "Photo" } },
      { key: "q", type: "yesno", required: true, label: { en: "Q" } },
      { key: "opt", type: "text", label: { en: "Optional" } },
    ]);
    expect(missingRequired(f, { answers: {}, classId: null, photoUrl: null })).toEqual(["class", "photo", "q"]);
    expect(missingRequired(f, { answers: { q: "no" }, classId: "c", photoUrl: "/p.jpg" })).toEqual([]);
  });
  it("works out age from a birth date", () => {
    const today = new Date("2026-10-21T00:00:00Z");
    expect(ageFrom("2016-10-21", today)).toBe(10);
    expect(ageFrom("2016-10-22", today)).toBe(9);
    expect(ageFrom("nonsense", today)).toBeNull();
  });
});
