"use server";

import { listRecords, getRecord, createRecord, updateRecord, deleteRecord, type RecordFields } from "@/lib/teable";
import { request } from "@/lib/request";
import products from "@/schema/products.json";
import accounts from "@/schema/accounts.json";
import contacts from "@/schema/contacts.json";
import batches from "@/schema/batches.json";
import movements from "@/schema/movements.json";
import payments from "@/schema/payments.json";
import taxes from "@/schema/taxes.json";
import reconciliations from "@/schema/reconciliations.json";
import settings from "@/schema/settings.json";
import entities from "@/schema/entities.json";
import quotas from "@/schema/quotas.json";
import licenses from "@/schema/licenses.json";
import requests from "@/schema/requests.json";
import snapshots from "@/schema/snapshots.json";
import { calculateSummary } from "./finance";

const schemas = { products, accounts, contacts, batches, movements, payments, taxes, reconciliations, settings, entities, quotas, licenses, requests, snapshots } as const;
export type TableKey = keyof typeof schemas;
export type Row = { id: string; [key: string]: unknown };
export type Dataset = Record<TableKey, Row[]>;
export type DataResult = { data: Dataset; errors: Partial<Record<TableKey, string>> };
type Field = { id: string; name: string; dbFieldName: string; type: string; options?: unknown };

// The same code can serve a copy of the base (e.g. the clean stand): table ids are resolved by table name
// when TEABLE_BASE_ID differs from the base the schema was generated from, and writes go by field name.
let tableIds: Promise<Record<string, string>> | null = null;
async function tableId(key: TableKey) {
  const base = process.env.TEABLE_BASE_ID;
  if (!base || schemas[key].dbTableName.startsWith(`${base}.`)) return schemas[key].id;
  tableIds ??= request<{ id: string; name: string }[]>(`/base/${base}/table`).then((list) => Object.fromEntries(list.map((t) => [t.name, t.id])));
  const ids = await tableIds.catch((error) => { tableIds = null; throw error; });
  if (!ids[schemas[key].name]) throw new Error(`В базе нет таблицы «${schemas[key].name}»`);
  return ids[schemas[key].name];
}
const create = async (key: TableKey, fields: RecordFields) => createRecord(await tableId(key), fields, "name");
const update = async (key: TableKey, id: string, fields: RecordFields) => updateRecord(await tableId(key), id, fields, "name");
const fields = (key: TableKey) => schemas[key].fields as Field[];
const field = (key: TableKey, name: string) => fields(key).find((f) => f.name === name);
const num = (v: unknown) => Number(v) || 0;
function isoDate(value: unknown) {
  const raw = String(value);
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Укажите дату в формате ДД.ММ.ГГГГ");
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== iso) throw new Error("Некорректная дата");
  return iso;
}

// manyOne links (this table holds the foreign key) are exposed as "<name>Id"
const isOwnLink = (f: Field) => f.type === "link" && typeof f.options === "object" && f.options !== null && "foreignKeyName" in f.options && String((f.options as { foreignKeyName: string }).foreignKeyName).startsWith("__fk_");
const linkId = (value: unknown) => {
  const v = Array.isArray(value) ? value[0] : value;
  return v && typeof v === "object" && "id" in v ? String((v as { id: string }).id) : null;
};
function toRow(key: TableKey, rec: { id: string; fields: Record<string, unknown> }): Row {
  const row: Row = { id: rec.id };
  for (const f of fields(key)) {
    if (f.type !== "link") row[f.name] = rec.fields[f.name] ?? null;
    else if (isOwnLink(f)) row[f.name + "Id"] = linkId(rec.fields[f.name]);
  }
  return row;
}

async function readTable(key: TableKey, ids?: string[]): Promise<Row[]> {
  const records = await listRecords(await tableId(key));
  const wanted = ids?.length ? new Set(ids) : null;
  return records.filter((r) => !wanted || wanted.has(r.id)).map((r) => toRow(key, r as { id: string; fields: Record<string, unknown> }));
}

export type TablesResult = { data: Partial<Dataset>; errors: DataResult["errors"] };

