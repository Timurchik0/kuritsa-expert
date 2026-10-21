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
import audit from "@/schema/audit.json";
import { currentUser } from "@/lib/session";
import { UPCOMING, calculateSummary, datasetAsOf, localDay } from "./finance";

const schemas = { products, accounts, contacts, batches, movements, payments, taxes, reconciliations, settings, entities, quotas, licenses, requests, snapshots } as const;
export type TableKey = keyof typeof schemas;
export type Row = { id: string; [key: string]: unknown };
export type Dataset = Record<TableKey, Row[]>;
export type DataResult = { data: Dataset; errors: Partial<Record<TableKey, string>> };
type Field = { id: string; name: string; dbFieldName: string; type: string; options?: unknown };

// The same code can serve a copy of the base (e.g. the clean stand): table ids are resolved by table name
// when TEABLE_BASE_ID differs from the base the schema was generated from, and writes go by field name.
let tableIds: Promise<Record<string, string>> | null = null;
async function resolveTable(schema: { id: string; name: string; dbTableName: string }) {
  const base = process.env.TEABLE_BASE_ID;
  if (!base || schema.dbTableName.startsWith(`${base}.`)) return schema.id;
  tableIds ??= request<{ id: string; name: string }[]>(`/base/${base}/table`).then((list) => Object.fromEntries(list.map((t) => [t.name, t.id])));
  const ids = await tableIds.catch((error) => { tableIds = null; throw error; });
  if (!ids[schema.name]) throw new Error(`В базе нет таблицы «${schema.name}»`);
  return ids[schema.name];
}
const tableId = (key: TableKey) => resolveTable(schemas[key]);

// ── Журнал действий: every create / update / delete made through the app is logged with the signed-in user ──
const TITLE: Partial<Record<TableKey, string>> = { batches: "Партия", movements: "Операция", payments: "Операция", taxes: "Основание", reconciliations: "Партии в своде", settings: "Параметр", quotas: "Квота", licenses: "Лицензия", requests: "Заявка", snapshots: "Снимок" };
const shown = (value: unknown): string => value == null || value === "" ? "—"
  : Array.isArray(value) ? value.map(shown).join(", ")
  : typeof value === "object" ? String((value as { title?: unknown; id?: unknown }).title ?? (value as { id?: unknown }).id ?? "")
  : typeof value === "boolean" ? (value ? "да" : "нет")
  : typeof value === "number" ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
  : /^\d{4}-\d{2}-\d{2}T/.test(String(value)) ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(value)))
  : String(value);
function titleOf(key: TableKey, fields: Record<string, unknown>) {
  const own = fields[TITLE[key] ?? "Название"];
  if (own) return shown(own);
  if (key === "batches") return `${shown(fields["Номер партии"])} · ${shown(fields["Товар"])}`;
  if (key === "movements") return `${shown(fields["Дата"])} · ${shown(fields["Тип"])} · ${shown(fields["Кг"])} кг`;
  if (key === "payments") return `${shown(fields["Дата"])} · ${shown(fields["Направление"])} · ${shown(fields["Сумма"])}`;
  return schemas[key].name;
}
async function log(action: "Создание" | "Изменение" | "Удаление", key: TableKey, id: string, title: string, changes: string) {
  try {
    await createRecord(await resolveTable(audit), { "Запись": title.slice(0, 250), "Время": new Date().toISOString(), "Пользователь": await currentUser(), "Действие": action, "Раздел": schemas[key].name, "ID записи": id, "Изменения": changes.slice(0, 10000) }, "name");
  } catch (error) { console.error("Журнал действий: запись не создана", error); }
}
async function create(key: TableKey, fields: RecordFields) {
  const record = await createRecord(await tableId(key), fields, "name");
  const after = (record.fields ?? {}) as Record<string, unknown>;
  const filled = Object.keys(fields).filter((name) => fields[name] != null && fields[name] !== "");
  await log("Создание", key, record.id, titleOf(key, { ...fields, ...after }), filled.map((name) => `${name}: ${shown(after[name] ?? fields[name])}`).join("\n"));
  return record;
}
async function update(key: TableKey, id: string, fields: RecordFields) {
  const table = await tableId(key);
  const before = ((await getRecord(table, id))?.fields ?? {}) as Record<string, unknown>;
  const record = await updateRecord(table, id, fields, "name");
  // the PATCH answer may carry links without titles: compare links by id, show titles from a fresh read
  const linkIds = (value: unknown) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).map((v) => typeof v === "object" && v ? String((v as { id?: unknown }).id ?? "") : String(v)).sort().join(",");
  const same = (name: string, a: unknown, b: unknown) => field(key, name)?.type === "link" ? linkIds(a) === linkIds(b) : shown(a) === shown(b);
  const changed = Object.keys(fields).filter((name) => !same(name, before[name], record.fields?.[name] ?? fields[name]));
  const after = (changed.some((name) => field(key, name)?.type === "link") ? (await getRecord(table, id))?.fields ?? record.fields : record.fields ?? {}) as Record<string, unknown>;
  const changes = changed.map((name) => `${name}: ${shown(before[name])} → ${shown(after[name] ?? fields[name])}`);
  if (changes.length) await log("Изменение", key, id, titleOf(key, { ...before, ...after }), changes.join("\n"));
  return record;
}

