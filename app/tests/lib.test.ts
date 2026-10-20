import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, normalizeIndianPhone } from "@/lib/phone";
import { joinCodeFromScan, normalizeJoinCode } from "@/lib/join-code";
import { parseFormFields, validateAnswers } from "@/lib/forms";
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
    { key: "pic", type: "photo", label: { en: "Photo" } }, // not supported yet: dropped
    { nonsense: true },
  ]);
  const today = new Date("2026-10-20T00:00:00Z");

  it("keeps only known, well-formed fields", () => expect(fields.map((f) => f.key)).toEqual(["dob", "area", "std", "age"]));

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
