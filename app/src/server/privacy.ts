import "server-only";
import { asAccount, asAdmin, pgCode, type Tx } from "./db";
import { deleteFiles, keyFromUrl } from "./storage";

// Data rights (DPDP Act): a copy of a family's data, and deleting it for good.
// Members do this for their own number; a sangh admin does it for a family that asks them.

export type FamilyExport = {
  exportedAt: string;
  sangh: { name: string; city: string };
  phone: string;
  joinedAt: string;
  people: {
    name: string; relation: "self" | "child"; class: string | null; joinedAt: string; consentAt: string | null;
    answers: Record<string, unknown>;
    logs: { date: string; niyam: string; done: boolean; value: number | null; choice: string | null }[];
    attendance: { date: string; status: string }[];
  }[];
};

/** Everything kept about one family. Runs inside the caller's role, so row-level security still applies. */
async function collect(tx: Tx, accountId: string): Promise<FamilyExport | null> {
  const [a] = await tx`
    select coalesce(a.phone, a.removed_phone) as phone, a.created_at, s.name, s.city
    from public.accounts a join public.sanghs s on s.id = a.sangh_id where a.id = ${accountId}`;
  if (!a) return null;
  const people = await tx`
    select p.id, p.name, p.relation, c.name as class, p.created_at, p.consent_at, coalesce(pa.answers, '{}') as answers
    from public.profiles p
    left join public.classes c on c.id = p.class_id
    left join public.profile_answers pa on pa.profile_id = p.id
    where p.account_id = ${accountId} order by p.created_at`;
  const logs = await tx`
    select l.profile_id, l.log_date::text as date, n.name as niyam, l.done, l.value, l.choice
    from public.niyam_logs l join public.niyams n on n.id = l.niyam_id
    where l.profile_id = any(${people.map((p) => p.id)}::uuid[]) order by l.log_date, n.name`;
  const att = await tx`
    select profile_id, day::text as date, status from public.attendance
    where profile_id = any(${people.map((p) => p.id)}::uuid[]) order by day`;
  return {
    exportedAt: new Date().toISOString(),
    sangh: { name: a.name, city: a.city },
    phone: a.phone,
    joinedAt: new Date(a.created_at).toISOString(),
    people: people.map((p) => ({
      name: p.name, relation: p.relation, class: p.class, joinedAt: new Date(p.created_at).toISOString(),
      consentAt: p.consent_at ? new Date(p.consent_at).toISOString() : null,
      answers: p.answers,
      logs: logs.filter((l) => l.profile_id === p.id).map((l) => ({ date: l.date, niyam: l.niyam, done: l.done, value: l.value, choice: l.choice })),
      attendance: att.filter((x) => x.profile_id === p.id).map((x) => ({ date: x.date, status: x.status })),
    })),
  };
}

export const exportMyData = (accountId: string) => asAccount(accountId, (tx) => collect(tx, accountId));

/** A family's data for one of this admin's sanghs, or null if it isn't theirs. */
export async function adminExportFamily(phone: string, sanghId: string, accountId: string): Promise<FamilyExport | null> {
  return asAdmin(phone, async (tx) => {
    const [ok] = await tx`select 1 from public.accounts where id = ${accountId} and sangh_id = ${sanghId}`;
    return ok ? collect(tx, accountId) : null;
  });
}

const photoKeys = (tx: Tx, accountId: string) =>
  tx<{ photo_url: string | null }[]>`select photo_url from public.profiles where account_id = ${accountId} and photo_url is not null`;

/** Deletes the signed-in member's number, everyone on it and all their logs, now. */
export async function deleteMyAccount(accountId: string): Promise<boolean> {
  const { done, keys } = await asAccount(accountId, async (tx) => {
    const keys = (await photoKeys(tx, accountId)).map((r) => keyFromUrl(r.photo_url)).filter((k): k is string => !!k);
    const [r] = await tx`select public.delete_my_account() as ok`;
    return { done: r.ok as boolean, keys };
  });
  if (done) await deleteFiles(keys);
  return done;
}

/** An admin deletes a family's data now, at the family's request. False if it isn't in this admin's sangh. */
export async function adminEraseFamily(phone: string, sanghId: string, accountId: string): Promise<boolean> {
  try {
    const { done, keys } = await asAdmin(phone, async (tx) => {
      const [mine] = await tx`select 1 from public.accounts where id = ${accountId} and sangh_id = ${sanghId}`;
      if (!mine) return { done: false, keys: [] as string[] };
      const keys = (await photoKeys(tx, accountId)).map((r) => keyFromUrl(r.photo_url)).filter((k): k is string => !!k);
      const [r] = await tx`select public.admin_erase_family(${accountId}) as ok`;
      return { done: r.ok as boolean, keys };
    });
    if (done) await deleteFiles(keys);
    return done;
  } catch (e) {
    if (pgCode(e) === "42501") return false;
    throw e;
  }
}