/** The source file attached to a balance snapshot (served by /api/snapshot-file/[id] under its own name). */
export async function snapshotAttachment(id: string): Promise<{ name: string; mimetype: string; url: string } | null> {
  const record = await getRecord(await tableId("snapshots"), recId(id));
  const files = record?.fields?.["Исходный файл"];
  const file = Array.isArray(files) ? files[0] as { name?: string; mimetype?: string; presignedUrl?: string } : null;
  return file?.presignedUrl ? { name: file.name || "файл.xlsx", mimetype: file.mimetype || "application/octet-stream", url: file.presignedUrl } : null;
}

export type AuditRow = { id: string; time: string; user: string; action: string; section: string; title: string; recordId: string; changes: string };
export async function loadAudit(): Promise<AuditRow[]> {
  const records = await listRecords(await resolveTable(audit));
  return records.map((r) => {
    const f = r.fields as Record<string, unknown>;
    return { id: r.id, time: String(f["Время"] ?? ""), user: String(f["Пользователь"] ?? ""), action: String(f["Действие"] ?? ""), section: String(f["Раздел"] ?? ""), title: String(f["Запись"] ?? ""), recordId: String(f["ID записи"] ?? ""), changes: String(f["Изменения"] ?? "") };
  }).sort((a, b) => b.time.localeCompare(a.time));
}
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
  const table = await tableId(key);
  const before = ((await getRecord(table, recId(id)))?.fields ?? {}) as Record<string, unknown>;
  const own = fields(key).filter(isOwnLink);
  if (own.length) await updateRecord(table, recId(id), Object.fromEntries(own.map((f) => [f.name, null])), "name");
  await deleteRecord(table, recId(id));
  await log("Удаление", key, id, titleOf(key, before), Object.entries(before).filter(([, v]) => v != null && v !== "" && !Array.isArray(v)).map(([name, v]) => `${name}: ${shown(v)}`).join("\n"));
}

// a quota / license / request covers one product and one country; a child must not contradict its parent
function sameScope(parent: Record<string, unknown>, product: unknown, country: unknown, label: string) {
  if (parent["ТоварId"] && product && parent["ТоварId"] !== product) throw new Error(`${label} выдана на другой вид товара`);
  if (parent["Страна"] && country && parent["Страна"] !== country) throw new Error(`${label} относится к стране «${String(parent["Страна"])}»`);
}

