"use server";

import { listRecords, getRecord, createRecord, updateRecord, deleteRecord, type RecordFields } from "@/lib/teable";
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

const schemas = { products, accounts, contacts, batches, movements, payments, taxes, reconciliations, settings, entities, quotas, licenses, requests } as const;
export type TableKey = keyof typeof schemas;
export type Row = { id: string; [key: string]: unknown };
export type Dataset = Record<TableKey, Row[]>;
export type DataResult = { data: Dataset; errors: Partial<Record<TableKey, string>> };
type Field = { id: string; name: string; dbFieldName: string; type: string; options?: unknown };
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
  const records = await listRecords(schemas[key].id);
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
      output[f.id] = value ? [String(value)] : null;
    } else if (f.type === "number") {
      if (value !== null && value !== "" && !Number.isFinite(Number(value))) throw new Error(`Некорректное число: ${name}`);
      output[f.id] = value === "" || value === null ? null : Number(value);
    } else if (f.type === "date") output[f.id] = value ? `${isoDate(value)}T00:00:00+06:00` : null;
    else if (f.type === "checkbox") output[f.id] = Boolean(value);
    else {
      if (f.type === "singleSelect" && value && !(f.options as string[]).includes(String(value))) throw new Error(`Недопустимое значение: ${name}`);
      output[f.id] = value == null || value === "" ? null : String(value);
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
  if (!await getRecord(schemas[key].id, recId(id))) throw new Error("Связанная запись не найдена");
}
async function readOne(key: TableKey, id: string, names: string[]) {
  const rec = await getRecord(schemas[key].id, recId(id));
  if (!rec) throw new Error("Запись не найдена");
  const row = toRow(key, rec as { id: string; fields: Record<string, unknown> });
  return Object.fromEntries(names.map((name) => [name, row[name] ?? null]));
}

// Tablox does not recompute parent rollups when a linked record is deleted — only when links change.
// So links are cleared first (parents recompute), then the record is deleted.
async function deleteRecordSafe(key: TableKey, id: string) {
  const own = fields(key).filter(isOwnLink);
  if (own.length) await updateRecord(schemas[key].id, recId(id), Object.fromEntries(own.map((f) => [f.id, null])));
  await deleteRecord(schemas[key].id, recId(id));
}

export async function saveRecord(key: TableKey, input: Record<string, unknown>, id?: string) {
  if (!Object.hasOwn(schemas, key)) throw new Error("Неизвестная таблица");
  if (!["batches", "payments", "taxes", "reconciliations", "settings", "quotas", "licenses", "requests"].includes(key)) throw new Error("Используйте форму операции");
  if (key === "quotas" && (!input["Квота"] || num(input["Объём, кг"]) <= 0)) throw new Error("Укажите название квоты и объём");
  if (key === "licenses") {
    if (!input["Лицензия"] || !input["Квота"] || num(input["Объём, кг"]) <= 0) throw new Error("Укажите номер лицензии, квоту и объём");
    const quota = await readOne("quotas", String(input["Квота"]), ["Объём, кг", "В лицензиях, кг"]);
    const own = id ? num((await readOne("licenses", id, ["Объём, кг"]))["Объём, кг"]) : 0;
    const free = num(quota["Объём, кг"]) - num(quota["В лицензиях, кг"]) + own;
    if (num(input["Объём, кг"]) > free + 0.005) throw new Error(`Объём больше нераспределённого остатка квоты (${free} кг)`);
  }
  if (key === "requests") {
    if (!input["Заявка"] || !input["Лицензия"] || num(input["Объём, кг"]) <= 0) throw new Error("Укажите номер заявки, лицензию и объём");
    const license = await readOne("licenses", String(input["Лицензия"]), ["Остаток, кг"]);
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
  const result = id ? await updateRecord(schemas[key].id, id, payload) : await createRecord(schemas[key].id, payload);
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
  const result = await createRecord(movements.id, writable("movements", input));
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
  await updateRecord(batches.id, id, writable("batches", { "Статус": "На складе", "Дата прибытия": today }));
  try {
    const movement = await createRecord(movements.id, writable("movements", {
      "Дата": today, "Тип": "Приход", "Товар": productId, "Партия": id,
      "Кг": num(batch["Кг"]), "Коробки": num(batch["Кг"]) / kgPerBox,
      // stock is valued at the planned sale price, like the «цена» column of the Excel warehouse sheets
      "Цена сом/кг": num(batch["Цена продажи сом/кг"]),
      "Цена плановая продажная, сом/кг": num(batch["Цена продажи сом/кг"]),
      "В расчёт с контрагентом": false,
    }));
    return movement.id;
  } catch (error) {
    try { await updateRecord(batches.id, id, writable("batches", { "Статус": batch["Статус"], "Дата прибытия": batch["Дата прибытия"] ? String(batch["Дата прибытия"]).slice(0, 10) : null })); }
    catch { throw new Error("Приход не создан, а статус партии не удалось восстановить. Проверьте партию вручную."); }
    throw error;
  }
}

export async function payTax(taxId: string, accountId: string, amount: number, paymentDate: string) {
  if (!taxId || !accountId || !Number.isFinite(amount) || amount <= 0) throw new Error("Укажите налог, счёт и положительную сумму");
  await ensureLink("accounts", accountId);
  const tax = await readOne("taxes", taxId, ["Основание", "Оплачено, сом", "Остаток к уплате, сом"]);
  if (num(tax["Остаток к уплате, сом"]) <= 0 || amount > num(tax["Остаток к уплате, сом"]) + 0.005) throw new Error("Сумма превышает остаток налога к уплате");
  const payment = await createRecord(payments.id, writable("payments", {
    "Дата": paymentDate, "Счёт": accountId, "Направление": "Расход", "Сумма": amount,
    "Валюта": "сом", "Категория": "Налоги", "Описание": `Налог: ${String(tax["Основание"] ?? "")}`,
    "В расчёт с контрагентом": false,
  }));
  try {
    await updateRecord(taxes.id, taxId, writable("taxes", { "Оплачено, сом": num(tax["Оплачено, сом"]) + amount }));
  } catch (error) {
    try { await deleteRecordSafe("payments", payment.id); }
    catch { throw new Error("Налог не обновлён, а платёж не удалось отменить. Проверьте записи вручную."); }
    throw error;
  }
  return payment.id;
}
