/* Integrity check: recompute every rollup (sum/max) from child records and compare with the stored value.
 * Tablox does not recompute parent rollups when a child is deleted, so values can go stale.
 * Run: npx tsx scripts/check-rollups.mts          — report
 *      npx tsx scripts/check-rollups.mts --fix    — re-link a child to force recompute (or add+remove a dummy child) */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { request } = await import("../lib/request");
const FIX = process.argv.includes("--fix");
const base = process.env.TEABLE_BASE_ID!;
type Field = { id: string; name: string; type: string; options?: any; lookupOptions?: any };
type Rec = { id: string; fields: Record<string, any> };
const tables = await request<{ id: string; name: string }[]>(`/base/${base}/table`);
const fieldsOf = new Map<string, Field[]>();
const recsOf = new Map<string, Rec[]>();
for (const t of tables) {
  fieldsOf.set(t.id, await request<Field[]>(`/table/${t.id}/field`));
  const out: Rec[] = [];
  for (let skip = 0; ; skip += 1000) {
    const { records } = await request<{ records: Rec[] }>(`/table/${t.id}/record`, { params: { fieldKeyType: "id", take: 1000, skip } });
    out.push(...records); if (records.length < 1000) break;
  }
  recsOf.set(t.id, out);
}
const num = (v: unknown) => Number(v) || 0;
const linkIds = (v: any): string[] => v == null ? [] : (Array.isArray(v) ? v : [v]).map((x) => x.id);
let bad = 0, fixed = 0;
for (const t of tables) {
  for (const f of fieldsOf.get(t.id)!.filter((x) => x.type === "rollup")) {
    const { linkFieldId, lookupFieldId, foreignTableId } = f.lookupOptions;
    const link = fieldsOf.get(t.id)!.find((x) => x.id === linkFieldId)!;
    const back = link.options.symmetricFieldId as string;
    const children = recsOf.get(foreignTableId)!;
    const isMax = String(f.options.expression).startsWith("max");
    for (const parent of recsOf.get(t.id)!) {
      const mine = children.filter((c) => linkIds(c.fields[back]).includes(parent.id));
      const values = mine.map((c) => c.fields[lookupFieldId]).filter((v) => v != null);
      const expected = isMax ? (values.length ? values.map(String).sort().at(-1) : null) : values.reduce((s, v) => s + num(v), 0);
      const actual = parent.fields[f.id] ?? (isMax ? null : 0);
      const same = isMax ? String(expected ?? "").slice(0, 10) === String(actual ?? "").slice(0, 10) : Math.abs(num(actual) - num(expected)) < 0.01;
      if (same) continue;
      bad++;
      const title = Object.values(parent.fields).find((v) => typeof v === "string") ?? parent.id;
      console.log(`STALE ${t.name}.${f.name} «${title}»: stored ${actual}, expected ${expected}`);
      if (!FIX) continue;
      if (mine.length) {
        // changing a link forces the parent to recompute from all current children
        await request(`/table/${foreignTableId}/record/${mine[0].id}`, { method: "PATCH", body: { fieldKeyType: "id", record: { fields: { [back]: null } } } });
        await request(`/table/${foreignTableId}/record/${mine[0].id}`, { method: "PATCH", body: { fieldKeyType: "id", record: { fields: { [back]: { id: parent.id } } } } });
      } else {
        const { records } = await request<{ records: Rec[] }>(`/table/${foreignTableId}/record`, { method: "POST", body: { fieldKeyType: "id", records: [{ fields: { [back]: { id: parent.id } } }] } });
        await request(`/table/${foreignTableId}/record/${records[0].id}`, { method: "PATCH", body: { fieldKeyType: "id", record: { fields: { [back]: null } } } });
        await request(`/table/${foreignTableId}/record/${records[0].id}`, { method: "DELETE" });
      }
      fixed++;
    }
  }
}
console.log(bad ? `${bad} stale rollup value(s)${FIX ? `, ${fixed} fixed — re-run to confirm` : ""}` : "All rollups are consistent");