export async function saveRecord(key: TableKey, input: Record<string, unknown>, id?: string) {
  if (!Object.hasOwn(schemas, key)) throw new Error("Неизвестная таблица");
  // «Второй счёт» is not a field: the other account of a «Перевод между счетами» (its paired payment is kept in step below)
  let secondAccount: string | null = null;
  const transferForm = key === "payments" && Object.hasOwn(input, SECOND_ACCOUNT);
  if (transferForm) {
    const { [SECOND_ACCOUNT]: second, ...rest } = input;
    secondAccount = input["Категория"] === TRANSFER && second ? String(second) : null;
    input = rest;
    if (secondAccount) {
      await ensureLink("accounts", secondAccount);
      if (secondAccount === input["Счёт"]) throw new Error("Перевод между счетами: выберите другой счёт");
      // a transfer is between own accounts: no counterparty, no batch, nothing in settlements
      input = { ...input, "Контрагент": null, "Партия": null, "В расчёт с контрагентом": false };
    }
  }
  if (!["batches", "payments", "taxes", "reconciliations", "settings", "quotas", "licenses", "requests", "products", "contacts", "accounts", "entities", "snapshots"].includes(key)) throw new Error("Используйте форму операции");
  await checkReference(key, input, id);
  if (["batches", "products", "quotas", "licenses", "requests", "payments", "taxes"].includes(key)) {
    const negative = Object.entries(input).find(([name, value]) => field(key, name)?.type === "number" && value !== null && value !== "" && Number(value) < 0);
    if (negative) throw new Error(`«${negative[0]}» не может быть отрицательным`);
  }
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
    if (!input["Основание"] || !input["Дата"] || input["Начислено, сом"] === undefined || !Number.isFinite(Number(input["Начислено, сом"])) || num(input["Начислено, сом"]) < 0 || Object.keys(input).some((name) => !["Основание", "Дата", "Начислено, сом", "Оплачено, сом", "Комментарий", "Статья", "Партия"].includes(name))) throw new Error("Укажите основание, дату и начисление налога");
    if (!id && num(input["Оплачено, сом"]) > 0) throw new Error("Оплата налога записывается кнопкой «Оплатить»");
    // an empty article is a tax; only an upcoming batch payment keeps a batch
    if (Object.hasOwn(input, "Статья")) input = { ...input, "Статья": input["Статья"] === UPCOMING ? UPCOMING : "Налоги", ...(input["Статья"] !== UPCOMING ? { "Партия": null } : {}) };
    if (num(input["Оплачено, сом"]) < 0 || num(input["Оплачено, сом"]) > num(input["Начислено, сом"]) + 0.005) throw new Error("Оплачено не может быть больше начисленного");
  }
  if (key === "reconciliations" && (!input["Партии в своде"] || !input["Дата свода"] || !Number.isFinite(Number(input["Факт остаток, $"])))) throw new Error("Укажите партии, дату и факт остаток сверки");
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
    // money on a holder's account (e.g. the «кассы ИП Мырзабеков») moves that counterparty's balance by the account flow
    const holder = (await readOne("accounts", String(input["Счёт"]), ["Взаиморасчёт с контрагентомId"]))["Взаиморасчёт с контрагентомId"] ?? null;
    input = { ...input, "Держатель счёта": holder };
    if (holder && input["Контрагент"] === holder) input = { ...input, "В расчёт с контрагентом": false };
    // counted once: while the batch is on its way — through the batch advance (Партии → «Оплачено по кассе»);
    // once its receipt has taken the purchase out of the supplier's balance — directly (e.g. a later postpayment)
    if (input["Партия"] && input["Категория"] === "Оплата поставщику") input = { ...input, "В расчёт с контрагентом": await receivedFromSupplier(String(input["Партия"])) && Boolean(input["Контрагент"]) };
    // a supplier's balance is about goods: only «Оплата поставщику» counts; logistics, customs etc. are expenses
    if (input["Контрагент"] && input["Категория"] !== "Оплата поставщику" && input["В расчёт с контрагентом"]
      && (await readOne("contacts", String(input["Контрагент"]), ["Тип"]))["Тип"] === "Поставщик") input = { ...input, "В расчёт с контрагентом": false };
  }
  if (key === "batches" && !id && (!input["Номер партии"] || !input["Товар"])) throw new Error("Укажите номер партии и товар");
  const payload = writable(key, input);
  if (!Object.keys(payload).length) throw new Error("Нет данных для сохранения");
  const result = id ? await update(key, id, payload) : await create(key, payload);
  if (transferForm) await syncTransfer(result.id, input, secondAccount, Boolean(id));
  if (key === "accounts" && id && Object.hasOwn(input, "Взаиморасчёт с контрагентом")) {
    const holder = input["Взаиморасчёт с контрагентом"] || null;
    for (const p of (await readTable("payments")).filter((p) => p["СчётId"] === id && (p["Держатель счётаId"] ?? null) !== holder)) {
      await update("payments", p.id, writable("payments", { "Держатель счёта": holder, ...(holder && p["КонтрагентId"] === holder ? { "В расчёт с контрагентом": false } : {}) }));
    }
  }
  // a request linked to a batch also puts its license and quota on that batch
  if (key === "requests" && input["Партия"]) await update("batches", String(input["Партия"]), writable("batches", { "Лицензия": input["Лицензия"], ...(linkedQuota ? { "Квота": linkedQuota } : {}) }));
  return result.id;
}

