/* CRUD check against the real base: create / edit / delete through the app's server actions, the guards that block
 * deleting referenced records, and that balances follow edits and deletions. Everything it creates is deleted.
 * Run: npx tsx scripts/crud-check.mts   (reads .env.local; TEABLE_BASE_ID=… to run on another base) */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { loadTables, saveRecord, createMovement, updateMovement, deleteEntity, saveBatch } = await import("../app/actions");
type Row = Record<string, unknown> & { id: string };
type Key = Parameters<typeof deleteEntity>[0];
const n = (v: unknown) => Number(v) || 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const rejects = async (name: string, fn: () => Promise<unknown>, pattern: RegExp) => {
  try { await fn(); ok(name, false, "no error"); } catch (e) { ok(name, pattern.test(String((e as Error).message)), String((e as Error).message)); }
};
const created: { key: Key; id: string }[] = [];
const track = (key: Key, id: string) => { created.push({ key, id }); return id; };
const forget = (id: string) => { const i = created.findIndex((c) => c.id === id); if (i >= 0) created.splice(i, 1); };
const load = async () => { await sleep(8000); return (await loadTables(["products", "contacts", "accounts", "movements", "payments", "batches", "taxes"])).data as unknown as Record<string, Row[]>; };
const find = (d: Record<string, Row[]>, key: string, id: string) => d[key].find((r) => r.id === id);

