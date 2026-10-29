import "server-only";
import { asAdmin } from "../db";
import type { AdminBoard } from "@/lib/admin-types";

// The weekly class board for admins (and volunteers who may view members): days with a niyam kept,
// Monday to Sunday. Feeds the "Generate poster" picture of the top 3.

export async function getBoard(phone: string, sanghId: string, classId: string | null, week: "this" | "last"): Promise<AdminBoard | null> {
  return asAdmin(phone, async (tx) => {
    const classes = await tx<{ id: string; name: string; leaderboard: boolean }[]>`
      select id, name, leaderboard from public.classes
      where sangh_id = ${sanghId} and private.has_perm(sangh_id, 'view_members') and private.class_in_scope(sangh_id, id)
      order by sort_order, name`;
    const cls = classId ? classes.find((c) => c.id === classId) : classes[0];
    if (classId && !cls) return null;
    const [w] = await tx<{ start: string; end: string; sangh: string }[]>`
      with t as (select private.local_today() - (extract(isodow from private.local_today())::int - 1) - ${week === "last" ? 7 : 0}::int as s)
      select t.s::text as start, (t.s + 6)::text as end, (select name from public.sanghs where id = ${sanghId}) as sangh from t`;
    const rows = cls ? await tx<{ rank: number; profile_id: string; name: string; photo_url: string | null; days: number }[]>`
      select * from public.admin_class_week(${cls.id}, ${w.start}::date)` : [];
    return {
      sangh: w.sangh, classes: classes.map((c) => ({ id: c.id, name: c.name, on: c.leaderboard })), classId: cls?.id ?? null,
      week, weekStart: w.start, weekEnd: w.end,
      rows: rows.map((r) => ({ rank: r.rank, id: r.profile_id, name: r.name, photoUrl: r.photo_url, days: r.days })),
    };
  });
}