const TRANSFER = "Перевод между счетами";
const SECOND_ACCOUNT = "Второй счёт";
const PAIR = "Парный платёж";

/**
 * «Перевод между счетами» is one operation: the payment on one account and the opposite one on the other account,
 * linked both ways through «Парный платёж». Saving either side creates or updates the other; a payment that stops being
 * a transfer (another category, no second account) loses its pair.
 */
async function syncTransfer(selfId: string, input: Record<string, unknown>, second: string | null, existed: boolean) {
  if (!field("payments", PAIR)) return; // base without the pair link yet
  const pairId = existed ? (await readOne("payments", selfId, [`${PAIR}Id`]))[`${PAIR}Id`] as string | null ?? null : null;
  if (!second) {
    if (pairId) {
      await update("payments", selfId, writable("payments", { [PAIR]: null }));
      await deleteRecordSafe("payments", pairId);
    }
    return;
  }
  const accounts = await readTable("accounts");
  const name = (id: unknown) => String(accounts.find((a) => a.id === id)?.["Название"] ?? "");
  const outgoing = input["Направление"] === "Расход";
  const holder = accounts.find((a) => a.id === second)?.["Взаиморасчёт с контрагентомId"] ?? null;
  const pair = {
    "Дата": input["Дата"], "Счёт": second, "Направление": outgoing ? "Приход" : "Расход", "Сумма": input["Сумма"], "Валюта": input["Валюта"], "Курс": input["Курс"] ?? null,
    "Категория": TRANSFER, "Контрагент": null, "Партия": null, "В расчёт с контрагентом": false, "Держатель счёта": holder,
    "Описание": outgoing ? `Перевод со счёта «${name(input["Счёт"])}»` : `Перевод на счёт «${name(input["Счёт"])}»`, [PAIR]: selfId,
  };
  const pairSaved = pairId ? await update("payments", pairId, writable("payments", pair)) : await create("payments", writable("payments", pair));
  const own = { [PAIR]: pairSaved.id, ...(!String(input["Описание"] ?? "").trim() || /^Перевод (на|со) сч/.test(String(input["Описание"])) ? { "Описание": outgoing ? `Перевод на счёт «${name(second)}»` : `Перевод со счёта «${name(second)}»` } : {}) };
  await update("payments", selfId, writable("payments", own));
}