async function readWithRetry(key: TableKey, ids?: string[]): Promise<Row[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await readTable(key, ids); }
    catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 500 : 1000));
    }
  }
  throw new Error("Не удалось прочитать таблицу");
}

async function loadSelection(selection: Partial<Record<TableKey, string[]>>): Promise<TablesResult> {
  const keys = Object.keys(selection) as TableKey[];
  if (!keys.length || keys.some((key) => !Object.hasOwn(schemas, key))) throw new Error("Неизвестная таблица");
  const results: PromiseSettledResult<Row[]>[] = [];
  for (let i = 0; i < keys.length; i += 3) {
    results.push(...await Promise.allSettled(keys.slice(i, i + 3).map((key) => readWithRetry(key, selection[key]))));
  }
  const data: Partial<Dataset> = {};
  const errors: DataResult["errors"] = {};
  results.forEach((result, i) => {
    const key = keys[i];
    if (result.status === "fulfilled") data[key] = result.value;
    else {
      console.error(`Ошибка загрузки таблицы ${key}:`, result.reason);
      errors[key] = "Не удалось обновить данные. Повторите попытку.";
    }
  });
  return { data, errors };
}

export async function loadTables(keys: TableKey[]): Promise<TablesResult> {
  return loadSelection(Object.fromEntries([...new Set(keys)].map((key) => [key, undefined])));
}

export async function loadAffected(selection: Partial<Record<TableKey, string[]>>): Promise<TablesResult> {
  if (Object.entries(selection).some(([key, ids]) => !Object.hasOwn(schemas, key) || !Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => !/^rec[A-Za-z0-9]+$/.test(id)))) {
    throw new Error("Некорректные записи для обновления");
  }
  return loadSelection(selection);
}

export async function loadDashboard(): Promise<DataResult> {
  const result = await loadTables(Object.keys(schemas) as TableKey[]);
  return {
    data: Object.fromEntries((Object.keys(schemas) as TableKey[]).map((key) => [key, result.data[key] ?? []])) as Dataset,
    errors: result.errors,
  };
}

function writable(key: TableKey, input: Record<string, unknown>) {
  const output: RecordFields = {};
  for (const [name, value] of Object.entries(input)) {
    const f = field(key, name);
    if (!f || !["number", "singleLineText", "longText", "singleSelect", "date", "checkbox", "link"].includes(f.type)) throw new Error(`Поле «${name}» недоступно для записи`);
    if (f.type === "link") {
      const options = f.options as { foreignKeyName?: string } | undefined;
      if (!options?.foreignKeyName?.startsWith("__fk_")) throw new Error(`Связь «${name}» недоступна`);
      output[f.name] = value ? [String(value)] : null;
    } else if (f.type === "number") {
      if (value !== null && value !== "" && !Number.isFinite(Number(value))) throw new Error(`Некорректное число: ${name}`);
      output[f.name] = value === "" || value === null ? null : Number(value);
    } else if (f.type === "date") output[f.name] = value ? `${isoDate(value)}T00:00:00+06:00` : null;
    else if (f.type === "checkbox") output[f.name] = Boolean(value);
    else {
      if (f.type === "singleSelect" && value && !(f.options as string[]).includes(String(value))) throw new Error(`Недопустимое значение: ${name}`);
      output[f.name] = value == null || value === "" ? null : String(value);
    }
  }
  return output;
}

const recId = (id: unknown) => {
  const s = String(id);
  if (!/^rec[A-Za-z0-9]+$/.test(s)) throw new Error("Некорректный идентификатор записи");
  return s;
};
async function ensureLink(key: TableKey, id: unknown) {
  if (!id) return;
  if (!await getRecord(await tableId(key), recId(id))) throw new Error("Связанная запись не найдена");
}
async function readOne(key: TableKey, id: string, names: string[]) {
  const rec = await getRecord(await tableId(key), recId(id));
  if (!rec) throw new Error("Запись не найдена");
  const row = toRow(key, rec as { id: string; fields: Record<string, unknown> });
  return Object.fromEntries(names.map((name) => [name, row[name] ?? null]));
}

