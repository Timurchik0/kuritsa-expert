"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dataset, Row, TableKey } from "./actions";
import { UPCOMING } from "./finance";
import { SearchSelect, TRANSFER, dateInput, paymentCategories, text, uiInput, type Choice } from "./ui-kit";

// One create / edit / delete form for every table that has no special workflow of its own.
export type EditKind = "products" | "contacts" | "accounts" | "entities" | "movements" | "payments" | "taxes" | "quotas" | "licenses" | "requests" | "reconciliations" | "snapshots";
type Kind = "text" | "number" | "signed" | "date" | "textarea" | "checkbox" | "select";
type Spec = { name: string; kind: Kind; required?: boolean; options?: (data: Dataset, form?: Record<string, unknown>) => Choice[]; wide?: boolean; label?: string | ((form: Record<string, unknown>) => string); readonly?: boolean;
  /** shown only when this holds for the form (still sent on save) */ when?: (form: Record<string, unknown>) => boolean };
const isTransfer = (form: Record<string, unknown>) => form["Категория"] === TRANSFER;

const list = (...values: string[]) => () => values.map((v) => ({ value: v, title: v }));
const rows = (key: TableKey, field = "Название") => (data: Dataset) => data[key].map((r) => ({ value: r.id, title: text(r[field]) || text(r["Номер партии"]) || "—" }));
const contactsGrouped = (data: Dataset) => data.contacts.map((r) => ({ value: r.id, title: text(r["Название"]), group: text(r["Тип"]) }));
const comment: Spec = { name: "Комментарий", kind: "textarea", wide: true };