// Reference tables (товары, контрагенты, счета, юрлица): required fields and unique names
async function checkReference(key: TableKey, input: Record<string, unknown>, id?: string) {
  if (!["products", "contacts", "accounts", "entities"].includes(key)) return;
  const name = String(input["Название"] ?? "").trim();
  if (!id && !name) throw new Error("Укажите название");
  if (Object.hasOwn(input, "Название") && !name) throw new Error("Название не может быть пустым");
  if (key === "contacts" && !id && !input["Тип"]) throw new Error("Укажите тип контрагента");
  if (key === "products" && input["Кг в коробке"] != null && input["Кг в коробке"] !== "" && num(input["Кг в коробке"]) <= 0) throw new Error("Кг в коробке должно быть больше нуля");
  if (name) {
    const same = (await readTable(key)).find((row) => row.id !== id && String(row["Название"] ?? "").trim().toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"));
    if (same) throw new Error(`«${name}» уже есть — выберите другое название`);
  }
}

// Edit of a stock movement: same rules as creating it, stock is checked without this movement's own weight
// Stock straight from the movements (raw type and weight) — the product's rollup lags a few seconds behind a new movement
async function stockKg(product: string, exceptId?: string) {
  return (await readTable("movements")).filter((m) => m["ТоварId"] === product && m.id !== exceptId)
    .reduce((sum, m) => sum + (m["Тип"] === "Приход" ? num(m["Кг"]) : -num(m["Кг"])), 0);
}
const kgText = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);

export async function updateMovement(id: string, input: Record<string, unknown>) {
  const current = await readOne("movements", id, ["Тип", "ТоварId", "Кг"]);
  const kind = String(current["Тип"]);
  const allowed = ["Дата", "Товар", "Партия", "Контрагент", "Коробки", "Кг", "Цена сом/кг", "Цена плановая продажная, сом/кг", "Сумма вручную", "В расчёт с контрагентом", "Комментарий"];
  if (Object.keys(input).some((name) => !allowed.includes(name))) throw new Error("Это поле движения менять нельзя");
  const product = input["Товар"] ?? current["ТоварId"];
  if (!product || !input["Дата"]) throw new Error("Укажите дату и товар");
  if (num(input["Кг"]) < 0 || num(input["Коробки"]) < 0) throw new Error("Вес и коробки не могут быть отрицательными");
  await Promise.all([ensureLink("products", product), ensureLink("batches", input["Партия"]), ensureLink("contacts", input["Контрагент"])]);
  if (kind === "Отгрузка") {
    if (!input["Контрагент"]) throw new Error("Укажите контрагента");
    const stock = await stockKg(String(product), id);
    if (num(input["Кг"]) > stock + 0.005) throw new Error(`Вес превышает остаток на складе (${kgText(stock)} кг)`);
  }
  if (kind === "Приход") {
    // a smaller (or moved) receipt must still cover what was already shipped
    // (stock that was already negative in the imported history does not block corrections)
    const others = await stockKg(String(current["ТоварId"]), id);
    const left = others + (product === current["ТоварId"] ? num(input["Кг"]) : 0);
    if (left < -0.005 && others + num(current["Кг"]) >= -0.005) throw new Error(`После изменения остаток товара станет отрицательным (${kgText(left)} кг) — по нему уже есть отгрузки`);
  }
  if (input["В расчёт с контрагентом"] && !input["Контрагент"]) throw new Error("Выберите контрагента для расчёта");
  return (await update("movements", id, writable("movements", input))).id;
}

// What may not be deleted while other records point at it: table → [child table, link field, label]
const DEPENDENTS: Partial<Record<TableKey, [TableKey, string, string][]>> = {
  products: [["movements", "ТоварId", "движений склада"], ["batches", "ТоварId", "партий"], ["quotas", "ТоварId", "квот"], ["licenses", "ТоварId", "лицензий"], ["requests", "ТоварId", "заявок"]],
  contacts: [["movements", "КонтрагентId", "движений склада"], ["payments", "КонтрагентId", "платежей"], ["batches", "ПоставщикId", "партий"]],
  accounts: [["payments", "СчётId", "платежей"]],
  entities: [["quotas", "ЮрлицоId", "квот"]],
  batches: [["movements", "ПартияId", "движений склада (приход/отгрузки)"], ["payments", "ПартияId", "платежей"]],
  quotas: [["licenses", "КвотаId", "лицензий"]],
  licenses: [["requests", "ЛицензияId", "заявок"]],
};
const DELETABLE: TableKey[] = ["products", "contacts", "accounts", "entities", "batches", "movements", "payments", "taxes", "quotas", "licenses", "requests", "reconciliations", "snapshots"];