// Tablox does not recompute parent rollups when a linked record is deleted — only when links change.
// So links are cleared first (parents recompute), then the record is deleted.
async function deleteRecordSafe(key: TableKey, id: string) {
  const own = fields(key).filter(isOwnLink);
  if (own.length) await update(key, recId(id), Object.fromEntries(own.map((f) => [f.name, null])));
  await deleteRecord(await tableId(key), recId(id));
}

// a quota / license / request covers one product and one country; a child must not contradict its parent
function sameScope(parent: Record<string, unknown>, product: unknown, country: unknown, label: string) {
  if (parent["ТоварId"] && product && parent["ТоварId"] !== product) throw new Error(`${label} выдана на другой вид товара`);
  if (parent["Страна"] && country && parent["Страна"] !== country) throw new Error(`${label} относится к стране «${String(parent["Страна"])}»`);
}

export async function saveRecord(key: TableKey, input: Record<string, unknown>, id?: string) {
  if (!Object.hasOwn(schemas, key)) throw new Error("Неизвестная таблица");
  if (!["batches", "payments", "taxes", "reconciliations", "settings", "quotas", "licenses", "requests"].includes(key)) throw new Error("Используйте форму операции");
  if (key === "quotas" && (!input["Квота"] || num(input["Объём, кг"]) <= 0)) throw new Error("Укажите название квоты и объём");
  if (key === "licenses") {
    if (!input["Лицензия"] || !input["Квота"] || num(input["Объём, кг"]) <= 0) throw new Error("Укажите номер лицензии, квоту и объём");
    const quota = await readOne("quotas", String(input["Квота"]), ["Объём, кг", "В лицензиях, кг", "ТоварId", "Страна"]);
    input = { ...input, "Товар": input["Товар"] || quota["ТоварId"], "Страна": input["Страна"] || quota["Страна"] };
    sameScope(quota, input["Товар"], input["Страна"], "Квота");
    const own = id ? num((await readOne("licenses", id, ["Объём, кг"]))["Объём, кг"]) : 0;
    const free = num(quota["Объём, кг"]) - num(quota["В лицензиях, кг"]) + own;
    if (num(input["Объём, кг"]) > free + 0.005) throw new Error(`Объём больше нераспределённого остатка квоты (${free} кг)`);
  }
  let linkedQuota: unknown = null;
  if (key === "requests") {
    if (!input["Заявка"] || !input["Лицензия"] || num(input["Объём, кг"]) <= 0) throw new Error("Укажите номер заявки, лицензию и объём");
    const license = await readOne("licenses", String(input["Лицензия"]), ["Остаток, кг", "ТоварId", "Страна", "КвотаId"]);
    linkedQuota = license["КвотаId"];
    input = { ...input, "Товар": input["Товар"] || license["ТоварId"], "Страна": input["Страна"] || license["Страна"] };
    sameScope(license, input["Товар"], input["Страна"], "Лицензия");
    if (input["Партия"]) {
      const batch = await readOne("batches", String(input["Партия"]), ["ТоварId", "Страна"]);
      sameScope({ ...license, "ТоварId": input["Товар"] || license["ТоварId"] }, batch["ТоварId"], batch["Страна"], "Заявка");
    }
    const own = id ? num((await readOne("requests", id, ["Объём, кг"]))["Объём, кг"]) : 0;
    const free = num(license["Остаток, кг"]) + own;
    if (num(input["Объём, кг"]) > free + 0.005) throw new Error(`Объём больше остатка лицензии (${free} кг)`);
  }
  if (key === "settings") {
    if (!id || Object.keys(input).some((name) => name !== "Значение") || !Number.isFinite(Number(input["Значение"])) || num(input["Значение"]) < 0) throw new Error("Укажите неотрицательное значение настройки");
    const existing = await readOne("settings", id, ["Параметр"]);
    if (existing["Параметр"] === "Курс $ для отчётов" && num(input["Значение"]) <= 0) throw new Error("Курс должен быть больше нуля");
  }
  if (key === "taxes") {
    if (id || !input["Основание"] || !input["Дата"] || input["Начислено, сом"] === undefined || !Number.isFinite(Number(input["Начислено, сом"])) || num(input["Начислено, сом"]) < 0 || Object.keys(input).some((name) => !["Основание", "Дата", "Начислено, сом", "Комментарий"].includes(name))) throw new Error("Укажите основание, дату и начисление налога");
  }
  if (key === "reconciliations" && (id || !input["Партии в своде"] || !input["Дата свода"] || !Number.isFinite(Number(input["Факт остаток, $"])))) throw new Error("Укажите партии, дату и факт остаток сверки");
  if (key === "batches" && input["Статус"] === "На складе") {
    if (!id) throw new Error("Для приёмки используйте действие «Принять на склад»");
    const current = await readOne("batches", id, ["Статус"]);
    if (!["На складе", "Продана"].includes(String(current["Статус"]))) throw new Error("Для приёмки используйте действие «Принять на склад»");
  }
  const targets: Partial<Record<string, TableKey>> = { "Товар": "products", "Поставщик": "contacts", "Контрагент": "contacts", "Партия": "batches", "Счёт": "accounts", "Юрлицо": "entities", "Квота": "quotas", "Лицензия": "licenses" };
  // only real link fields of this table (e.g. «Квота» is a link in Лицензии but the title text in Квоты)
  await Promise.all(Object.entries(input).filter(([name, value]) => targets[name] && value && field(key, name)?.type === "link").map(([name, value]) => ensureLink(targets[name]!, value)));
  if (key === "payments") {
    if (!input["Счёт"] || !input["Направление"] || !input["Дата"] || num(input["Сумма"]) <= 0) throw new Error("Заполните дату, счёт, направление и положительную сумму");
    if (input["Валюта"] !== "сом" && num(input["Курс"]) <= 0) throw new Error("Укажите положительный курс валюты");
    if (input["В расчёт с контрагентом"] && !input["Контрагент"]) throw new Error("Выберите контрагента для расчёта");
  }
  if (key === "batches" && !id && (!input["Номер партии"] || !input["Товар"])) throw new Error("Укажите номер партии и товар");
  const payload = writable(key, input);
  if (!Object.keys(payload).length) throw new Error("Нет данных для сохранения");
  const result = id ? await update(key, id, payload) : await create(key, payload);
  // a request linked to a batch also puts its license and quota on that batch
  if (key === "requests" && input["Партия"]) await update("batches", String(input["Партия"]), writable("batches", { "Лицензия": input["Лицензия"], ...(linkedQuota ? { "Квота": linkedQuota } : {}) }));
  return result.id;
}