export const EDITORS: Record<EditKind, { table: TableKey; singular: string; created: string; fields: Spec[] }> = {
  products: { table: "products", singular: "товар", created: "Товар добавлен", fields: [
    { name: "Название", kind: "text", required: true, wide: true }, { name: "Страна", kind: "select", options: list("Китай", "РФ"), label: "Страна (в какой список партий попадает)" }, { name: "Категория", kind: "select", options: (_data, form) => paymentCategories(form?.["Направление"]).map((v) => ({ value: v, title: v })) }, { name: "Кг в коробке", kind: "number" }] },
  contacts: { table: "contacts", singular: "контрагент", created: "Контрагент добавлен", fields: [
    { name: "Название", kind: "text", required: true }, { name: "Тип", kind: "select", required: true, options: list("Клиент", "Партнёр", "Поставщик", "Заёмщик", "Займодавец", "Прочее") },
    { name: "Телефон", kind: "text" }, { name: "Сальдо на начало", kind: "signed", label: "Сальдо на начало, сом («+» — должен нам)" }, comment] },
  accounts: { table: "accounts", singular: "счёт", created: "Счёт добавлен", fields: [
    { name: "Название", kind: "text", required: true }, { name: "Юрлицо", kind: "select", options: list("ОсОО «Эксперт компани»", "ИП Мырзабеков", "Фудторг", "Бонвивант", "Юни Трейд Компани", "Фуд Бридж", "ИП Наргиза", "Наличные у сотрудников") },
    { name: "Тип", kind: "select", options: list("Банк", "Наличные") }, { name: "Остаток на начало", kind: "signed", label: "Остаток на начало, сом" }, { name: "Учитывать в сводке", kind: "checkbox" },
    { name: "Взаиморасчёт с контрагентом", kind: "select", options: contactsGrouped, wide: true, label: "Взаиморасчёт с контрагентом (приходы на счёт увеличивают его баланс, расходы уменьшают — например, кассы ИП Мырзабеков)" }, comment] },
  entities: { table: "entities", singular: "юрлицо", created: "Юрлицо добавлено", fields: [
    { name: "Название", kind: "text", required: true }, { name: "Форма", kind: "select", options: list("ОсОО", "ИП") }, { name: "ИНН", kind: "text" }, { name: "Руководитель", kind: "text" },
    { name: "Юридический адрес", kind: "text", wide: true }, { name: "Склад", kind: "text" }, { name: "Разрешение ЕАЭС", kind: "text" }, comment] },
  movements: { table: "movements", singular: "движение склада", created: "Движение сохранено", fields: [
    { name: "Дата", kind: "date", required: true }, { name: "Тип", kind: "text", readonly: true }, { name: "Товар", kind: "select", required: true, options: rows("products") },
    { name: "Партия", kind: "select", options: rows("batches", "Партия") }, { name: "Контрагент", kind: "select", options: contactsGrouped }, { name: "Коробки", kind: "number" }, { name: "Кг", kind: "number", required: true },
    { name: "Цена сом/кг", kind: "number" }, { name: "Цена плановая продажная, сом/кг", kind: "number" }, { name: "Сумма вручную", kind: "number", label: (f) => f["Тип"] === "Приход" ? "Сумма закупки у поставщика, сом (списывается с его баланса)" : "Сумма вручную, сом (если не кг × цена)" },
    { name: "В расчёт с контрагентом", kind: "checkbox" }, comment] },
  payments: { table: "payments", singular: "платёж", created: "Платёж сохранён", fields: [
    { name: "Дата", kind: "date", required: true }, { name: "Счёт", kind: "select", required: true, options: rows("accounts") }, { name: "Направление", kind: "select", required: true, options: list("Приход", "Расход") },
    { name: "Категория", kind: "select", options: list("Оплата от клиента", "Оплата поставщику", "Растаможка", "Налоги", "Логистика", "Выгрузка", "Комиссия банка", "Зарплата", "Аренда", "Займы", "Расчёты с партнёром", "Перевод между счетами", "Расходы вне себестоимости", "Личные расходы", "Яйца", "Прочий приход", "Прочие расходы", "Прочее") },
    { name: "Сумма", kind: "number", required: true }, { name: "Валюта", kind: "select", required: true, options: list("сом", "$", "₽") }, { name: "Курс", kind: "number" },
    // not a field: the other account of a transfer — its paired payment is created / kept in step on save
    { name: "Второй счёт", kind: "select", options: (data, form) => data.accounts.filter((a) => a.id !== form?.["Счёт"]).map((a) => ({ value: a.id, title: text(a["Название"]) })), when: isTransfer, label: (form) => form["Направление"] === "Приход" ? "Со счёта (там будет такой же расход)" : "На счёт (там будет такой же приход)" },
    { name: "Контрагент", kind: "select", options: contactsGrouped, when: (f) => !isTransfer(f) }, { name: "Партия", kind: "select", options: rows("batches", "Партия"), when: (f) => !isTransfer(f) }, { name: "В расчёт с контрагентом", kind: "checkbox", when: (f) => !isTransfer(f) }, { name: "Описание", kind: "textarea", wide: true }] },
  taxes: { table: "taxes", singular: "начисление налога", created: "Начисление сохранено", fields: [
    { name: "Статья", kind: "select", options: list("Налоги", UPCOMING) }, { name: "Партия", kind: "select", options: rows("batches", "Партия"), when: (f) => f["Статья"] === UPCOMING },
    { name: "Основание", kind: "text", required: true, wide: true }, { name: "Дата", kind: "date", required: true }, { name: "Начислено, сом", kind: "number", required: true }, { name: "Оплачено, сом", kind: "number" }, comment] },
  quotas: { table: "quotas", singular: "квота", created: "Квота сохранена", fields: [
    { name: "Квота", kind: "text", required: true }, { name: "Объём, кг", kind: "number", required: true }, { name: "Период", kind: "text" }, { name: "Дата", kind: "date" },
    { name: "Юрлицо", kind: "select", options: rows("entities") }, { name: "Товар", kind: "select", options: rows("products") }, comment] },
  licenses: { table: "licenses", singular: "лицензия", created: "Лицензия сохранена", fields: [
    { name: "Лицензия", kind: "text", required: true }, { name: "Объём, кг", kind: "number", required: true }, { name: "Дата", kind: "date" },
    { name: "Квота", kind: "select", required: true, options: rows("quotas", "Квота") }, { name: "Товар", kind: "select", options: rows("products") }, comment] },
  requests: { table: "requests", singular: "заявка", created: "Заявка сохранена", fields: [
    { name: "Заявка", kind: "text", required: true }, { name: "Объём, кг", kind: "number", required: true }, { name: "Дата", kind: "date" }, { name: "Номер машины", kind: "text" },
    { name: "Статус", kind: "select", options: list("Открыта", "Исполнена", "Отменена") }, { name: "Лицензия", kind: "select", required: true, options: rows("licenses", "Лицензия") },
    { name: "Товар", kind: "select", options: rows("products") }, { name: "Партия", kind: "select", options: rows("batches", "Партия") }, comment] },
  reconciliations: { table: "reconciliations", singular: "сверка", created: "Сверка сохранена", fields: [
    { name: "Партии в своде", kind: "text", required: true, wide: true }, { name: "Дата свода", kind: "date", required: true }, { name: "Остаток на начало, $", kind: "signed" },
    { name: "Прибыль по партиям, $", kind: "signed" }, { name: "Факт остаток, $", kind: "signed", required: true }, { name: "Факт расходов, $", kind: "signed" }, comment] },
  snapshots: { table: "snapshots", singular: "снимок баланса", created: "Снимок сохранён", fields: [comment] },
};

const LINKS = new Set(["Товар", "Партия", "Контрагент", "Счёт", "Юрлицо", "Квота", "Лицензия", "Взаиморасчёт с контрагентом"]);
/** Form values of an existing record (links → their id, dates → ГГГГ-ММ-ДД). */
export function formOf(kind: EditKind, row: Row | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of EDITORS[kind].fields) {
    const title = kind === "quotas" ? "Квота" : kind === "licenses" ? "Лицензия" : "";
    const value = LINKS.has(f.name) && f.name !== title ? row?.[`${f.name}Id`] : row?.[f.name];
    out[f.name] = f.kind === "date" ? dateInput(value) : f.kind === "checkbox" ? Boolean(value) : value ?? "";
  }
  return out;
}