export async function deleteEntity(key: TableKey, id: string) {
  if (!DELETABLE.includes(key)) throw new Error("Эти записи удалять нельзя");
  recId(id);
  for (const [child, link, label] of DEPENDENTS[key] ?? []) {
    const count = (await readTable(child)).filter((row) => row[link] === id).length;
    if (count) throw new Error(`Нельзя удалить: на запись ссылаются ${count} ${label}. Сначала удалите или перенесите их.`);
  }
  if (key === "movements") {
    const m = await readOne("movements", id, ["Тип", "ТоварId"]);
    if (m["Тип"] === "Приход" && m["ТоварId"]) {
      const left = await stockKg(String(m["ТоварId"]), id);
      const kg = num((await readOne("movements", id, ["Кг"]))["Кг"]);
      if (left < -0.005 && left + kg >= -0.005) throw new Error(`Нельзя удалить приход: остаток товара станет отрицательным (${kgText(left)} кг) — сначала удалите или исправьте отгрузки`);
    }
  }
  if (key === "taxes" && num((await readOne("taxes", id, ["Оплачено, сом"]))["Оплачено, сом"]) > 0) throw new Error("По налогу уже есть оплата — сначала обнулите «Оплачено» или удалите платёж");
  if (key === "snapshots" && (await readOne("snapshots", id, ["Источник"]))["Источник"] === "Excel") throw new Error("Исходный снимок из Excel удалять нельзя");
  if (key === "batches" || key === "licenses" || key === "quotas") {
    // links that only describe the record (заявка → партия, партия → лицензия/квота) are cleared, not blocking
    if (key === "batches") for (const r of (await readTable("requests")).filter((r) => r["ПартияId"] === id)) await update("requests", r.id, writable("requests", { "Партия": null }));
    const field = key === "licenses" ? "ЛицензияId" : key === "quotas" ? "КвотаId" : null;
    if (field) for (const b of (await readTable("batches")).filter((b) => b[field] === id)) await update("batches", b.id, writable("batches", { [field.slice(0, -2)]: null }));
  }
  // a transfer goes as a whole: its other half is removed too
  const pair = key === "payments" && field("payments", PAIR) ? (await readOne("payments", id, [`${PAIR}Id`]))[`${PAIR}Id`] as string | null ?? null : null;
  await deleteRecordSafe(key, id);
  if (pair) { try { await deleteRecordSafe("payments", pair); } catch { throw new Error("Платёж удалён, а парный платёж перевода — нет. Удалите его в кассе вручную."); } }
  return id;
}

export async function createMovement(input: Record<string, unknown>) {
  if (!input["Товар"] || !input["Дата"] || !["Приход", "Отгрузка"].includes(String(input["Тип"]))) throw new Error("Укажите тип, дату и товар");
  if (num(input["Кг"]) <= 0 || num(input["Коробки"]) < 0) throw new Error("Укажите положительный вес");
  await ensureLink("products", input["Товар"]);
  await ensureLink("batches", input["Партия"]);
  await ensureLink("contacts", input["Контрагент"]);
  if (input["Тип"] === "Отгрузка") {
    if (!input["Контрагент"] || num(input["Цена сом/кг"]) <= 0) throw new Error("Укажите контрагента и цену продажи");
    const product = await readOne("products", String(input["Товар"]), ["Средняя плановая цена, сом/кг"]);
    const stock = await stockKg(String(input["Товар"]));
    if (num(input["Кг"]) > stock + 0.005) throw new Error(`Вес превышает остаток на складе (${kgText(stock)} кг)`);
    // planned sale price: from the chosen batch if any, otherwise the product's average planned price on stock
    const plan = input["Партия"] ? num((await readOne("batches", String(input["Партия"]), ["Цена продажи сом/кг"]))["Цена продажи сом/кг"]) : 0;
    input = { ...input, "Цена плановая продажная, сом/кг": plan || num(product["Средняя плановая цена, сом/кг"]), "В расчёт с контрагентом": true };
  } else {
    // a receipt without a planned sale price is valued at its own price, so stock is never booked at 0
    const plan = num(input["Цена плановая продажная, сом/кг"]) || num(input["Цена сом/кг"]);
    if (plan <= 0) throw new Error("Укажите цену или плановую цену продажи");
    // goods paid to a supplier earlier (e.g. in the opening prepayment) and received without a batch:
    // the purchase amount leaves the supplier's balance; stock is still valued at the planned sale price
    const closesPrepayment = Boolean(input["Контрагент"]) && !input["Партия"] && num(input["Сумма вручную"]) > 0;
    if (input["Контрагент"] && !input["Партия"] && !closesPrepayment) throw new Error("Укажите сумму закупки — она уйдёт из расчётов с поставщиком");
    input = { ...input, "Цена плановая продажная, сом/кг": plan, "В расчёт с контрагентом": closesPrepayment, ...(closesPrepayment ? {} : { "Сумма вручную": null }) };
  }
  const result = await create("movements", writable("movements", input));
  return result.id;
}