export async function createMovement(input: Record<string, unknown>) {
  if (!input["Товар"] || !input["Дата"] || !["Приход", "Отгрузка"].includes(String(input["Тип"]))) throw new Error("Укажите тип, дату и товар");
  if (num(input["Кг"]) <= 0 || num(input["Коробки"]) < 0) throw new Error("Укажите положительный вес");
  await ensureLink("products", input["Товар"]);
  await ensureLink("batches", input["Партия"]);
  await ensureLink("contacts", input["Контрагент"]);
  if (input["Тип"] === "Отгрузка") {
    if (!input["Контрагент"] || num(input["Цена сом/кг"]) <= 0) throw new Error("Укажите контрагента и цену продажи");
    const product = await readOne("products", String(input["Товар"]), ["Остаток, кг", "Средняя плановая цена, сом/кг"]);
    if (num(input["Кг"]) > num(product["Остаток, кг"])) throw new Error("Вес превышает остаток на складе");
    // planned sale price: from the chosen batch if any, otherwise the product's average planned price on stock
    const plan = input["Партия"] ? num((await readOne("batches", String(input["Партия"]), ["Цена продажи сом/кг"]))["Цена продажи сом/кг"]) : 0;
    input = { ...input, "Цена плановая продажная, сом/кг": plan || num(product["Средняя плановая цена, сом/кг"]), "В расчёт с контрагентом": true };
  } else {
    // a receipt without a planned sale price is valued at its own price, so stock is never booked at 0
    const plan = num(input["Цена плановая продажная, сом/кг"]) || num(input["Цена сом/кг"]);
    if (plan <= 0) throw new Error("Укажите цену или плановую цену продажи");
    input = { ...input, "Цена плановая продажная, сом/кг": plan, "В расчёт с контрагентом": false };
  }
  const result = await create("movements", writable("movements", input));
  return result.id;
}

