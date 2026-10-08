/* Check of edits round 2 against the real base: quota → license → request linked to a batch, product/country checks,
 * two products under one batch number. Creates test records and deletes them at the end.
 * Run: npx tsx scripts/quota-batch-check.mts   (reads .env.local) */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { loadTables, saveRecord, saveBatch } = await import("../app/actions");
const { deleteRecord, updateRecord } = await import("../lib/teable");
const schema = (k: string) => JSON.parse(readFileSync(`schema/${k}.json`, "utf8")) as { id: string; fields: { id: string; type: string; options: any }[] };
async function safeDelete(table: string, id: string) {
  const links = schema(table).fields.filter((f) => f.type === "link" && String(f.options?.foreignKeyName ?? "").startsWith("__fk_"));
  if (links.length) await updateRecord(schema(table).id, id, Object.fromEntries(links.map((f) => [f.id, null])));
  await deleteRecord(schema(table).id, id);
}
type Row = Record<string, unknown> & { id: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const rejects = async (name: string, fn: () => Promise<unknown>, pattern: RegExp) => {
  try { await fn(); ok(name, false, "no error"); } catch (e) { ok(name, pattern.test(String((e as Error).message)), String((e as Error).message)); }
};
const created: { table: string; id: string }[] = [];
const track = (table: string, id: string) => { created.push({ table, id }); return id; };
const load = async () => { await sleep(3000); return (await loadTables(["products", "quotas", "licenses", "requests", "batches"])).data as unknown as Record<string, Row[]>; };

try {
  let d = await load();
  const product = (name: string) => d.products.find((p) => p["Название"] === name)!.id;
  const shoulder = product("Плечо"), thigh = product("Бедро");
  const quota = track("quotas", await saveRecord("quotas", { "Квота": "ТЕСТ-квота", "Объём, кг": 10000, "Товар": shoulder, "Страна": "РФ", "Дата": "2026-10-08" }));
  const license = track("licenses", await saveRecord("licenses", { "Лицензия": "ТЕСТ-Л", "Квота": quota, "Объём, кг": 6000, "Дата": "2026-10-08" }));
  await rejects("лицензия на другой товар отклонена", () => saveRecord("licenses", { "Лицензия": "ТЕСТ-Л2", "Квота": quota, "Товар": thigh, "Объём, кг": 100 }), /другой вид товара/);
  const request = track("requests", await saveRecord("requests", { "Заявка": "ТЕСТ-З", "Лицензия": license, "Объём, кг": 3000, "Статус": "Открыта", "Дата": "2026-10-08" }));
  d = await load();
  const lic = d.licenses.find((l) => l.id === license)!, req = d.requests.find((r) => r.id === request)!;
  ok("лицензия унаследовала товар и страну квоты", lic["ТоварId"] === shoulder && lic["Страна"] === "РФ");
  ok("заявка унаследовала товар и страну лицензии", req["ТоварId"] === shoulder && req["Страна"] === "РФ");

  const base = { "Номер партии": "ТЕСТ-1", "Страна": "РФ", "Статус": "Предоплата", "Кг": 1000, "Цена ₽/кг": 167, "Курс ₽→сом": 1.055, "Логистика, сом/кг": 16.66, "Выгрузка / логистика": 16660, "Цена продажи сом/кг": 235 };
  await rejects("заявка на плечо к партии с бедром отклонена", () => saveBatch({ ...base, "Товар": thigh, "Заявка": request }), /другой вид товара/);
  const batch = track("batches", await saveBatch({ ...base, "Товар": shoulder, "Заявка": request }));
  const second = track("batches", await saveBatch({ ...base, "Товар": thigh, "Кг": 500 }));
  d = await load();
  const b = d.batches.find((x) => x.id === batch)!;
  ok("партия получила лицензию и квоту из заявки", b["ЛицензияId"] === license && b["КвотаId"] === quota);
  ok("заявка привязана к партии", d.requests.find((r) => r.id === request)!["ПартияId"] === batch);
  ok("два вида товара под одним номером партии", d.batches.filter((x) => x["Номер партии"] === "ТЕСТ-1").length === 2);
  await rejects("та же заявка ко второй партии отклонена", () => saveBatch({ "Заявка": request }, second), /другой партии|другой вид товара/);
  await saveBatch({ "Заявка": "" }, batch);
  d = await load();
  ok("заявка отвязана при очистке поля", !d.requests.find((r) => r.id === request)!["ПартияId"]);
  await saveRecord("requests", { "Заявка": "ТЕСТ-З", "Лицензия": license, "Объём, кг": 3000, "Партия": batch }, request);
  d = await load();
  ok("привязка из раздела квот ставит лицензию на партию", d.batches.find((x) => x.id === batch)!["ЛицензияId"] === license);
} catch (error) {
  failures++; console.error("ERROR", error);
} finally {
  for (const { table, id } of created.reverse()) {
    try { await safeDelete(table, id); console.log("  deleted", table, id); } catch (e) { failures++; console.error("  delete failed", table, id, e); }
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