// The batch's receipt booked the purchase against its supplier (see receiveBatch)
async function receivedFromSupplier(batchId: string) {
  return (await readTable("movements")).some((m) => m["ПартияId"] === batchId && m["Тип"] === "Приход" && m["В расчёт с контрагентом"] && m["КонтрагентId"]);
}

export async function receiveBatch(id: string) {
  const batch = await readOne("batches", id, ["Статус", "Кг", "Цена продажи сом/кг", "Дата прибытия"]);
  if (num(batch["Цена продажи сом/кг"]) <= 0) throw new Error("У партии не указана плановая цена продажи");
  if (!["В пути", "На таможне"].includes(String(batch["Статус"]))) throw new Error("Приёмка доступна только для партии в пути или на таможне");
  const links = await readOne("batches", id, ["ТоварId", "ПоставщикId", "Оплачено поставщику, сом"]);
  const productId = links["ТоварId"], supplier = links["ПоставщикId"] ?? null, purchase = num(links["Оплачено поставщику, сом"]);
  const existing = (await readTable("movements")).filter((m) => m["ПартияId"] === id && m["Тип"] === "Приход");
  if (existing.length) throw new Error("Приход для этой партии уже зарегистрирован");
  if (!productId || num(batch["Кг"]) <= 0) throw new Error("У партии должны быть товар и положительный вес");
  const product = await readOne("products", String(productId), ["Кг в коробке"]);
  const kgPerBox = num(product["Кг в коробке"]);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await update("batches", id, writable("batches", { "Статус": "На складе", "Дата прибытия": today }));
  try {
    const movement = await create("movements", writable("movements", {
      "Дата": today, "Тип": "Приход", "Товар": productId, "Партия": id,
      "Кг": num(batch["Кг"]), "Коробки": kgPerBox > 0 ? num(batch["Кг"]) / kgPerBox : null,
      // stock is valued at the planned sale price, like the «цена» column of the Excel warehouse sheets
      "Цена сом/кг": num(batch["Цена продажи сом/кг"]),
      "Цена плановая продажная, сом/кг": num(batch["Цена продажи сом/кг"]),
      // the goods close the supplier's prepayment: the purchase sum leaves its balance (as an Excel supplier sheet does);
      // money paid by cash for this batch stops counting as an advance and counts directly instead (below)
      ...(supplier && purchase > 0 ? { "Контрагент": supplier, "Сумма вручную": purchase, "В расчёт с контрагентом": true } : { "В расчёт с контрагентом": false }),
    }));
    if (supplier && purchase > 0) {
      for (const p of (await readTable("payments")).filter((p) => p["ПартияId"] === id && p["Категория"] === "Оплата поставщику" && !p["В расчёт с контрагентом"] && p["КонтрагентId"])) {
        await update("payments", p.id, writable("payments", { "В расчёт с контрагентом": true }));
      }
    }
    return movement.id;
  } catch (error) {
    try { await update("batches", id, writable("batches", { "Статус": batch["Статус"], "Дата прибытия": batch["Дата прибытия"] ? localDay(batch["Дата прибытия"]) : null })); }
    catch { throw new Error("Приход не создан, а статус партии не удалось восстановить. Проверьте партию вручную."); }
    throw error;
  }
}