export async function receiveBatch(id: string) {
  const batch = await readOne("batches", id, ["Статус", "Кг", "Цена продажи сом/кг", "Дата прибытия"]);
  if (num(batch["Цена продажи сом/кг"]) <= 0) throw new Error("У партии не указана плановая цена продажи");
  if (!["В пути", "На таможне"].includes(String(batch["Статус"]))) throw new Error("Приёмка доступна только для партии в пути или на таможне");
  const productId = (await readOne("batches", id, ["ТоварId"]))["ТоварId"];
  const existing = (await readTable("movements")).filter((m) => m["ПартияId"] === id && m["Тип"] === "Приход");
  if (existing.length) throw new Error("Приход для этой партии уже зарегистрирован");
  if (!productId || num(batch["Кг"]) <= 0) throw new Error("У партии должны быть товар и положительный вес");
  const product = await readOne("products", String(productId), ["Кг в коробке"]);
  const kgPerBox = num(product["Кг в коробке"]);
  if (kgPerBox <= 0) throw new Error("У товара не задано поле «Кг в коробке»");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await update("batches", id, writable("batches", { "Статус": "На складе", "Дата прибытия": today }));
  try {
    const movement = await create("movements", writable("movements", {
      "Дата": today, "Тип": "Приход", "Товар": productId, "Партия": id,
      "Кг": num(batch["Кг"]), "Коробки": num(batch["Кг"]) / kgPerBox,
      // stock is valued at the planned sale price, like the «цена» column of the Excel warehouse sheets
      "Цена сом/кг": num(batch["Цена продажи сом/кг"]),
      "Цена плановая продажная, сом/кг": num(batch["Цена продажи сом/кг"]),
      "В расчёт с контрагентом": false,
    }));
    return movement.id;
  } catch (error) {
    try { await update("batches", id, writable("batches", { "Статус": batch["Статус"], "Дата прибытия": batch["Дата прибытия"] ? String(batch["Дата прибытия"]).slice(0, 10) : null })); }
    catch { throw new Error("Приход не создан, а статус партии не удалось восстановить. Проверьте партию вручную."); }
    throw error;
  }
}

export async function payTax(taxId: string, accountId: string, amount: number, paymentDate: string) {
  if (!taxId || !accountId || !Number.isFinite(amount) || amount <= 0) throw new Error("Укажите налог, счёт и положительную сумму");
  await ensureLink("accounts", accountId);
  const tax = await readOne("taxes", taxId, ["Основание", "Оплачено, сом", "Остаток к уплате, сом"]);
  if (num(tax["Остаток к уплате, сом"]) <= 0 || amount > num(tax["Остаток к уплате, сом"]) + 0.005) throw new Error("Сумма превышает остаток налога к уплате");
  const payment = await create("payments", writable("payments", {
    "Дата": paymentDate, "Счёт": accountId, "Направление": "Расход", "Сумма": amount,
    "Валюта": "сом", "Категория": "Налоги", "Описание": `Налог: ${String(tax["Основание"] ?? "")}`,
    "В расчёт с контрагентом": false,
  }));
  try {
    await update("taxes", taxId, writable("taxes", { "Оплачено, сом": num(tax["Оплачено, сом"]) + amount }));
  } catch (error) {
    try { await deleteRecordSafe("payments", payment.id); }
    catch { throw new Error("Налог не обновлён, а платёж не удалось отменить. Проверьте записи вручную."); }
    throw error;
  }
  return payment.id;
}

