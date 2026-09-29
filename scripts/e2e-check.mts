/* End-to-end check against the real Tablox base using the app's server code.
 * Creates test records, verifies formulas/rollups and summary deltas, then deletes everything it created.
 * Run: npx tsx scripts/e2e-check.mts   (reads .env.local) */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const { loadDashboard, saveRecord, createMovement, receiveBatch, payTax } = await import("../app/actions");
const { calculateSummary, batchEstimates } = await import("../app/finance");
const { deleteRecord, updateRecord } = await import("../lib/teable");
const { request } = await import("../lib/request");
const schema = (k: string) => JSON.parse(readFileSync(`schema/${k}.json`, "utf8")) as { id: string; fields: { id: string; type: string; options: any }[] };
// Tablox keeps stale parent rollups if a linked record is deleted — clear own links first
async function safeDelete(table: string, id: string) {
  const links = schema(table).fields.filter((f) => f.type === "link" && String(f.options?.foreignKeyName ?? "").startsWith("__fk_"));
  if (links.length) await updateRecord(schema(table).id, id, Object.fromEntries(links.map((f) => [f.id, null])));
  await deleteRecord(schema(table).id, id);
}
void request;

type Row = Record<string, unknown> & { id: string };
const n = (v: unknown) => Number(v) || 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, actual: number, expected: number, tol = 0.51) => {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "  OK " : "  FAIL"} ${name}: ${actual} ${ok ? "=" : "≠"} ${expected}`);
};
const created: { table: string; id: string }[] = [];
const track = (table: string, id: unknown) => { if (typeof id === "string") created.push({ table, id }); return id as string; };
async function data() { await sleep(3500); return (await loadDashboard()).data as unknown as Record<string, Row[]>; }
const find = (rows: Row[], key: string, value: unknown) => { const r = rows.find((x) => x[key] === value); if (!r) throw new Error(`not found ${key}=${value}`); return r; };

let settingRow: Row | null = null;
try {
  let d = await data();
  const before = calculateSummary(d as never);
  console.log("BEFORE: оборот", Math.round(before.turnover), "капитал", Math.round(before.capital), "реальный $", before.realUsd?.toFixed(2));
  const duck = find(d.products, "Название", "Утка"), supplier = find(d.contacts, "Название", "Поставщик Китай");
  const client = find(d.contacts, "Название", "Абу"), cash = find(d.accounts, "Название", "Наличные · Бактияр");
  const duck0 = { kg: n(duck["Остаток, кг"]), value: n(duck["Стоимость остатка, сом"]) }, client0 = n(client["Баланс"]), cash0 = n(cash["Остаток"]), supplier0 = n(supplier["Баланс"]);

  console.log("1. Новая партия (Китай, в пути) с автозаполнением комиссии и НДС/НсП");
  const form: Record<string, unknown> = { "Номер партии": "E2E-TEST", "Страна": "Китай", "Статус": "В пути", "Товар": duck.id, "Поставщик": supplier.id, "Импортёр": "ОсОО «Эксперт компани»", "Дата предоплаты": "2026-09-01", "Кг": 1000, "Цена $/кг": 2, "Предоплата $": 1000, "Курс предоплаты": 87.5, "Постоплата $": 1000, "Курс постоплаты": 88, "Цена продажи сом/кг": 210, "Курс $ для отчёта": 88 };
  const est = batchEstimates(form, d as never);
  check("комиссия = 1000 $ × 0,75% × 88", n(est.commission), 660);
  check("НДС и НсП = 210 × 4% × 1000", n(est.tax), 8400);
  const batchId = track("batches", await saveRecord("batches", { ...form, "Комиссия за перевод": est.commission, "НДС и НсП": est.tax }));
  d = await data();
  let b = find(d.batches, "id", batchId);
  check("Оплачено поставщику", n(b["Оплачено поставщику, сом"]), 1000 * 87.5 + 1000 * 88);
  check("Себестоимость итого", n(b["Себестоимость итого, сом"]), 175500 + 660 + 8400);
  check("Себестоимость 1 кг", n(b["Себестоимость 1 кг, сом"]), 184.56, 0.01);
  check("Выручка (план)", n(b["Выручка, сом"]), 210000);
  check("Прибыль (план)", n(b["Прибыль, сом"]), 210000 - 184560);
  check("Долг поставщику $", n(b["Долг поставщику, $"]), 0);
  check("Аванс в пути", n(b["Аванс поставщику (в пути), сом"]), 175500);
  check("Баланс поставщика +аванс", n(find(d.contacts, "id", supplier.id)["Баланс"]), supplier0 + 175500);
  check("Сводка: в пути +175 500", calculateSummary(d as never).inTransit - before.inTransit, 175500);

  console.log("2. Принять на склад");
  track("movements", await receiveBatch(batchId));
  await sleep(3000);
  d = await data();
  b = find(d.batches, "id", batchId);
  const receipt = d.movements.find((m) => m["ПартияId"] === batchId && m["Тип"] === "Приход")!;
  console.log(`  статус: ${b["Статус"]}`);
  check("Приход кг", n(receipt["Кг"]), 1000);
  check("Приход коробок (кг / 10 кг в коробке)", n(receipt["Коробки"]), 100);
  check("Плановая цена прихода = цена продажи партии", n(receipt["Цена плановая продажная, сом/кг"]), 210);
  const duck1 = find(d.products, "id", duck.id);
  check("Утка: остаток +1000 кг", n(duck1["Остаток, кг"]) - duck0.kg, 1000);
  check("Утка: склад +210 000 (по плановой цене)", n(duck1["Стоимость остатка, сом"]) - duck0.value, 210000);
  check("Аванс в пути после приёмки", n(b["Аванс поставщику (в пути), сом"]), 0);
  check("Баланс поставщика вернулся", n(find(d.contacts, "id", supplier.id)["Баланс"]), supplier0);

  console.log("3. Отгрузка клиенту с партией (факт 220 при плане 210)");
  const shipId = track("movements", await createMovement({ "Дата": "2026-09-30", "Тип": "Отгрузка", "Товар": duck.id, "Контрагент": client.id, "Партия": batchId, "Коробки": 20, "Кг": 200, "Цена сом/кг": 220 }));
  d = await data();
  const ship = find(d.movements, "id", shipId);
  check("Плановая цена из партии", n(ship["Цена плановая продажная, сом/кг"]), 210);
  check("Сумма отгрузки", n(ship["Сумма, сом"]), 44000);
  check("Отклонение от плана (220−210)×200", n(ship["Отклонение от плана, сом"]), 2000);
  check("Долг Абу +44 000", n(find(d.contacts, "id", client.id)["Баланс"]) - client0, 44000);
  check("Утка: −200 кг от прихода", n(find(d.products, "id", duck.id)["Остаток, кг"]) - duck0.kg, 800);
  check("Утка: склад −42 000 по плановой цене", n(find(d.products, "id", duck.id)["Стоимость остатка, сом"]) - duck0.value, 168000);

  console.log("3b. Ручной приход без плановой цены");
  const rcId = track("movements", await createMovement({ "Дата": "2026-09-30", "Тип": "Приход", "Товар": duck.id, "Коробки": 5, "Кг": 50, "Цена сом/кг": 195 }));
  d = await data();
  check("План = цена прихода", n(find(d.movements, "id", rcId)["Цена плановая продажная, сом/кг"]), 195);
  check("Утка: склад +50×195", n(find(d.products, "id", duck.id)["Стоимость остатка, сом"]) - duck0.value, 168000 + 9750);
  console.log("4. Оплата от клиента наличными");
  track("payments", await saveRecord("payments", { "Дата": "2026-09-30", "Счёт": cash.id, "Направление": "Приход", "Контрагент": client.id, "Сумма": 44000, "Валюта": "сом", "Категория": "Оплата от клиента", "В расчёт с контрагентом": true }));
  d = await data();
  check("Долг Абу вернулся", n(find(d.contacts, "id", client.id)["Баланс"]), client0);
  check("Наличные Бактияр +44 000", n(find(d.accounts, "id", cash.id)["Остаток"]) - cash0, 44000);

  console.log("5. Плановый расход (налог): начисление 1000 и оплата 400");
  const taxId = track("taxes", await saveRecord("taxes", { "Основание": "E2E-TEST налог", "Дата": "2026-09-30", "Начислено, сом": 1000 }));
  track("payments", await payTax(taxId, cash.id, 400, "2026-09-30"));
  d = await data();
  const tax = find(d.taxes, "id", taxId);
  check("Налог: оплачено", n(tax["Оплачено, сом"]), 400);
  check("Налог: остаток к уплате", n(tax["Остаток к уплате, сом"]), 600);
  check("Наличные после налога", n(find(d.accounts, "id", cash.id)["Остаток"]) - cash0, 44000 - 400);
  let failedTax = false; try { await payTax(taxId, cash.id, 700, "2026-09-30"); } catch { failedTax = true; }
  check("Переплата налога запрещена", failedTax ? 1 : 0, 1);

  console.log("6. Сверка");
  const recId = track("reconciliations", await saveRecord("reconciliations", { "Партии в своде": "E2E-TEST", "Дата свода": "2026-09-30", "Остаток на начало, $": 100, "Прибыль по партиям, $": 20, "Факт остаток, $": 115, "Факт расходов, $": 3 }));
  d = await data();
  const rec = find(d.reconciliations, "id", recId);
  check("После поставки 100+20", n(rec["После поставки, $"]), 120);
  check("Расчётный остаток 120−3", n(rec["Расчётный остаток, $"]), 117);
  check("Расхождение 115−117", n(rec["Расхождение, $"]), -2);

  console.log("7. Квоты: квота 1000 → лицензия 600 → заявки");
  const entity = find(d.entities, "Название", "ОсОО «Эксперт компани»");
  const qId = track("quotas", await saveRecord("quotas", { "Квота": "E2E-TEST квота", "Объём, кг": 1000, "Юрлицо": entity.id, "Товар": duck.id, "Дата": "2026-09-30" }));
  let bad = false; try { await saveRecord("licenses", { "Лицензия": "E2E-Л", "Квота": qId, "Объём, кг": 1500 }); } catch { bad = true; }
  check("Лицензия больше квоты запрещена", bad ? 1 : 0, 1);
  const lId = track("licenses", await saveRecord("licenses", { "Лицензия": "E2E-Л", "Квота": qId, "Объём, кг": 600 }));
  await sleep(2500);
  bad = false; try { await saveRecord("requests", { "Заявка": "E2E-З0", "Лицензия": lId, "Объём, кг": 700 }); } catch { bad = true; }
  check("Заявка больше лицензии запрещена", bad ? 1 : 0, 1);
  track("requests", await saveRecord("requests", { "Заявка": "E2E-З1", "Лицензия": lId, "Объём, кг": 250, "Партия": batchId, "Номер машины": "E2E", "Статус": "Открыта" }));
  d = await data();
  const q = find(d.quotas, "id", qId), l = find(d.licenses, "id", lId);
  check("Лицензия: заявлено", n(l["Заявлено, кг"]), 250);
  check("Лицензия: остаток", n(l["Остаток, кг"]), 350);
  check("Квота: в лицензиях", n(q["В лицензиях, кг"]), 600);
  check("Квота: не распределено", n(q["Не распределено по лицензиям, кг"]), 400);
  check("Квота: остаток по заявкам", n(q["Остаток по заявкам, кг"]), 750);

  console.log("8. Настройка курса 88 → 90");
  settingRow = find(d.settings, "Параметр", "Курс $ для отчётов");
  await saveRecord("settings", { "Значение": 90 }, settingRow.id);
  d = await data();
  const s90 = calculateSummary(d as never);
  check("Капитал $ пересчитан по 90", n(s90.capitalUsd), s90.capital / 90, 0.01);
} catch (error) {
  failures++;
  console.error("ERROR", error);
} finally {
  console.log("CLEANUP");
  if (settingRow) await saveRecord("settings", { "Значение": n(settingRow["Значение"]) || 88 }, settingRow.id).catch((e) => console.error("restore setting", e));
  for (const { table, id } of [...created].reverse()) {
    try { await safeDelete(table, id); console.log("  deleted", table, id); } catch (e) { failures++; console.error("  delete failed", table, id, e); }
  }
  const d = await data();
  const after = calculateSummary(d as never);
  console.log("AFTER: оборот", Math.round(after.turnover), "капитал", Math.round(after.capital), "реальный $", after.realUsd?.toFixed(2));
  check("Оборот вернулся к 30 171 862", Math.round(after.turnover), 30171862, 1);
  check("Капитал вернулся к 36 753 318", Math.round(after.capital), 36753318, 1);
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}
