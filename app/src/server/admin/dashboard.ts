import "server-only";
import { asAdmin } from "../db";
import { getAlerts } from "./reports";
import type { Dashboard } from "@/lib/admin-types";

/** Today's numbers and the setup checklist for one sangh. "Today" is the Indian day. */
export async function getDashboard(phone: string, sanghId: string): Promise<Dashboard | null> {
  return asAdmin(phone, async (tx) => {
    const [s] = await tx`
      select name, join_code, status, form_updated_at, code_shared_at from public.sanghs
      where id = ${sanghId} and private.has_access(id)`;
    if (!s) return null;
    const [n] = await tx`
      with fam as (select id from public.accounts where sangh_id = ${sanghId} and removed_at is null),
           prof as (select p.id from public.profiles p join fam on fam.id = p.account_id where p.removed_at is null),
           today as (select l.profile_id, l.done from public.niyam_logs l join prof on prof.id = l.profile_id
                     where l.log_date = private.local_today())
      select (select count(*)::int from fam) as families,
             (select count(*)::int from prof) as profiles,
             (select count(distinct profile_id)::int from today) as logged_today,
             (select count(*)::int from today where done) as done_today,
             (select count(*)::int from public.classes where sangh_id = ${sanghId}) as classes,
             (select count(*)::int from public.niyams where sangh_id = ${sanghId} and status <> 'archived') as niyams,
             (select count(*)::int from public.niyams where sangh_id = ${sanghId} and status = 'active') as active_niyams`;
    return {
      sangh: { name: s.name, joinCode: s.join_code, status: s.status },
      families: n.families,
      profiles: n.profiles,
      loggedToday: n.logged_today,
      loggingPct: n.profiles ? Math.round((n.logged_today / n.profiles) * 100) : 0,
      niyamsDoneToday: n.done_today,
      activeNiyams: n.active_niyams,
      checklist: { classes: n.classes > 0, form: s.form_updated_at !== null, niyams: n.niyams > 0, share: s.code_shared_at !== null },
      alerts: await getAlerts(tx, sanghId),
    };
  });
}