// Freezes the current summary («баланс денег») as a dated row; one app snapshot per day (a repeat updates it).
export async function saveSnapshot(comment = "") {
  if (typeof comment !== "string" || comment.length > 2000) throw new Error("Слишком длинный комментарий");
  const keys: TableKey[] = ["accounts", "contacts", "batches", "products", "taxes", "settings"];
  const loaded = await Promise.all(keys.map((key) => readWithRetry(key)));
  const data = Object.fromEntries((Object.keys(schemas) as TableKey[]).map((key) => [key, loaded[keys.indexOf(key)] ?? []])) as Dataset;
  const s = calculateSummary(data);
  const cents = (v: number | null) => v == null ? null : Math.round(v * 100) / 100;
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const values: Record<string, unknown> = {
    "Снимок": `Снимок из приложения · ${day.split("-").reverse().join(".")}`, "Дата": day, "Источник": "Приложение",
    "Деньги на счетах, сом": cents(s.accounts), "Остаток у контрагентов, сом": cents(s.counterparts),
    "Отправлено поставщикам, сом": cents(s.inTransit), "Склад, сом": cents(s.stock), "Деньги в обороте, сом": cents(s.turnover),
    "Займы (нетто), сом": cents(s.loans), "Капитал, сом": cents(s.capital), "Налоги к уплате, сом": cents(s.taxes),
    "Курс $": s.rate, "Капитал, $": cents(s.capitalUsd), "Реальный остаток, $": cents(s.realUsd),
  };
  if (comment.trim()) values["Комментарий"] = comment.trim();
  const existing = (await readTable("snapshots")).find((row) => row["Источник"] === "Приложение" && row["Дата"]
    && new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek" }).format(new Date(String(row["Дата"]))) === day);
  const payload = writable("snapshots", values);
  const result = existing ? await update("snapshots", existing.id, payload) : await create("snapshots", payload);
  return result.id;
}

// Batch form: besides the batch fields it links a quota, a license and a request (the request holds the link to the batch).
export async function saveBatch(input: Record<string, unknown>, id?: string) {
  const { "Заявка": requestId, ...fields } = input;
  const current = id ? await readOne("batches", id, ["ТоварId", "Страна", "КвотаId", "ЛицензияId"]) : {};
  const pick = (name: string) => Object.hasOwn(fields, name) ? fields[name] : current[`${name}Id`] ?? current[name];
  const product = pick("Товар"), country = pick("Страна");
  let license = pick("Лицензия"), quota = pick("Квота");
  let request: Record<string, unknown> | null = null;
  if (requestId) {
    request = await readOne("requests", String(requestId), ["Заявка", "ЛицензияId", "ПартияId", "ТоварId", "Страна"]);
    if (request["ПартияId"] && request["ПартияId"] !== id) throw new Error(`Заявка ${String(request["Заявка"])} уже привязана к другой партии`);
    if (!license) license = request["ЛицензияId"];
    else if (request["ЛицензияId"] !== license) throw new Error("Заявка относится к другой лицензии");
    sameScope(request, product, country, "Заявка");
  }
  if (license) {
    const doc = await readOne("licenses", String(license), ["КвотаId", "ТоварId", "Страна"]);
    if (!quota) quota = doc["КвотаId"];
    else if (doc["КвотаId"] !== quota) throw new Error("Лицензия относится к другой квоте");
    sameScope(doc, product, country, "Лицензия");
  }
  if (quota) sameScope(await readOne("quotas", String(quota), ["ТоварId", "Страна"]), product, country, "Квота");
  const batchId = await saveRecord("batches", { ...fields, ...(license ? { "Лицензия": license } : {}), ...(quota ? { "Квота": quota } : {}) }, id);
  if (Object.hasOwn(input, "Заявка")) {
    for (const row of (await readTable("requests")).filter((r) => r["ПартияId"] === batchId && r.id !== requestId)) {
      await update("requests", row.id, writable("requests", { "Партия": null }));
    }
    if (requestId && request?.["ПартияId"] !== batchId) await update("requests", String(requestId), writable("requests", { "Партия": batchId }));
  }
  return batchId;
}