/** What an upcoming batch payment can be paid as (batch costs outside the supplier's price) */
const UPCOMING_CATEGORIES = ["Логистика", "Выгрузка", "Растаможка", "Комиссия банка", "Прочие расходы"];

export async function payTax(taxId: string, accountId: string, amount: number, paymentDate: string, category = "") {
  if (!taxId || !accountId || !Number.isFinite(amount) || amount <= 0) throw new Error("Укажите налог, счёт и положительную сумму");
  await ensureLink("accounts", accountId);
  const tax = await readOne("taxes", taxId, ["Основание", "Оплачено, сом", "Остаток к уплате, сом", "Статья", "ПартияId"]);
  // an upcoming batch payment is paid as the expense it is (logistics, customs…) and stays linked to its batch
  const upcoming = tax["Статья"] === UPCOMING;
  if (upcoming && category && !UPCOMING_CATEGORIES.includes(category)) throw new Error("Выберите статью расхода по партии");
  if (num(tax["Остаток к уплате, сом"]) <= 0 || amount > num(tax["Остаток к уплате, сом"]) + 0.005) throw new Error("Сумма превышает остаток налога к уплате");
  const holder = (await readOne("accounts", accountId, ["Взаиморасчёт с контрагентомId"]))["Взаиморасчёт с контрагентомId"] ?? null;
  const payment = await create("payments", writable("payments", {
    "Дата": paymentDate, "Счёт": accountId, "Направление": "Расход", "Сумма": amount, "Держатель счёта": holder,
    "Валюта": "сом", "Категория": upcoming ? category || "Логистика" : "Налоги", "Описание": `${upcoming ? "Предстоящая оплата" : "Налог"}: ${String(tax["Основание"] ?? "")}`,
    ...(upcoming && tax["ПартияId"] ? { "Партия": tax["ПартияId"] } : {}),
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
// The summary at the end of `date` (ГГГГ-ММ-ДД, default today) is stored as a snapshot; one per day (a repeat updates it).
export async function saveSnapshot(comment = "", date = "") {
  if (typeof comment !== "string" || comment.length > 2000) throw new Error("Слишком длинный комментарий");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const day = date ? isoDate(date) : today;
  if (day > today) throw new Error("Нельзя зафиксировать баланс на будущую дату");
  const keys: TableKey[] = ["accounts", "contacts", "batches", "products", "taxes", "settings", "movements", "payments"];
  const loaded = await Promise.all(keys.map((key) => readWithRetry(key)));
  const live = Object.fromEntries((Object.keys(schemas) as TableKey[]).map((key) => [key, loaded[keys.indexOf(key)] ?? []])) as Dataset;
  const s = calculateSummary(day === today ? live : datasetAsOf(live, day));
  const cents = (v: number | null) => v == null ? null : Math.round(v * 100) / 100;
  const values: Record<string, unknown> = {
    "Снимок": `Снимок из приложения · ${day.split("-").reverse().join(".")}`, "Дата": day, "Источник": "Приложение",
    "Деньги на счетах, сом": cents(s.accounts), "Остаток у контрагентов, сом": cents(s.counterparts),
    "Отправлено поставщикам, сом": cents(s.inTransit), "Склад, сом": cents(s.stock), "Деньги в обороте, сом": cents(s.turnover),
    "Займы (нетто), сом": cents(s.loans), "Капитал, сом": cents(s.capital), "Налоги к уплате, сом": cents(s.taxes),
    ...(field("snapshots", "Предстоящие оплаты, сом") ? { "Предстоящие оплаты, сом": cents(s.upcoming) } : {}),
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