try {
  // products
  const product = track("products", await saveRecord("products", { "Название": "ТЕСТ-товар", "Категория": "Курица", "Кг в коробке": 10 }));
  await rejects("дубль названия товара отклонён", () => saveRecord("products", { "Название": "тест-ТОВАР" }), /уже есть/);
  await saveRecord("products", { "Название": "ТЕСТ-товар 2", "Кг в коробке": 12 }, product);
  // contacts, accounts
  const contact = track("contacts", await saveRecord("contacts", { "Название": "ТЕСТ-клиент", "Тип": "Клиент", "Сальдо на начало": 1000 }));
  const account = track("accounts", await saveRecord("accounts", { "Название": "ТЕСТ-счёт", "Остаток на начало": 500, "Учитывать в сводке": false }));
  let d = await load();
  ok("товар переименован, кг в коробке изменены", find(d, "products", product)?.["Название"] === "ТЕСТ-товар 2" && n(find(d, "products", product)?.["Кг в коробке"]) === 12);
  ok("контрагент создан с сальдо", n(find(d, "contacts", contact)?.["Баланс"]) === 1000, String(find(d, "contacts", contact)?.["Баланс"]));

  // movements: receipt + shipment, edit, delete
  const receipt = track("movements", await createMovement({ "Дата": "2026-10-15", "Тип": "Приход", "Товар": product, "Кг": 100, "Коробки": 10, "Цена сом/кг": 200, "Цена плановая продажная, сом/кг": 200 }));
  await sleep(6000); // Tablox recomputes the stock a few seconds after the receipt
  const shipment = track("movements", await createMovement({ "Дата": "2026-10-15", "Тип": "Отгрузка", "Товар": product, "Контрагент": contact, "Кг": 40, "Коробки": 4, "Цена сом/кг": 210 }));
  d = await load();
  ok("остаток после прихода и отгрузки = 60 кг", n(find(d, "products", product)?.["Остаток, кг"]) === 60, String(find(d, "products", product)?.["Остаток, кг"]));
  ok("долг клиента = 1000 + 40 × 210", n(find(d, "contacts", contact)?.["Баланс"]) === 9400, String(find(d, "contacts", contact)?.["Баланс"]));
  await rejects("отгрузка больше остатка при изменении отклонена", () => updateMovement(shipment, { "Дата": "2026-10-15", "Товар": product, "Контрагент": contact, "Кг": 150, "Цена сом/кг": 210, "В расчёт с контрагентом": true }), /превышает остаток/);
  await updateMovement(shipment, { "Дата": "2026-10-15", "Товар": product, "Контрагент": contact, "Кг": 50, "Коробки": 5, "Цена сом/кг": 210, "В расчёт с контрагентом": true });
  d = await load();
  ok("после изменения отгрузки остаток = 50 кг", n(find(d, "products", product)?.["Остаток, кг"]) === 50, String(find(d, "products", product)?.["Остаток, кг"]));
  ok("после изменения отгрузки долг = 1000 + 50 × 210", n(find(d, "contacts", contact)?.["Баланс"]) === 11500, String(find(d, "contacts", contact)?.["Баланс"]));
  await rejects("товар с движениями не удаляется", () => deleteEntity("products", product), /ссылаются 2 движений/);
  await rejects("контрагент с отгрузкой не удаляется", () => deleteEntity("contacts", contact), /ссылаются/);

  // payments: create, edit amount, delete
  const payment = track("payments", await saveRecord("payments", { "Дата": "2026-10-15", "Счёт": account, "Направление": "Приход", "Сумма": 3000, "Валюта": "сом", "Категория": "Оплата от клиента", "Контрагент": contact, "В расчёт с контрагентом": true }));
  await saveRecord("payments", { "Дата": "2026-10-15", "Счёт": account, "Направление": "Приход", "Сумма": 5000, "Валюта": "сом", "Категория": "Оплата от клиента", "Контрагент": contact, "В расчёт с контрагентом": true }, payment);
  d = await load();
  ok("оплата изменена: счёт = 500 + 5000", n(find(d, "accounts", account)?.["Остаток"]) === 5500, String(find(d, "accounts", account)?.["Остаток"]));
  ok("оплата изменена: долг = 11500 − 5000", n(find(d, "contacts", contact)?.["Баланс"]) === 6500, String(find(d, "contacts", contact)?.["Баланс"]));
  await rejects("счёт с платежами не удаляется", () => deleteEntity("accounts", account), /ссылаются 1 платежей/);
  await deleteEntity("payments", payment); forget(payment);
  d = await load();
  ok("после удаления оплаты счёт = 500", n(find(d, "accounts", account)?.["Остаток"]) === 500, String(find(d, "accounts", account)?.["Остаток"]));
  ok("после удаления оплаты долг = 11500", n(find(d, "contacts", contact)?.["Баланс"]) === 11500, String(find(d, "contacts", contact)?.["Баланс"]));

  // batch with a receipt cannot be deleted; without — can
  const batch = track("batches", await saveBatch({ "Номер партии": "ТЕСТ-П", "Страна": "Китай", "Статус": "Предоплата", "Товар": product, "Кг": 10 }));
  await updateMovement(receipt, { "Дата": "2026-10-15", "Товар": product, "Партия": batch, "Кг": 100, "Коробки": 10, "Цена сом/кг": 200, "Цена плановая продажная, сом/кг": 200, "В расчёт с контрагентом": false });
  await rejects("партия с приходом не удаляется", () => deleteEntity("batches", batch), /движений склада/);

  // taxes: create, edit, paid tax not deletable
  const tax = track("taxes", await saveRecord("taxes", { "Основание": "ТЕСТ-налог", "Дата": "2026-10-15", "Начислено, сом": 1000 }));
  await saveRecord("taxes", { "Основание": "ТЕСТ-налог", "Дата": "2026-10-15", "Начислено, сом": 1000, "Оплачено, сом": 200 }, tax);
  await rejects("оплаченный налог не удаляется", () => deleteEntity("taxes", tax), /уже есть оплата/);
  await saveRecord("taxes", { "Основание": "ТЕСТ-налог", "Дата": "2026-10-15", "Начислено, сом": 1000, "Оплачено, сом": 0 }, tax);

  // delete chain in the right order: movements → batch → product / contact / account / tax
  for (const id of [shipment, receipt]) { await deleteEntity("movements", id); forget(id); }
  for (const [key, id] of [["batches", batch], ["taxes", tax], ["products", product], ["contacts", contact], ["accounts", account]] as [Key, string][]) { await deleteEntity(key, id); forget(id); }
  d = await load();
  ok("все тестовые записи удалены", ![product, contact, account, batch, tax].some((id) => ["products", "contacts", "accounts", "batches", "taxes"].some((k) => find(d, k, id))));
} catch (error) {
  failures++; console.error("ERROR", error);
} finally {
  for (const { key, id } of created.reverse()) {
    try { await deleteEntity(key, id); console.log("  cleanup deleted", key, id); } catch (e) { console.error("  cleanup failed", key, id, (e as Error).message); }
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
