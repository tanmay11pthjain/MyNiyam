import "server-only";
import { asAdmin } from "../db";
import type { AdminBoard } from "@/lib/admin-types";

// The class board for admins (and volunteers who may view members): Tej earned between two dates,
// days kept breaking a tie. Feeds the "Generate poster" picture of the top 3.

export const MAX_RANGE_DAYS = 366;

/** null: not this person's class, or a bad range (to before from, longer than a year, or in the future). */
export async function getBoard(phone: string, sanghId: string, classId: string | null, from: string | null, to: string | null): Promise<AdminBoard | null> {
  return asAdmin(phone, async (tx) => {
    const classes = await tx<{ id: string; name: string; leaderboard: boolean }[]>`
      select id, name, leaderboard from public.classes
      where sangh_id = ${sanghId} and private.has_perm(sangh_id, 'view_members') and private.class_in_scope(sangh_id, id)
      order by sort_order, name`;
    const cls = classId ? classes.find((c) => c.id === classId) : classes[0];
    if (classId && !cls) return null;
    // No dates: this week, Monday to today.
    const [w] = await tx<{ from: string; to: string; today: string; sangh: string }[]>`
      select coalesce(${from}::date, private.local_today() - (extract(isodow from private.local_today())::int - 1))::text as from,
        coalesce(${to}::date, private.local_today())::text as to, private.local_today()::text as today,
        (select name from public.sanghs where id = ${sanghId}) as sangh`;
    const span = (Date.parse(w.to) - Date.parse(w.from)) / 864e5 + 1;
    if (span < 1 || span > MAX_RANGE_DAYS || w.from > w.today) return null;
    const rows = cls ? await tx<{ rank: number; profile_id: string; name: string; photo_url: string | null; points: number; days: number }[]>`
      select * from public.admin_class_points(${cls.id}, ${w.from}::date, ${w.to}::date)` : [];
    return {
      sangh: w.sangh, classes: classes.map((c) => ({ id: c.id, name: c.name, on: c.leaderboard })), classId: cls?.id ?? null,
      from: w.from, to: w.to, today: w.today,
      rows: rows.map((r) => ({ rank: r.rank, id: r.profile_id, name: r.name, photoUrl: r.photo_url, points: r.points, days: r.days })),
    };
  });
}
