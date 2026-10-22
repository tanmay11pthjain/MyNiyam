// Attendance: teachers take it for their own classes, holidays never count, members see their own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh } from "@/server/onboarding";
import { clearMarks, getMonth, getSheet, saveMarks, setHoliday } from "@/server/admin/attendance";
import { saveVolunteer } from "@/server/admin/volunteers";
import { getHistory } from "@/server/today";
import { exportMyData } from "@/server/privacy";

let n = 0;
const phone = () => `+9192${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, classA: string, classB: string, today: string, yesterday: string;
const admin = phone();

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin})`;
  [classA, classB] = (await sql()`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`).map((r) => r.id);
  [{ today, yesterday }] = await sql()`select private.local_today()::text as today, (private.local_today() - 1)::text as yesterday`;
});
afterAll(async () => { await sql().end(); });

async function member(classId: string, name: string) {
  const p = phone();
  const r = await joinSangh(p, heer);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name, relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  await sql()`update public.profiles set class_id = ${classId} where id = ${prof.profile.id}`;
  return { accountId: r.accountId, id: prof.profile.id };
}

describe("attendance", () => {
  it("lists the class with nothing marked, saves marks and changes them", async () => {
    const a = await member(classA, "Aarav Att");
    const sheet = (await getSheet(admin, heer, classA, yesterday))!;
    expect(sheet.people.find((p) => p.id === a.id)?.status).toBeNull();
    expect(await saveMarks(admin, heer, { classId: classA, day: yesterday, marks: [{ profileId: a.id, status: "late" }] })).toBe("ok");
    expect((await getSheet(admin, heer, classA, yesterday))!.people.find((p) => p.id === a.id)?.status).toBe("late");
    expect(await saveMarks(admin, heer, { classId: classA, day: yesterday, marks: [{ profileId: a.id, status: "present" }] })).toBe("ok");
    const after = (await getSheet(admin, heer, classA, yesterday))!;
    expect(after.taken).toBe(true);
    expect(after.people.find((p) => p.id === a.id)?.status).toBe("present");
  });

  it("never the future, never more than 30 days back", async () => {
    const a = await member(classA, "Date Check");
    const [{ tomorrow, old }] = await sql()`select (private.local_today() + 1)::text as tomorrow, (private.local_today() - 31)::text as old`;
    expect(await getSheet(admin, heer, classA, tomorrow)).toBeNull();
    expect(await saveMarks(admin, heer, { classId: classA, day: tomorrow, marks: [{ profileId: a.id, status: "present" }] })).toBe("day_out_of_range");
    expect(await saveMarks(admin, heer, { classId: classA, day: old, marks: [{ profileId: a.id, status: "present" }] })).toBe("day_out_of_range");
  });

  it("a teacher takes it only for their classes, and only with the attendance permission", async () => {
    const a = await member(classA, "Teacher A kid");
    const b = await member(classB, "Teacher B kid");
    const teacher = phone();
    expect(await saveVolunteer(admin, heer, { phone: teacher, name: "Class A teacher", classIds: [classA], perms: ["attendance"] })).toBe("ok");
    const sheet = (await getSheet(teacher, heer, null, today))!;
    expect(sheet.classes.map((c) => c.id)).toEqual([classA]);
    expect(await getSheet(teacher, heer, classB, today)).toBeNull();
    expect(await saveMarks(teacher, heer, { classId: classA, day: today, marks: [{ profileId: b.id, status: "absent" }] })).toBe("not_found");
    expect(await saveMarks(teacher, heer, { classId: classA, day: today, marks: [{ profileId: a.id, status: "absent" }] })).toBe("ok");

    const viewer = phone();
    expect(await saveVolunteer(admin, heer, { phone: viewer, name: "Viewer", classIds: [classA], perms: ["view_members"] })).toBe("ok");
    expect((await getSheet(viewer, heer, null, today))!.classes).toEqual([]);
    expect(await saveMarks(viewer, heer, { classId: classA, day: today, marks: [{ profileId: a.id, status: "present" }] })).toBe("not_found");
    // A teacher can't set a holiday for the whole pathshala.
    await expect(setHoliday(teacher, heer, today, true, null)).rejects.toThrow();
  });

  it("the month report counts present and late as came, and skips holidays", async () => {
    const [{ cls }] = await sql()`insert into public.classes (sangh_id, name) values (${heer}, ${"Att class " + n++}) returning id as cls`;
    const a = await member(cls, "Month A");
    const b = await member(cls, "Month B");
    await saveMarks(admin, heer, { classId: cls, day: today, marks: [{ profileId: a.id, status: "present" }, { profileId: b.id, status: "absent" }] });
    let m = (await getMonth(admin, heer, cls, today.slice(0, 7)))!;
    const byId = (id: string) => m.people.find((p) => p.id === id)!;
    expect(byId(a.id).pct).toBe(100);
    expect(byId(b.id).pct).toBe(0);
    expect(m.days.find((d) => d.day === today)).toEqual({ day: today, came: 1, total: 2 });

    expect(await setHoliday(admin, heer, today, true, "Test holiday")).toBe(true);
    m = (await getMonth(admin, heer, cls, today.slice(0, 7)))!;
    expect(m.days.find((d) => d.day === today)).toBeUndefined();
    expect(m.holidays.some((h) => h.day === today && h.note === "Test holiday")).toBe(true);
    expect((await getSheet(admin, heer, cls, today))!.holiday).toEqual({ note: "Test holiday" });
    await setHoliday(admin, heer, today, false, null);

    await clearMarks(admin, heer, cls, today);
    expect((await getSheet(admin, heer, cls, today))!.taken).toBe(false);
  });

  it("a member sees their own attendance in History and in their data download", async () => {
    const a = await member(classA, "History Att");
    await saveMarks(admin, heer, { classId: classA, day: today, marks: [{ profileId: a.id, status: "late" }] });
    const h = (await getHistory(a.accountId, a.id, today.slice(0, 7)))!;
    expect(h.days.find((d) => d.date === today)?.attendance).toBe("late");
    expect(h.attendance).toEqual({ present: 0, late: 1, absent: 0 });
    const data = (await exportMyData(a.accountId))!;
    expect(data.people[0].attendance).toEqual([{ date: today, status: "late" }]);
  });
});