export function RecordEditor({ kind, row, defaults, data, busy, warning, onSave, onDelete, onClose }: {
  kind: EditKind | null; row: Row | null; defaults?: Record<string, unknown>; data: Dataset; busy: boolean; warning?: string;
  onSave: (kind: EditKind, input: Record<string, unknown>, id?: string) => void; onDelete: (kind: EditKind, row: Row) => void; onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const key = kind ? `${kind}:${row?.id ?? "new"}` : null;
  if (key !== openedFor) {
    setOpenedFor(key); setConfirm(false);
    // a transfer shows the account of its paired payment
    const pair = kind === "payments" && row?.["Парный платёжId"] ? data.payments.find((p) => p.id === row["Парный платёжId"]) : undefined;
    setForm(kind ? { ...formOf(kind, row), ...(pair ? { "Второй счёт": pair["СчётId"] ?? "" } : {}), ...defaults } : {});
  }
  if (!kind) return null;
  const spec = EDITORS[kind];
  const set = (name: string, value: unknown) => setForm((f) => ({ ...f, [name]: value, ...(kind === "payments" && name === "Направление" && !paymentCategories(value).includes(String(f["Категория"] ?? "")) ? { "Категория": "" } : {}) }));
  const submit = () => {
    const input = Object.fromEntries(spec.fields.filter((f) => !f.readonly).map((f) => [f.name, f.kind === "number" || f.kind === "signed" ? (form[f.name] === "" || form[f.name] == null ? null : Number(form[f.name])) : form[f.name]]));
    onSave(kind, input, row?.id);
  };
  return <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[640px]">
    <DialogHeader><DialogTitle>{row ? `Изменить: ${spec.singular}` : `Новый ${spec.singular}`.replace("Новый лицензия", "Новая лицензия").replace("Новый квота", "Новая квота").replace("Новый заявка", "Новая заявка").replace("Новый сверка", "Новая сверка")}</DialogTitle><DialogDescription>{row ? "Изменения попадут в журнал действий" : "Поля со звёздочкой обязательны"}</DialogDescription></DialogHeader>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {spec.fields.filter((f) => !f.when || f.when(form)).map((f) => <label key={f.name} className={`flex min-w-0 flex-col gap-1.5 text-xs font-medium text-[#65746e] ${f.wide || f.kind === "textarea" ? "sm:col-span-2" : ""}`}>
        <span>{typeof f.label === "function" ? f.label(form) : f.label ?? f.name}{f.required && <span className="text-red-600"> *</span>}</span>
        {f.readonly ? <span className="flex h-9 items-center text-sm text-[#253b33]">{text(row?.[f.name]) || "—"}</span>
          : f.kind === "checkbox" ? <span className="flex h-9 items-center gap-2 text-sm text-[#253b33]"><Checkbox checked={Boolean(form[f.name])} onCheckedChange={(v) => set(f.name, v === true)} />Да</span>
          : f.kind === "select" ? <SearchSelect name={f.name} value={form[f.name]} onChange={(v) => set(f.name, v)} items={f.options!(data, form)} required={f.required} />
          : f.kind === "textarea" ? <textarea className={`${uiInput} min-h-20 py-2`} value={text(form[f.name])} onChange={(e) => set(f.name, e.target.value)} />
          : <input className={uiInput} type={f.kind === "date" ? "date" : f.kind === "text" ? "text" : "number"} step={f.kind === "text" || f.kind === "date" ? undefined : "any"} min={f.kind === "number" ? 0 : undefined} required={f.required} value={text(form[f.name])} onChange={(e) => set(f.name, e.target.value)} />}
      </label>)}
      {warning && <div className="rounded border border-[#ead7b8] bg-[#fff8eb] px-3 py-2 text-xs text-[#8d5b2d] sm:col-span-2">{warning}</div>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4 sm:col-span-2">
        {row && (confirm
          ? <span className="mr-auto flex items-center gap-2 text-xs text-[#a14b3d]">Удалить без возможности восстановления?<Button type="button" size="sm" variant="outline" className="border-[#e3b9b0] text-[#a14b3d] hover:bg-[#fdf3f1]" disabled={busy} onClick={() => onDelete(kind, row)}>Да, удалить</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>Нет</Button></span>
          : <Button type="button" variant="outline" className="mr-auto border-[#efd3cd] text-[#a14b3d] hover:bg-[#fdf3f1]" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={15} /> Удалить</Button>)}
        <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy} className="bg-[#147d6e] hover:bg-[#10675b]">{busy ? "Сохранение..." : "Сохранить"}</Button>
      </div>
    </form>
  </DialogContent></Dialog>;
}
