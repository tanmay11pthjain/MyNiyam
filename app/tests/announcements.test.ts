// Announcements: who sees which slide, how many, in what order, and view counts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db";
import { createProfile, findSanghByCode, joinSangh, setupProfile } from "@/server/onboarding";
import { markSeen } from "@/server/today";
import { getSanghTab } from "@/server/engage";
const getToday = getSanghTab; // slides show on the Sangh tab
import { createAnnouncement, deleteAnnouncement, getAnnouncements, updateAnnouncement } from "@/server/admin/announcements";
import { announcementInput } from "@/server/admin/announcements";

let n = 0;
const phone = () => `+9194${String(Date.now() % 1e6).padStart(6, "0")}${String(n++ % 100).padStart(2, "0")}`;
let heer: string, shan: string, cls: { id: string }[];
const admin = phone();
const shanAdmin = phone();
const slide = (x: Record<string, unknown>) => announcementInput.parse({ title: "Notice", imageUrl: `/api/files/photos/${heer}/${"a".repeat(24)}.jpg`, ...x });

beforeAll(async () => {
  heer = (await findSanghByCode("HEER01"))!.id;
  shan = (await findSanghByCode("SHAN01"))!.id;
  await sql()`insert into public.sangh_admins (sangh_id, phone) values (${heer}, ${admin}), (${shan}, ${shanAdmin})`;
  await sql()`delete from public.announcements where sangh_id = ${heer}`;
  cls = [...(await sql()`select id from public.classes where sangh_id = ${heer} order by sort_order limit 2`)] as { id: string }[];
});
afterAll(async () => { await sql().end(); });

async function member(classId: string) {
  const p = phone();
  const r = await joinSangh(p, heer);
  if (r.kind === "closed") throw new Error("closed");
  const prof = await createProfile(r.accountId, p, { name: "M", relation: "self", consent: false });
  if (!prof.ok) throw new Error("profile");
  const s = await setupProfile(r.accountId, prof.profile.id, classId, {});
  if (!s.ok) await sql()`update public.profiles set class_id = ${classId} where id = ${prof.profile.id}`;
  return { accountId: r.accountId, profileId: prof.profile.id };
}

describe("announcements", () => {
  it("rejects a button without a link, a non-https link and dates the wrong way round", () => {
    expect(announcementInput.safeParse({ title: "x", buttonLabel: "Go" }).success).toBe(false);
    expect(announcementInput.safeParse({ title: "x", buttonLabel: "Go", buttonUrl: "http://a.in" }).success).toBe(false);
    expect(announcementInput.safeParse({ title: "x", startDate: "2026-10-10", endDate: "2026-10-01" }).success).toBe(false);
    expect(announcementInput.safeParse({ title: "x" }).success).toBe(false); // a picture is required
    expect(slide({ title: "x" }).imageUrl).toBeTruthy();
  });

  it("shows members their class's live slides on the Sangh tab, pinned first; counts views", async () => {
    const [{ d }] = await sql()`select private.local_today()::text as d, (private.local_today() + 5)::text as later`;
    await createAnnouncement(admin, heer, slide({ title: "Everyone 1" }));
    await createAnnouncement(admin, heer, slide({ title: "Class B only", allClasses: false, classIds: [cls[1].id] }));
    await createAnnouncement(admin, heer, slide({ title: "Later", startDate: "2099-01-01" }));
    await createAnnouncement(admin, heer, slide({ title: "Everyone 2", endDate: d }));
    await createAnnouncement(admin, heer, slide({ title: "Everyone 3" }));
    const list = await createAnnouncement(admin, heer, slide({ title: "Pinned", pinned: true }));
    expect(list!.find((a) => a.title === "Later")!.state).toBe("scheduled");

    const m = await member(cls[0].id);
    const t = await getToday(m.accountId, m.profileId);
    expect(t!.announcements.map((a) => a.title)).toEqual(["Pinned", "Everyone 3", "Everyone 2", "Everyone 1"]);
    expect(t!.announcements.every((a) => !a.seen)).toBe(true);

    await markSeen(m.accountId, m.profileId, [t!.announcements[0].id]);
    await markSeen(m.accountId, m.profileId, [t!.announcements[0].id]); // twice counts once
    expect((await getToday(m.accountId, m.profileId))!.announcements[0].seen).toBe(false); // still in full today
    await sql()`update public.announcement_views set seen_at = now() - interval '1 day' where profile_id = ${m.profileId}`;
    expect((await getToday(m.accountId, m.profileId))!.announcements[0].seen).toBe(true); // one line from the next day
    const page = await getAnnouncements(admin, heer);
    expect(page.announcements.find((a) => a.title === "Pinned")!.views).toBe(1);

    // Pin the class B slide: class B sees it first, class A still never sees it.
    const bSlide = page.announcements.find((a) => a.title === "Class B only")!;
    await updateAnnouncement(admin, heer, bSlide.id, slide({ title: "Class B only", allClasses: false, classIds: [cls[1].id], pinned: true }));
    const b = await member(cls[1].id);
    expect((await getToday(b.accountId, b.profileId))!.announcements[0].title).toBe("Class B only");
    expect((await getToday(m.accountId, m.profileId))!.announcements.map((a) => a.title)).not.toContain("Class B only");
  });

  it("pinning one unpins the other, and other sanghs can't touch them", async () => {
    const list = await createAnnouncement(admin, heer, slide({ title: "New pin", pinned: true }));
    expect(list!.filter((a) => a.pinned).map((a) => a.title)).toEqual(["New pin"]);
    const id = list!.find((a) => a.title === "New pin")!.id;
    expect(await updateAnnouncement(shanAdmin, shan, id, slide({ title: "Hacked" }))).toBeNull();
    expect(await deleteAnnouncement(shanAdmin, shan, id)).toBeNull();
    expect(await createAnnouncement(admin, heer, slide({ imageUrl: `/api/files/photos/${shan}/x.jpg` }))).toBeNull();
    expect((await deleteAnnouncement(admin, heer, id))!.some((a) => a.id === id)).toBe(false);
  });
});
