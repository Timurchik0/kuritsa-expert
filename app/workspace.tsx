"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BarChart3, Boxes, CalendarDays, Check, ChevronsUpDown, ChevronRight, ClipboardList, Columns3, CreditCard, Download, HandCoins, LayoutDashboard, List, Menu, Package, Plus, RefreshCw, Search, Ship, Truck, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalcInfo } from "./calc-info";
import { BatchCalculations, batchDetail } from "./batch-calculations";
import { accountInfo, contactInfo, movementInfo, paymentInfo, productInfo } from "./record-info";
import SummaryView from "./summary-view";
import SnapshotsView from "./snapshots-view";
import { ReconciliationsView, SettingsView, TaxesView } from "./finance-views";
import { BANK_FEE, INTERNAL_TAX, REPORT_RATE, RUSSIA_SALES_TAX, RUSSIA_VAT, batchEstimates, calculateSummary, kgPerBox, setting, supplierPaidSom } from "./finance";
import { createMovement, loadAffected, loadTables, payTax, receiveBatch, saveBatch, saveRecord, saveSnapshot, type DataResult, type Dataset, type Row, type TableKey, type TablesResult } from "./actions";
import WarehouseView from "./warehouse-view";
import BatchesList from "./batches-list";
import { groupByNumber, kinds } from "./ui-kit";
import LoansView from "./loans-view";
import QuotasView from "./quotas-view";
import SuppliersView from "./suppliers-view";
import AnalyticsView from "./analytics-view";

type Section = "summary" | "batches" | "warehouse" | "clients" | "loans" | "quotas" | "suppliers" | "money" | "analytics";
type Modal = "batch" | "shipment" | "receipt" | "payment" | "tax" | "taxPayment" | "reconciliation" | null;
type Entry = Record<string, unknown>;
const stages = ["Предоплата", "В пути", "На таможне", "На складе", "Продана"];
const nav = [
  { key: "summary", title: "Сводка", icon: LayoutDashboard },
  { key: "batches", title: "Партии", icon: Truck },
  { key: "warehouse", title: "Склад", icon: Boxes },
  { key: "clients", title: "Контрагенты", icon: Users },
  { key: "loans", title: "Займы", icon: HandCoins },
  { key: "quotas", title: "Квоты", icon: ClipboardList },
  { key: "suppliers", title: "Поставщики", icon: Ship },
  { key: "money", title: "Касса", icon: Wallet },
  { key: "analytics", title: "Аналитика", icon: BarChart3 },
] as const;
const som = (value: unknown, digits = 0) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value) || 0)} сом`;
const fmt = (value: unknown, digits = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(Number(value) || 0);
const n = (value: unknown) => Number(value) || 0;
const text = (value: unknown) => value == null ? "" : String(value);
const date = (value: unknown) => value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(value))) : "—";
const dateInput = (value: unknown) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(value))) : "";
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const displayInputDate = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(v)) ? text(v).split("-").reverse().join(".") : text(v);
function normalizeInputDate(v: unknown) {
  if (!v) return null;
  const raw = text(v);
  const iso = /^\d{2}\.\d{2}\.\d{4}$/.test(raw) ? raw.split(".").reverse().join("-") : raw;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== iso) throw new Error("Проверьте дату: нужен формат ДД.ММ.ГГГГ");
  return iso;
}
const label = (list: Row[], id: unknown) => text(list.find((item) => item.id === id)?.["Название"] ?? list.find((item) => item.id === id)?.["Партия"] ?? list.find((item) => item.id === id)?.["Номер партии"]) || "—";
const uiInput = "h-9 w-full rounded border border-[#dbe2df] bg-white px-3 text-sm text-[#22332f] outline-none focus:border-[#178779] focus:ring-2 focus:ring-[#178779]/10 disabled:bg-[#f3f5f4]";
const panel = "rounded-md border border-[#e1e7e4] bg-white";
const allTables: TableKey[] = ["products", "accounts", "contacts", "batches", "movements", "payments", "taxes", "reconciliations", "settings", "entities", "quotas", "licenses", "requests", "snapshots"];
const delayedFields: Partial<Record<TableKey, string[]>> = {
  contacts: ["Баланс", "Статус расчётов", "Последняя отгрузка", "Последний платёж"],
  products: ["Остаток, кг", "Остаток, коробок", "Стоимость остатка, сом", "Средняя плановая цена, сом/кг"],
  accounts: ["Остаток"],
  taxes: ["Остаток к уплате, сом"],
  batches: ["Аванс поставщику (в пути), сом"],
};
type PendingValues = Partial<Record<TableKey, Record<string, Record<string, unknown>>>>;
const settlementStatus = (balance: number) => balance > 1 ? "Должен нам" : balance < -1 ? "Мы должны" : "Рассчитались";
const latestDate = (current: unknown, next: unknown) => !current || dateInput(next) > dateInput(current) ? next : current;
function withContactChange(contact: Row, impact: number, dateField: "Последняя отгрузка" | "Последний платёж", when: unknown): Row {
  const balance = n(contact["Баланс"]) + impact;
  return { ...contact, "Баланс": balance, "Статус расчётов": settlementStatus(balance), [dateField]: latestDate(contact[dateField], when) };
}
const temp = (values: Entry): Row => ({ id: `temp-${crypto.randomUUID()}`, ...values });
const batchLabel = (name: string, form: Entry) => name === "Выгрузка / логистика" && form["Страна"] === "РФ" ? "Логистика итого, сом · авто" : ["Комиссия за перевод", "НДС и НсП"].includes(name) ? `${name} · авто` : name === "Цена ₽/кг" ? "Цена закупки, ₽/кг" : name === "Курс ₽→сом" ? "Курс ₽ → сом" : name === "Цена продажи сом/кг" ? "Цена продажи плановая, сом/кг" : name;
function batchNote(name: string, form: Entry) {
  if (name === "Комиссия за перевод") return "постоплата $ × 0,75% × курс постоплаты";
  if (name === "НДС и НсП") return form["Страна"] === "РФ" ? "кг × (НДС 12% + НсП (цена+НДС+2)×4%) от цены в сомах" : "4% × цена продажи × кг";
  if (name === "Выгрузка / логистика" && form["Страна"] === "РФ") return "логистика сом/кг × кг";
  if (name === "Заявка") return "список — заявки выбранной лицензии, ещё не привязанные к другой партии";
  return undefined;
}
// a quota / license / request fits a batch when its product and country (if set) match the batch
const fitsBatch = (doc: Row | undefined, batch: Entry) => Boolean(doc) && (!doc!["ТоварId"] || !batch["Товар"] || doc!["ТоварId"] === batch["Товар"]) && (!doc!["Страна"] || !batch["Страна"] || doc!["Страна"] === batch["Страна"]);
function matchingValue(name: string, actual: unknown, expected: unknown) {
  if (name.startsWith("Последн")) return dateInput(actual) === dateInput(expected);
  if (typeof expected === "number") return Math.abs(n(actual) - expected) < 0.01;
  return actual === expected;
}

type Choice = { value: string; title: string; group?: string };
function SearchSelect({ name, value, onChange, items, required, className = "", placeholder = "Выберите..." }: { name: string; value: unknown; onChange: (v: string) => void; items: Choice[]; required?: boolean; className?: string; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const sorted = [...items].sort((a, b) => {
    if (a.group === "Клиент" && b.group !== "Клиент") return -1;
    if (b.group === "Клиент" && a.group !== "Клиент") return 1;
    return a.title.localeCompare(b.title, "ru", { sensitivity: "base", numeric: true });
  });
  const chosen = items.find((item) => item.value === value);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" role="combobox" aria-label={name} aria-controls={listId} aria-expanded={open} aria-required={required} className={`${uiInput} flex items-center justify-between gap-2 text-left ${className}`}><span className={`min-w-0 truncate ${chosen ? "" : "text-[#9ba79f]"}`}>{chosen?.title || placeholder}</span><ChevronsUpDown size={15} className="shrink-0 text-[#8e9b92]" /></button></PopoverTrigger>
    <PopoverContent align="start" sideOffset={4} className="z-[80] w-[min(420px,calc(100vw-2rem))] p-0"><Command><CommandInput placeholder={`Поиск: ${name.toLocaleLowerCase("ru")}`} /><CommandList id={listId} className="max-h-64"><CommandEmpty>Ничего не найдено</CommandEmpty><CommandGroup>
      {!required && <CommandItem value="Очистить выбор" onSelect={() => { onChange(""); setOpen(false); }}><span className="text-[#85958a]">{placeholder}</span></CommandItem>}
      {sorted.map((item) => <CommandItem key={item.value} value={`${item.title} ${item.value}`} onSelect={() => { onChange(item.value); setOpen(false); }}><Check size={15} className={value === item.value ? "text-[#167d68]" : "opacity-0"} /><span className="min-w-0 truncate">{item.title}</span>{item.group && <span className="ml-auto shrink-0 text-[11px] text-[#91a097]">{item.group}</span>}</CommandItem>)}
    </CommandGroup></CommandList></Command></PopoverContent>
  </Popover>;
}
function Field({ name, label, note, value, onChange, options, kind = "text", required, hint, min = 0 }: { name: string; label?: string; note?: string; value: unknown; onChange: (v: unknown) => void; options?: Choice[]; kind?: string; required?: boolean; hint?: string; min?: number }) {
  return <div className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-[#65746e]">
    <span>{label ?? name}{required && <span className="text-red-600"> *</span>}</span>
    {kind === "checkbox" ? <span className="flex h-9 items-center gap-2 text-sm text-[#253b33]"><Checkbox aria-label={name} checked={Boolean(value)} onCheckedChange={(v) => onChange(v === true)} />{hint || "Да"}</span>
      : options ? <SearchSelect name={name} value={value} onChange={onChange} items={options} required={required} />
      : kind === "textarea" ? <textarea aria-label={name} className={`${uiInput} min-h-20 py-2`} value={text(value)} onChange={(e) => onChange(e.target.value)} />
      : <input aria-label={name} className={uiInput} type={kind === "date" ? "text" : kind} inputMode={kind === "date" ? "numeric" : undefined} placeholder={kind === "date" ? "ДД.ММ.ГГГГ" : undefined} pattern={kind === "date" ? "[0-9]{2}[.][0-9]{2}[.][0-9]{4}" : undefined} step={kind === "number" ? "any" : undefined} min={kind === "number" ? min : undefined} value={kind === "date" ? displayInputDate(value) : value == null ? "" : String(value)} required={required} onChange={(e) => onChange(e.target.value)} />}
    {note && <span className="text-[11px] font-normal text-[#8b998f]">{note}</span>}
  </div>;
}
function options(list: Row[], name = "Название", clientsFirst = false): Choice[] {
  return list.map((r) => ({ value: r.id, title: text(r[name]) || text(r["Номер партии"]), ...(clientsFirst ? { group: text(r["Тип"]) } : {}) }));
}
function Empty({ message = "Пока нет записей" }: { message?: string }) { return <div className="py-12 text-center text-sm text-[#83908b]">{message}</div>; }
function Title({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) { return <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[27px] font-semibold leading-tight text-[#1b3029]">{title}</h1>{subtitle && <p className="mt-1 text-sm text-[#77847e]">{subtitle}</p>}</div>{action}</div>; }
function Action({ children, onClick, variant = "primary" }: { children: React.ReactNode; onClick: () => void; variant?: "primary" | "outline" }) { return <Button size="sm" variant={variant === "outline" ? "outline" : "default"} className={variant === "primary" ? "bg-[#147d6e] text-white hover:bg-[#10675b]" : "border-[#dce4e0] bg-white text-[#344d43] hover:bg-[#f2f6f4]"} onClick={onClick}>{children}</Button>; }

const batchFields: { title: string; names: string[] }[] = [
  { title: "Основное", names: ["Номер партии", "Страна", "Поставщик", "Импортёр", "Статус", "Товар", "Номер фуры", "Дата предоплаты", "Дата прибытия", "Кг"] },
  { title: "Квота, лицензия, заявка", names: ["Квота", "Лицензия", "Заявка"] },
  { title: "Закупка и курсы", names: ["Цена $/кг", "Предоплата $", "Курс предоплаты", "Дата постоплаты", "Постоплата $", "Курс постоплаты", "Цена ₽/кг", "Курс ₽→сом", "Курс $ для отчёта"] },
  { title: "Расходы и продажа", names: ["Комиссия за перевод", "Банковские расходы", "Таможенная пошлина", "Прочие по таможне", "Логистика, сом/кг", "Выгрузка / логистика", "НДС и НсП", "Цена продажи сом/кг", "Комментарий"] },
];
const batchNumbers = new Set(["Кг", "Цена $/кг", "Предоплата $", "Курс предоплаты", "Постоплата $", "Курс постоплаты", "Цена ₽/кг", "Курс ₽→сом", "Курс $ для отчёта", "Комиссия за перевод", "Банковские расходы", "Таможенная пошлина", "НДС и НсП", "Прочие по таможне", "Логистика, сом/кг", "Выгрузка / логистика", "Цена продажи сом/кг"]);
// the form shows only the inputs of the batch's country (like the Excel sheets «расчет прибыли» and «РФ расчет»)
const chinaOnly = new Set(["Цена $/кг", "Предоплата $", "Курс предоплаты", "Дата предоплаты", "Дата постоплаты", "Постоплата $", "Курс постоплаты", "Комиссия за перевод", "Банковские расходы", "Таможенная пошлина", "Прочие по таможне"]);
const russiaOnly = new Set(["Цена ₽/кг", "Курс ₽→сом", "Логистика, сом/кг"]);
const autoBatchFields = ["Комиссия за перевод", "НДС и НсП", "Выгрузка / логистика"];
const batchDrivers: Record<string, string[]> = {
  "Комиссия за перевод": ["Постоплата $", "Курс постоплаты", "Страна"],
  "НДС и НсП": ["Страна", "Кг", "Цена продажи сом/кг", "Цена ₽/кг", "Курс ₽→сом"],
  "Выгрузка / логистика": ["Логистика, сом/кг", "Кг", "Страна"],
};
// fields copied when another product is added to the same batch number (one truck / one RF batch, several products)
const sharedBatchFields = ["Номер партии", "Страна", "Поставщик", "Импортёр", "Статус", "Номер фуры", "Дата предоплаты", "Дата прибытия", "Дата постоплаты", "Курс предоплаты", "Курс постоплаты", "Курс ₽→сом", "Курс $ для отчёта", "Логистика, сом/кг"];

export default function Workspace({ initial }: { initial: DataResult }) {
  const [result, setResult] = useState(initial);
  const [section, setSection] = useState<Section>("summary");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedBatch, setSelectedBatch] = useState<Row | null>(null);
  const [selectedContact, setSelectedContact] = useState<Row | null>(null);
  const [form, setForm] = useState<Entry>({});
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("Все");
  const [sortBalance, setSortBalance] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [moneyTab, setMoneyTab] = useState<"payments" | "taxes" | "reconciliations" | "entities" | "settings">("payments");
  const [batchView, setBatchView] = useState<"kanban" | "list">("kanban");
  const [statusFilter, setStatusFilter] = useState("");
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [selectedTax, setSelectedTax] = useState<Row | null>(null);
  const manualBatchFields = useRef(new Set<string>());
  const [paymentPage, setPaymentPage] = useState(0);
  const [dragged, setDragged] = useState<string | null>(null);
  const pendingRef = useRef<PendingValues>({});
  const createdRef = useRef<Partial<Record<TableKey, Set<string>>>>({});
  const versionsRef = useRef<Partial<Record<TableKey, number>>>({});
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);
  const data = result.data;
  const activeContact = selectedContact ? data.contacts.find((contact) => contact.id === selectedContact.id) ?? selectedContact : null;
  const patch = (name: string, value: unknown) => setForm((old) => ({ ...old, [name]: value }));
  const open = (name: Modal, defaults: Entry = {}, row: Row | null = null) => {
    setSelectedBatch(name === "batch" ? row : null);
    setSelectedTax(name === "taxPayment" ? row : null);
    manualBatchFields.current.clear();
    const latest = [...data.reconciliations].sort((a, b) => text(b["Дата свода"]).localeCompare(text(a["Дата свода"])))[0];
    const rate = setting(data, REPORT_RATE);
    setForm(name === "batch" ? row ? { ...Object.fromEntries(batchFields.flatMap((group) => group.names).map((key) => [key, row[key + "Id"] ?? (key.startsWith("Дата") ? dateInput(row[key]) : row[key]) ?? ""])), "Заявка": data.requests.find((r) => r["ПартияId"] === row.id)?.id ?? "" }
      : { "Статус": "Предоплата", "Страна": "Китай", "Курс $ для отчёта": rate ?? "", ...defaults }
      : name === "reconciliation" ? { "Дата свода": today(), "Остаток на начало, $": latest?.["Факт остаток, $"] ?? 0, "Факт остаток, $": summary.realUsd == null ? "" : Math.round(summary.realUsd * 100) / 100, "Факт расходов, $": 0, ...defaults }
      : { "Дата": today(), ...defaults });
    setModal(name);
  };
  // like Excel: changing an input recalculates the dependent cost fields (unless the user typed them by hand)
  const patchBatch = (name: string, value: unknown) => {
    if (autoBatchFields.includes(name)) manualBatchFields.current.add(name);
    setForm((previous) => {
      const next = { ...previous, [name]: value };
      const estimates = batchEstimates(next, data);
      const recalc = (field: string) => batchDrivers[field].includes(name) && !manualBatchFields.current.has(field);
      if (recalc("Комиссия за перевод") && estimates.commission != null) next["Комиссия за перевод"] = next["Страна"] === "РФ" ? 0 : estimates.commission;
      if (recalc("НДС и НсП") && estimates.tax != null) next["НДС и НсП"] = estimates.tax;
      if (recalc("Выгрузка / логистика") && next["Страна"] === "РФ" && n(next["Логистика, сом/кг"]) > 0) next["Выгрузка / логистика"] = Math.round(n(next["Логистика, сом/кг"]) * n(next["Кг"]) * 100) / 100;
      // quota → license → request: picking a child fills its parents, changing a parent drops children that no longer fit
      const license = data.licenses.find((l) => l.id === next["Лицензия"]);
      const request = data.requests.find((r) => r.id === next["Заявка"]);
      if (name === "Заявка" && request) { next["Лицензия"] = request["ЛицензияId"] ?? next["Лицензия"]; next["Квота"] = data.licenses.find((l) => l.id === request["ЛицензияId"])?.["КвотаId"] ?? next["Квота"]; }
      if (name === "Лицензия" && license) next["Квота"] = license["КвотаId"] ?? next["Квота"];
      if (next["Лицензия"] && !fitsBatch(data.licenses.find((l) => l.id === next["Лицензия"]), next) ) next["Лицензия"] = "";
      if (next["Квота"] && !fitsBatch(data.quotas.find((q) => q.id === next["Квота"]), next)) next["Квота"] = "";
      if (next["Лицензия"] && next["Квота"] && data.licenses.find((l) => l.id === next["Лицензия"])?.["КвотаId"] !== next["Квота"]) next["Лицензия"] = "";
      if (next["Заявка"] && (!fitsBatch(data.requests.find((r) => r.id === next["Заявка"]), next) || (next["Лицензия"] && data.requests.find((r) => r.id === next["Заявка"])?.["ЛицензияId"] !== next["Лицензия"]))) next["Заявка"] = "";
      return next;
    });
  };
  const addProductToBatch = (row: Row) => open("batch", Object.fromEntries(sharedBatchFields.map((key) => [key, row[key + "Id"] ?? (key.startsWith("Дата") ? dateInput(row[key]) : row[key]) ?? ""])));
  function mergeLoaded(current: DataResult, incoming: TablesResult, keys: TableKey[], partial: boolean): DataResult {
    const next: DataResult = { data: { ...current.data }, errors: { ...current.errors } };
    for (const key of keys) {
      const fetched = incoming.data[key];
      if (!fetched) { if (incoming.errors[key]) next.errors[key] = incoming.errors[key]; continue; }
      delete next.errors[key];
      const patches = pendingRef.current[key] ?? {};
      const created = createdRef.current[key];
      const ids = new Set(fetched.map((row) => row.id));
      const prepared = fetched.map((row) => {
        const fields = patches[row.id];
        if (!fields) return row;
        const merged = { ...row };
        for (const [name, expected] of Object.entries(fields)) {
          if (matchingValue(name, row[name], expected)) delete fields[name];
          else merged[name] = expected;
        }
        if (!Object.keys(fields).length) delete patches[row.id];
        return merged;
      });
      if (partial) {
        const updates = new Map(prepared.map((row) => [row.id, row]));
        const existing = new Set(current.data[key].map((row) => row.id));
        next.data[key] = current.data[key].map((row) => updates.get(row.id) ?? row);
        next.data[key].push(...prepared.filter((row) => !existing.has(row.id)));
      } else next.data[key] = prepared;
      if (created?.size) {
        for (const row of current.data[key]) {
          if (!created.has(row.id)) continue;
          if (ids.has(row.id)) created.delete(row.id);
          else if (!partial) next.data[key].push(row);
        }
      }
    }
    return next;
  }
  async function refreshData(keys: TableKey[], reader: () => Promise<TablesResult>, partial: boolean, showSpinner = false) {
    if (showSpinner) setReloading(true);
    const versions = Object.fromEntries(keys.map((key) => [key, versionsRef.current[key] = (versionsRef.current[key] ?? 0) + 1])) as Record<TableKey, number>;
    try {
      const incoming = await reader();
      const active = keys.filter((key) => versionsRef.current[key] === versions[key]);
      if (active.length) setResult((current) => mergeLoaded(current, incoming, active, partial));
      if (showSpinner && Object.keys(incoming.errors).length) toast.error("Не все данные обновились. Повторите попытку.");
    } catch {
      if (showSpinner) toast.error("Не удалось обновить данные. Повторите попытку.");
    } finally { if (showSpinner) setReloading(false); }
  }
  const refresh = () => refreshData(allTables, () => loadTables(allTables), false, true);
  const refreshRows = (selection: Partial<Record<TableKey, string[]>>) => refreshData(Object.keys(selection) as TableKey[], () => loadAffected(selection), true);
  async function run(optimistic: (d: Dataset) => Dataset, action: () => Promise<unknown>, success: string, affected: TableKey[], close = true) {
    if (busy) return;
    const previous = result;
    const previousPending = structuredClone(pendingRef.current);
    const previousCreated = Object.fromEntries(Object.entries(createdRef.current).map(([key, ids]) => [key, new Set(ids)])) as typeof createdRef.current;
    const optimisticData = optimistic(previous.data);
    const newRows: { key: TableKey; id: string }[] = [];
    const changedRows: Partial<Record<TableKey, Set<string>>> = {};
    for (const key of affected) {
      const oldRows = new Map(previous.data[key].map((row) => [row.id, row]));
      for (const row of optimisticData[key]) {
        if (row !== oldRows.get(row.id)) (changedRows[key] ??= new Set()).add(row.id);
        if (row.id.startsWith("temp-") && !oldRows.has(row.id)) {
          (createdRef.current[key] ??= new Set()).add(row.id);
          newRows.push({ key, id: row.id });
        }
        const original = oldRows.get(row.id);
        if (!original) continue;
        for (const name of delayedFields[key] ?? []) {
          if (!matchingValue(name, original[name], row[name])) {
            ((pendingRef.current[key] ??= {})[row.id] ??= {})[name] = row[name];
          }
        }
      }
    }
    setBusy(true);
    setResult((current) => ({ ...current, data: optimisticData }));
    if (close) setModal(null);
    try {
      const savedId = await action();
      if (typeof savedId === "string" && newRows.length === 1) {
        const [{ key, id }] = newRows;
        createdRef.current[key]?.delete(id);
        createdRef.current[key]?.add(savedId);
        changedRows[key]?.delete(id);
        changedRows[key]?.add(savedId);
        setResult((current) => ({ ...current, data: { ...current.data, [key]: current.data[key].map((row) => row.id === id ? { ...row, id: savedId } : row) } }));
      }
      toast.success(success);
      const selection = Object.fromEntries(Object.entries(changedRows).map(([key, ids]) => [key, [...ids].filter((id) => /^rec[A-Za-z0-9]+$/.test(id))]).filter(([, ids]) => ids.length)) as Partial<Record<TableKey, string[]>>;
      if (Object.keys(selection).length) for (const ms of [2000, 5000]) timersRef.current.push(setTimeout(() => { void refreshRows(selection); }, ms));
    } catch (error) {
      pendingRef.current = previousPending;
      createdRef.current = previousCreated;
      setResult(previous);
      toast.error(error instanceof Error ? error.message : "Операция не выполнена");
      if (close) setModal(modal);
    } finally { setBusy(false); }
  }
  const takeSnapshot = () => run((d) => d, async () => {
    await saveSnapshot();
    await refreshData(["snapshots"], () => loadTables(["snapshots"]), false);
  }, "Баланс зафиксирован", [], false);
  const linkName = (key: "products" | "contacts" | "accounts" | "batches", id: unknown) => label(data[key], id);
  const setPage = (page: Section) => { setSection(page); setMobileNav(false); setSelectedContact(null); setSearch(""); };

  const summary = calculateSummary(data);
  const customers = data.contacts.filter((c) => (typeFilter === "Все" || c["Тип"] === typeFilter) && text(c["Название"]).toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru"))).filter((c) => !statusFilter || settlementStatus(n(c["Баланс"])) === statusFilter).sort((a, b) => sortBalance ? n(b["Баланс"]) - n(a["Баланс"]) : text(a["Название"]).localeCompare(text(b["Название"]), "ru"));
  const visiblePayments = data.payments.filter((r) => (!accountFilter || r["СчётId"] === accountFilter) && (!categoryFilter || r["Категория"] === categoryFilter) && (!directionFilter || r["Направление"] === directionFilter) && (!periodFrom || dateInput(r["Дата"]) >= periodFrom) && (!periodTo || dateInput(r["Дата"]) <= periodTo)).sort((a, b) => text(b["Дата"]).localeCompare(text(a["Дата"])));
  const ledger = useMemo(() => {
    if (!activeContact) return [];
    const movements = data.movements.filter((r) => r["КонтрагентId"] === activeContact.id && r["В расчёт с контрагентом"]).map((r) => ({ ...r, source: "Отгрузка", impact: n(r["Влияние на долг"]) }));
    const payments = data.payments.filter((r) => r["КонтрагентId"] === activeContact.id && r["В расчёт с контрагентом"]).map((r) => ({ ...r, source: "Платёж", impact: n(r["Влияние на долг"]) }));
    let running = n(activeContact["Сальдо на начало"]);
    return [...movements, ...payments].sort((a, b) => text(a["Дата"]).localeCompare(text(b["Дата"])) || String(a.id).localeCompare(String(b.id))).map((r) => ({ ...r, running: running += r.impact }));
  }, [data.movements, data.payments, activeContact]);
  // act closing: after the last point where the balance became 0, older operations are hidden
  const closeIndex = ledger.reduce((last, r, i) => Math.abs(r.running) < 1 ? i : last, -1);
  const visibleLedger = ledger.map((r, i) => ({ r, i })).filter(({ i }) => showAllLedger || i > closeIndex);
  useEffect(() => { setShowAllLedger(false); }, [selectedContact?.id]);

  function submit() {
    const values = { ...form };
    try {
      for (const key of ["Дата", "Дата предоплаты", "Дата постоплаты", "Дата прибытия", "Дата свода"]) {
        if (key in values) values[key] = normalizeInputDate(values[key]);
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Некорректная дата"); return; }
    if (modal === "batch") {
      if (!values["Номер партии"] || !values["Товар"]) { toast.error("Укажите номер партии и товар"); return; }
      const id = selectedBatch?.id;
      const input = Object.fromEntries(Object.entries(values).filter(([key]) => batchFields.some((g) => g.names.includes(key))));
      const estimated = { ...input, "Оплачено поставщику, сом": supplierPaidSom(input), "Аванс поставщику (в пути), сом": ["Предоплата", "В пути", "На таможне"].includes(text(input["Статус"])) ? supplierPaidSom(input) : 0, "ТоварId": input["Товар"], "ПоставщикId": input["Поставщик"], "КвотаId": input["Квота"] || null, "ЛицензияId": input["Лицензия"] || null };
      run((d) => ({ ...d, batches: id ? d.batches.map((r) => r.id === id ? { ...r, ...estimated } : r) : [...d.batches, temp(estimated)], requests: id ? d.requests.map((r) => r.id === input["Заявка"] ? { ...r, "ПартияId": id } : r["ПартияId"] === id ? { ...r, "ПартияId": null } : r) : d.requests }), () => saveBatch(input, id), id ? "Партия обновлена" : "Партия создана", ["batches", "requests"]);
      for (const ms of [2500, 6000]) timersRef.current.push(setTimeout(() => { void refreshData(["requests", "batches"], () => loadTables(["requests", "batches"]), false); }, ms));
    } else if (modal === "shipment" || modal === "receipt") {
      const shipment = modal === "shipment";
      if (!values["Товар"] || (shipment && !values["Контрагент"])) { toast.error("Выберите товар и контрагента"); return; }
      const kg = n(values["Кг"]), price = n(values["Цена сом/кг"]), cost = n(data.batches.find((b) => b.id === values["Партия"])?.["Цена продажи сом/кг"]) || n(data.products.find((p) => p.id === values["Товар"])?.["Средняя плановая цена, сом/кг"]);
      if (shipment && kg > n(data.products.find((p) => p.id === values["Товар"])?.["Остаток, кг"])) { toast.error("Вес превышает остаток на складе"); return; }
      const input = { ...values, "Тип": shipment ? "Отгрузка" : "Приход", "В расчёт с контрагентом": shipment, "Цена плановая продажная, сом/кг": shipment ? cost : values["Цена плановая продажная, сом/кг"] };
      run((d) => ({ ...d, movements: [temp({ ...input, "ТоварId": input["Товар"], "КонтрагентId": input["Контрагент"], "ПартияId": input["Партия"], "Сумма, сом": kg * price, "Влияние на долг": shipment ? kg * price : 0 }), ...d.movements], products: d.products.map((p) => p.id === input["Товар"] ? { ...p, "Остаток, кг": n(p["Остаток, кг"]) + (shipment ? -kg : kg), "Остаток, коробок": n(p["Остаток, коробок"]) + (shipment ? -n(input["Коробки"]) : n(input["Коробки"])), "Стоимость остатка, сом": n(p["Стоимость остатка, сом"]) + (shipment ? -kg * cost : kg * n(input["Цена плановая продажная, сом/кг"])) } : p), contacts: shipment ? d.contacts.map((c) => c.id === input["Контрагент"] ? withContactChange(c, kg * price, "Последняя отгрузка", input["Дата"]) : c) : d.contacts }), () => createMovement(input), shipment ? "Отгрузка записана" : "Приход записан", shipment ? ["movements", "products", "contacts"] : ["movements", "products"]);
    } else if (modal === "tax") {
      if (!values["Основание"] || !values["Дата"] || n(values["Начислено, сом"]) < 0) { toast.error("Укажите основание, дату и начисление"); return; }
      const input = { "Основание": values["Основание"], "Дата": values["Дата"], "Начислено, сом": values["Начислено, сом"], "Комментарий": values["Комментарий"] };
      run((d) => ({ ...d, taxes: [...d.taxes, temp({ ...input, "Оплачено, сом": 0, "Остаток к уплате, сом": n(values["Начислено, сом"]), "Направление": /рф/i.test(text(values["Основание"])) ? "РФ" : "Китай" })] }), () => saveRecord("taxes", input), "Начисление добавлено", ["taxes"]);
    } else if (modal === "taxPayment") {
      if (!selectedTax || !values["Счёт"] || n(values["Сумма"]) <= 0 || n(values["Сумма"]) > n(selectedTax["Остаток к уплате, сом"])) { toast.error("Проверьте счёт и сумму налога"); return; }
      const amount = n(values["Сумма"]);
      const payment = { "Дата": values["Дата"], "СчётId": values["Счёт"], "Направление": "Расход", "Сумма": amount, "Сумма, сом": amount, "Валюта": "сом", "Категория": "Налоги", "Описание": `Налог: ${text(selectedTax["Основание"])}`, "В расчёт с контрагентом": false };
      run((d) => ({ ...d, taxes: d.taxes.map((row) => row.id === selectedTax.id ? { ...row, "Оплачено, сом": n(row["Оплачено, сом"]) + amount, "Остаток к уплате, сом": n(row["Остаток к уплате, сом"]) - amount } : row), payments: [temp(payment), ...d.payments], accounts: d.accounts.map((row) => row.id === values["Счёт"] ? { ...row, "Остаток": n(row["Остаток"]) - amount } : row) }), () => payTax(selectedTax.id, text(values["Счёт"]), amount, text(values["Дата"])), "Налог оплачен", ["taxes", "payments", "accounts"]);
    } else if (modal === "reconciliation") {
      if (!values["Партии в своде"] || !values["Дата свода"] || values["Факт остаток, $"] === "") { toast.error("Укажите партии, дату и факт остаток"); return; }
      const input = Object.fromEntries(["Партии в своде", "Дата свода", "Остаток на начало, $", "Прибыль по партиям, $", "Факт остаток, $", "Факт расходов, $", "Комментарий"].map((key) => [key, values[key] ?? null]));
      const after = n(input["Остаток на начало, $"]) + n(input["Прибыль по партиям, $"]);
      const calculated = after - n(input["Факт расходов, $"]);
      run((d) => ({ ...d, reconciliations: [...d.reconciliations, temp({ ...input, "После поставки, $": after, "Расчётный остаток, $": calculated, "Расхождение, $": n(input["Факт остаток, $"]) - calculated })] }), () => saveRecord("reconciliations", input), "Сверка сохранена", ["reconciliations"]);
    } else if (modal === "payment") {
      if (!values["Счёт"]) { toast.error("Выберите счёт"); return; }
      const amount = n(values["Сумма"]) * (values["Валюта"] === "сом" ? 1 : n(values["Курс"]));
      const direction = values["Направление"] === "Приход" ? 1 : -1;
      const impact = values["В расчёт с контрагентом"] ? -direction * amount : 0;
      const input = { ...values, "Курс": values["Валюта"] === "сом" ? null : values["Курс"] };
      run((d) => ({ ...d, payments: [temp({ ...input, "СчётId": input["Счёт"], "КонтрагентId": input["Контрагент"], "ПартияId": input["Партия"], "Сумма, сом": amount, "Влияние на долг": impact }), ...d.payments], accounts: d.accounts.map((a) => a.id === input["Счёт"] ? { ...a, "Остаток": n(a["Остаток"]) + direction * amount } : a), contacts: d.contacts.map((c) => c.id === input["Контрагент"] ? withContactChange(c, impact, "Последний платёж", input["Дата"]) : c) }), () => saveRecord("payments", input), "Платёж записан", ["payments", "accounts", "contacts"]);
    }
  }
  function saveQuota(key: TableKey, input: Entry, optimistic: Entry) {
    const title = key === "quotas" ? "Квота создана" : key === "licenses" ? "Лицензия добавлена" : "Заявка добавлена";
    run((d) => ({ ...d, [key]: [...d[key], temp(optimistic)] }), () => saveRecord(key, input), title, [key]);
    const keys: TableKey[] = ["quotas", "licenses", "requests"];
    for (const ms of [2500, 6000]) timersRef.current.push(setTimeout(() => { void refreshData(keys, () => loadTables(keys), false); }, ms));
  }
  function saveSetting(row: Row, value: number) {
    run((d) => ({ ...d, settings: d.settings.map((item) => item.id === row.id ? { ...item, "Значение": value } : item) }), () => saveRecord("settings", { "Значение": value }, row.id), "Настройка сохранена", ["settings"], false);
  }
  function moveBatch(id: string, status: string) { moveBatches(id.split(","), status); }
  function moveBatches(ids: string[], status: string) {
    const list = data.batches.filter((b) => ids.includes(b.id) && b["Статус"] !== status);
    if (!list.length) return;
    if (status === "На складе" && list.some((b) => !["На складе", "Продана"].includes(text(b["Статус"])))) {
      toast.info("Для приёмки используйте кнопку «Принять на склад»"); return;
    }
    const moved = new Set(list.map((b) => b.id));
    run((d) => ({ ...d, batches: d.batches.map((b) => moved.has(b.id) ? { ...b, "Статус": status, "Аванс поставщику (в пути), сом": ["Предоплата", "В пути", "На таможне"].includes(status) ? n(b["Оплачено поставщику, сом"]) : 0 } : b) }), async () => { for (const b of list) await saveRecord("batches", { "Статус": status }, b.id); }, "Статус обновлён", ["batches"], false);
  }

  function receive(batch: Row) {
    const kg = n(batch["Кг"]), cost = n(batch["Цена продажи сом/кг"]);
    if (cost <= 0) { toast.error("У партии не указана плановая цена продажи"); return; }
    const perBox = kgPerBox(data.products.find((row) => row.id === batch["ТоварId"]));
    if (!perBox) { toast.error("У товара не задано поле «Кг в коробке»"); return; }
    const boxes = kg / perBox;
    run((d) => ({ ...d, batches: d.batches.map((b) => b.id === batch.id ? { ...b, "Статус": "На складе", "Дата прибытия": today(), "Аванс поставщику (в пути), сом": 0 } : b), products: d.products.map((p) => p.id === batch["ТоварId"] ? { ...p, "Остаток, кг": n(p["Остаток, кг"]) + kg, "Остаток, коробок": n(p["Остаток, коробок"]) + boxes, "Стоимость остатка, сом": n(p["Стоимость остатка, сом"]) + kg * cost } : p), movements: [temp({ "Дата": today(), "Тип": "Приход", "ТоварId": batch["ТоварId"], "ПартияId": batch.id, "Кг": kg, "Коробки": boxes, "Цена сом/кг": cost, "Цена плановая продажная, сом/кг": cost }), ...d.movements] }), () => receiveBatch(batch.id), "Партия принята на склад", ["batches", "products", "movements"], false);
  }  // several products of one batch number arrive together: receive them one by one, then reload stock and movements
  function receiveGroup(group: Row[]) {
    const ready = group.filter((b) => ["В пути", "На таможне"].includes(text(b["Статус"])));
    const bad = ready.find((b) => n(b["Цена продажи сом/кг"]) <= 0 || !kgPerBox(data.products.find((p) => p.id === b["ТоварId"])));
    if (bad) { toast.error(`${text(bad["Партия"])}: нужна плановая цена продажи и «Кг в коробке» у товара`); return; }
    const ids = new Set(ready.map((b) => b.id));
    const keys: TableKey[] = ["batches", "products", "movements"];
    run((d) => ({ ...d, batches: d.batches.map((b) => ids.has(b.id) ? { ...b, "Статус": "На складе", "Дата прибытия": today(), "Аванс поставщику (в пути), сом": 0 } : b) }), async () => {
      for (const b of ready) await receiveBatch(b.id);
      await refreshData(keys, () => loadTables(keys), false);
    }, `Принято на склад: ${ready.length}`, [], false);
  }

  const batchCard = (b: Row, stage: string) => <div key={b.id} draggable={!busy} onDragStart={() => setDragged(b.id)} onDragEnd={() => setDragged(null)} className="cursor-grab rounded border border-[#e0e7e3] bg-white p-3 shadow-[0_1px_2px_rgba(20,50,30,.03)] active:cursor-grabbing"><div className="w-full text-left"><button className="w-full text-left" onClick={() => open("batch", {}, b)}><div className="flex items-start justify-between gap-2"><strong className="line-clamp-2 text-[13px] text-[#263d32]">{text(b["Партия"]) || text(b["Номер партии"])}</strong><ChevronRight className="shrink-0 text-[#9aaba2]" size={15} /></div><div className="mt-2 text-xs text-[#7a8a80]">{linkName("products", b["ТоварId"])} · {fmt(b["Кг"])} кг</div></button><div className="mt-3 border-t border-[#eef1ef] pt-2.5 text-xs"><div className="flex justify-between"><span className="text-[#89978e]">{stage === "Продана" ? "Прибыль" : "Прибыль (план)"}</span><span className="inline-flex items-center gap-1"><strong className={n(b["Прибыль, сом"]) < 0 ? "text-[#b9584c]" : "text-[#287862]"}>{som(b["Прибыль, сом"])}</strong><CalcInfo label="Прибыль, сом" {...batchDetail("Прибыль, сом", b)} /></span></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[#89978e]">Аванс в пути</span><span className="inline-flex items-center gap-1 font-semibold tabular-nums">{som(b["Аванс поставщику (в пути), сом"])}<CalcInfo label="Аванс поставщику (в пути), сом" {...batchDetail("Аванс поставщику (в пути), сом", b)} /></span></div></div></div>{["В пути", "На таможне"].includes(stage) && <button className="mt-3 w-full rounded border border-[#bcd9ce] px-2 py-1.5 text-xs font-medium text-[#167561] hover:bg-[#eff8f3] disabled:opacity-50" disabled={busy} onClick={() => receive(b)}>Принять на склад</button>}</div>;
  // one batch number with several products (e.g. РФ-2: голень + бедро) is shown as one card with an «итого» line
  const batchGroupCard = (group: Row[], stage: string) => {
    const kg = group.reduce((s, b) => s + n(b["Кг"]), 0), profit = group.reduce((s, b) => s + n(b["Прибыль, сом"]), 0), advance = group.reduce((s, b) => s + n(b["Аванс поставщику (в пути), сом"]), 0);
    return <div key={`group-${group[0].id}`} draggable={!busy} onDragStart={() => setDragged(group.map((b) => b.id).join(","))} onDragEnd={() => setDragged(null)} className="cursor-grab rounded border border-[#cfe0d6] bg-white p-3 shadow-[0_1px_2px_rgba(20,50,30,.03)] active:cursor-grabbing">
      <div className="flex items-center justify-between gap-2"><strong className="text-[13px] text-[#263d32]">Партия {text(group[0]["Номер партии"])}</strong><span className="rounded bg-[#eef5f1] px-1.5 py-0.5 text-[10px] text-[#5d7568]">{kinds(group.length)}</span></div>
      <div className="mt-2 divide-y divide-[#eef1ef]">{group.map((b) => <button key={b.id} className="flex w-full items-center justify-between gap-2 py-1.5 text-left text-xs hover:bg-[#f6faf8]" onClick={() => open("batch", {}, b)}><span className="min-w-0 truncate text-[#4f6158]">{linkName("products", b["ТоварId"])} · {fmt(b["Кг"])} кг</span><span className={`shrink-0 font-medium tabular-nums ${n(b["Прибыль, сом"]) < 0 ? "text-[#b9584c]" : "text-[#287862]"}`}>{som(b["Прибыль, сом"])}</span></button>)}</div>
      <div className="mt-2 border-t border-[#dfe8e2] pt-2 text-xs"><div className="flex justify-between font-semibold"><span>Итого · {fmt(kg)} кг</span><span className="inline-flex items-center gap-1"><span className={profit < 0 ? "text-[#b9584c]" : "text-[#287862]"}>{som(profit)}</span><CalcInfo label={`Итого по партии ${text(group[0]["Номер партии"])}`} formula={stage === "Продана" ? "Σ прибыли видов товара партии" : "Σ плановой прибыли видов товара партии"} substitution={`${group.map((b) => som(b["Прибыль, сом"])).join(" + ")} = ${som(profit)}`} source="Партии с одинаковым номером" excel="«РФ расчет»: V «итого прибыль сом» по партии" /></span></div>{advance > 0 && <div className="mt-1 flex justify-between text-[#89978e]"><span>Аванс в пути</span><span className="tabular-nums">{som(advance)}</span></div>}</div>
      {["В пути", "На таможне"].includes(stage) && <button className="mt-3 w-full rounded border border-[#bcd9ce] px-2 py-1.5 text-xs font-medium text-[#167561] hover:bg-[#eff8f3] disabled:opacity-50" disabled={busy} onClick={() => receiveGroup(group)}>Принять всё на склад</button>}
      <button className="mt-2 w-full text-center text-[11px] text-[#5d7568] hover:underline" onClick={() => addProductToBatch(group[0])}>+ вид товара в партию</button>
    </div>;
  };
  const fail = (keys: (keyof Dataset)[]) => keys.some((key) => result.errors[key] && !data[key].length);
  const csv = () => {
    const rows = visiblePayments.map((r) => [date(r["Дата"]), linkName("accounts", r["СчётId"]), r["Направление"], r["Категория"], r["Сумма"], r["Валюта"], r["Курс"], r["Сумма, сом"], linkName("contacts", r["КонтрагентId"]), r["Описание"]]);
    const header = ["Дата", "Счёт", "Направление", "Категория", "Сумма", "Валюта", "Курс", "Сумма сом", "Контрагент", "Описание"];
    const content = [header, ...rows].map((line) => line.map((v) => `"${text(v).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "платежи.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return <TooltipProvider delayDuration={150}><div className="min-h-screen bg-[#f7f9f8] text-[#21352e] lg:flex">
    <aside className="hidden w-[226px] shrink-0 border-r border-[#e2e8e4] bg-white lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen">
      <div className="flex h-[76px] items-center gap-3 border-b border-[#edf0ee] px-6"><div className="flex h-9 w-9 items-center justify-center rounded bg-[#147d6e] text-white"><Package size={19} /></div><div><div className="text-[15px] font-bold leading-5">Курица — Эксперт</div><div className="text-[11px] text-[#85938b]">Управление бизнесом</div></div></div>
      <div className="px-4 pt-7 text-[10px] font-semibold uppercase text-[#a1aba6]">Рабочее пространство</div>
      <nav className="mt-3 space-y-1 px-3">{nav.map(({ key, title, icon: Icon }) => <button key={key} onClick={() => setPage(key)} className={`flex h-10 w-full items-center gap-3 rounded px-3 text-sm transition-colors ${section === key ? "bg-[#e6f3ee] font-semibold text-[#087565]" : "text-[#65746e] hover:bg-[#f4f7f5] hover:text-[#1e3830]"}`}><Icon size={18} strokeWidth={1.8} />{title}</button>)}</nav>
      <div className="mt-auto border-t border-[#edf0ee] px-5 py-5 text-xs text-[#83928a]">Кыргызстан · KGS</div>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-[65px] items-center justify-between border-b border-[#e2e8e4] bg-white/95 px-4 backdrop-blur lg:px-8"><div className="flex items-center gap-3"><button className="lg:hidden" aria-label="Открыть меню" onClick={() => setMobileNav(!mobileNav)}><Menu size={21} /></button><div className="hidden text-sm text-[#91a099] sm:block">Рабочее пространство <ChevronRight className="inline" size={14} /> </div><strong className="text-sm font-medium">{nav.find((v) => v.key === section)?.title}</strong></div><div className="flex items-center gap-3"><span className="hidden items-center gap-1.5 text-xs text-[#809088] sm:flex"><CalendarDays size={14} />{date(new Date().toISOString())}</span><button title="Обновить данные" aria-label="Обновить данные" onClick={refresh} disabled={reloading || busy} className="rounded p-2 text-[#667c72] hover:bg-[#edf3f0]"><RefreshCw size={17} className={reloading ? "animate-spin" : ""} /></button><div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dcebe5] text-xs font-semibold text-[#216855]">КЭ</div></div></header>
      {mobileNav && <nav className="sticky top-[65px] z-20 flex overflow-x-auto border-b border-[#e2e8e4] bg-white px-3 py-2 lg:hidden">{nav.map(({ key, title, icon: Icon }) => <button key={key} onClick={() => setPage(key)} className={`flex shrink-0 items-center gap-2 rounded px-3 py-2 text-sm ${section === key ? "bg-[#e6f3ee] text-[#087565]" : "text-[#607069]"}`}><Icon size={16} />{title}</button>)}</nav>}
      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 lg:px-9 lg:py-8">
        {Object.keys(result.errors).length > 0 && <div className="mb-5 flex items-center justify-between gap-2 rounded border border-[#e9c9a4] bg-[#fff9ee] p-3 text-sm text-[#8d5b2d]">Часть данных не обновилась. Показаны последние доступные значения.<button onClick={refresh} className="underline">Повторить</button></div>}
        {section === "summary" && <>
          <Title title="Сводка бизнеса" subtitle="Деньги, обязательства и товарный запас на сегодня" />
          {fail(["accounts", "contacts", "products", "batches", "taxes", "settings"]) ? <Empty message="Сводка недоступна: ошибка загрузки одного из источников" /> : <><SummaryView data={data} summary={summary} /><SnapshotsView rows={data.snapshots} summary={summary} busy={busy} onSnapshot={takeSnapshot} /></>}
        </>}
        {section === "batches" && <><Title title="Партии" subtitle={`${data.batches.length} партий · движение от предоплаты до продажи`} action={<div className="flex items-center gap-2"><div className="flex rounded border border-[#dce6de] bg-white p-1">{([["kanban", "Канбан", Columns3], ["list", "Список", List]] as const).map(([key, title, Icon]) => <button key={key} onClick={() => setBatchView(key)} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs ${batchView === key ? "bg-[#e5f2eb] font-semibold text-[#14745f]" : "text-[#708177]"}`}><Icon size={14} />{title}</button>)}</div><Action onClick={() => open("batch")}><Plus size={16} /> Новая партия</Action></div>} />{fail(["batches"]) ? <Empty message="Не удалось загрузить партии" /> : batchView === "list" ? <BatchesList data={data} stages={stages} onOpen={(b) => open("batch", {}, b)} onAddProduct={addProductToBatch} /> : <div className="flex min-h-[560px] gap-3 overflow-x-auto pb-5">{stages.map((stage, i) => { const list = data.batches.filter((b) => b["Статус"] === stage).sort((a, b) => stage === "Продана" ? dateInput(b["Дата прибытия"]).localeCompare(dateInput(a["Дата прибытия"])) : 0); return <div key={stage} className="w-[255px] min-w-[255px] rounded-md bg-[#eef2f0] p-2.5" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragged) moveBatch(dragged, stage); setDragged(null); }}><div className="mb-3 flex items-center gap-2 px-1.5 py-1 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${["bg-[#ca9b59]", "bg-[#5e9eb2]", "bg-[#b79a6d]", "bg-[#298d70]", "bg-[#889990]"][i]}`} />{stage}<span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[11px] text-[#728079]">{list.length}</span></div><div className="max-h-[75vh] space-y-2 overflow-y-auto pr-0.5">{groupByNumber(list).map((group) => group.length === 1 ? batchCard(group[0], stage) : batchGroupCard(group, stage))}</div></div>; })}</div>}</>}
        {section === "warehouse" && <><Title title="Склад" subtitle="Остатки и движения товара" action={<div className="flex gap-2"><Action variant="outline" onClick={() => open("receipt", { "Тип": "Приход" })}><Plus size={16} /> Приход</Action><Action onClick={() => open("shipment", { "Тип": "Отгрузка" })}><Truck size={16} /> Отгрузка клиенту</Action></div>} />{fail(["products", "movements"]) ? <Empty message="Не удалось загрузить склад" /> : <WarehouseView data={data} />}</>}
        {section === "clients" && <><Title title="Контрагенты" subtitle={`${customers.length} из ${data.contacts.length} · клиенты, партнёры, поставщики, займы`} />{fail(["contacts", "movements", "payments"]) ? <Empty message="Не удалось загрузить расчёты контрагентов" /> : <><div className="mb-4 flex flex-wrap gap-2"><div className="relative min-w-[180px] flex-1 md:max-w-xs"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="pl-9" placeholder="Поиск по названию" value={search} onChange={(e) => setSearch(e.target.value)} /></div><SearchSelect name="Тип контрагента" value={typeFilter === "Все" ? "" : typeFilter} onChange={(v) => setTypeFilter(v || "Все")} items={["Клиент", "Партнёр", "Поставщик", "Заёмщик", "Займодавец", "Прочее"].map((v) => ({ value: v, title: v }))} placeholder="Все типы" className="w-44" /><SearchSelect name="Статус расчётов" value={statusFilter} onChange={setStatusFilter} items={["Должен нам", "Мы должны", "Рассчитались"].map((v) => ({ value: v, title: v }))} placeholder="Все статусы" className="w-44" /><button className="rounded border border-[#dce4e0] bg-white px-3 text-xs text-[#5d7166] hover:bg-[#f0f6f2]" onClick={() => setSortBalance(!sortBalance)}>Баланс {sortBalance ? "↓" : "↕"}</button></div><div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[740px] text-left text-sm"><thead className="border-b bg-[#fbfcfb] text-xs text-[#849289]"><tr>{["Контрагент", "Тип", "Телефон", "Последняя отгрузка", "Статус", "Баланс"].map((h) => <th key={h} className={`px-4 py-3 ${h === "Баланс" ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>{customers.map((c) => <tr key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-[#f5faf7]" onClick={() => setSelectedContact(c)}><td className="px-4 py-3 font-medium">{text(c["Название"])}</td><td className="px-4 py-3 text-[#7d8a82]">{text(c["Тип"])}</td><td className="px-4 py-3 text-[#7d8a82]">{text(c["Телефон"]) || "—"}</td><td className="px-4 py-3 text-[#7d8a82]">{date(c["Последняя отгрузка"])}</td><td className="px-4 py-3"><Badge variant="outline" className={n(c["Баланс"]) > 0 ? "border-[#ead7b8] bg-[#fff8eb] text-[#a36a2f]" : n(c["Баланс"]) < 0 ? "border-[#d5e5ed] bg-[#f0f8fb] text-[#4f8095]" : "border-[#d8e8db] bg-[#f2f8f2] text-[#488061]"}>{text(c["Статус расчётов"]) || (n(c["Баланс"]) === 0 ? "Закрыто" : "Открыто")}</Badge></td><td className={`px-4 py-3 text-right font-medium tabular-nums ${n(c["Баланс"]) < 0 ? "text-[#b45c50]" : ""}`}><span className="inline-flex items-center gap-1">{som(c["Баланс"])}<CalcInfo label="Баланс контрагента" {...contactInfo(c)} /></span></td></tr>)}</tbody></table>{!customers.length && <Empty message="Контрагенты не найдены" />}</div></>}</>}
        {section === "money" && <><Title title="Касса" subtitle="Счета по юрлицам, платежи, плановые расходы и сверки" action={<Action onClick={() => open("payment", { "Направление": "Расход", "Валюта": "сом", "Категория": "Прочие расходы", "В расчёт с контрагентом": false })}><Plus size={16} /> Новый платёж / расход</Action>} />{fail(moneyTab === "taxes" ? ["taxes", "accounts"] : moneyTab === "reconciliations" ? ["reconciliations"] : moneyTab === "settings" ? ["settings"] : moneyTab === "entities" ? ["entities"] : ["accounts", "payments", "contacts"]) ? <Empty message="Не удалось загрузить данные раздела" /> : <><div className="mb-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">{[...new Set(data.accounts.map((a) => text(a["Юрлицо"])) )].map((entity) => <div key={entity} className="border-l-2 border-[#9abeb0] pl-4"><div className="mb-3 text-xs font-semibold text-[#647a6b]">{entity || "Без юрлица"}</div><div className="space-y-2">{data.accounts.filter((a) => text(a["Юрлицо"]) === entity).map((a) => <div key={a.id} className={`${panel} px-3 py-3`}><div className="flex items-start justify-between gap-2 text-xs text-[#77877c]"><span>{text(a["Название"])}</span><CreditCard size={15} /></div><div className={`mt-3 text-lg font-semibold tabular-nums ${n(a["Остаток"]) < 0 ? "text-[#b85c4f]" : ""}`}><span className="inline-flex items-center gap-1">{som(a["Остаток"], 2)}<CalcInfo label="Остаток счёта" {...accountInfo(a, data.payments)} /></span></div>{!a["Учитывать в сводке"] && <div className="mt-1 text-[11px] text-[#9aa69c]">Вне сводки</div>}</div>)}</div></div>)}</div><div className="mb-4 flex items-center gap-5 overflow-x-auto border-b border-[#dfe8e1]"><button onClick={() => setMoneyTab("payments")} className={`border-b-2 pb-3 text-sm ${moneyTab === "payments" ? "border-[#147d6e] font-semibold text-[#126e60]" : "border-transparent text-[#829087]"}`}>Журнал платежей</button>{([["taxes", "Плановые расходы"], ["reconciliations", "Сверки"], ["entities", "Юрлица"], ["settings", "Настройки"]] as const).map(([key, label]) => <button key={key} onClick={() => setMoneyTab(key)} className={`shrink-0 border-b-2 pb-3 text-sm ${moneyTab === key ? "border-[#147d6e] font-semibold text-[#126e60]" : "border-transparent text-[#829087]"}`}>{label}</button>)}</div>{moneyTab === "taxes" ? <TaxesView rows={data.taxes} onCreate={() => open("tax")} onPay={(row) => open("taxPayment", { "Сумма": n(row["Остаток к уплате, сом"]), "Счёт": "" }, row)} /> : moneyTab === "reconciliations" ? <ReconciliationsView rows={data.reconciliations} onCreate={() => open("reconciliation")} /> : moneyTab === "settings" ? <SettingsView rows={data.settings} onSave={saveSetting} busy={busy} />  : moneyTab === "entities" ? <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[1000px] text-left text-sm"><thead className="border-b bg-[#fbfcfb] text-xs text-[#849289]"><tr>{["Юрлицо", "Форма", "ИНН", "Руководитель", "Юридический адрес", "Склад", "Разрешение ЕАЭС", "Комментарий"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{data.entities.map((e) => <tr key={e.id} className="border-b last:border-0 align-top"><td className="px-4 py-3 font-medium">{text(e["Название"])}</td><td className="px-4 py-3">{text(e["Форма"])}</td><td className="px-4 py-3 tabular-nums">{text(e["ИНН"]) || "—"}</td><td className="px-4 py-3">{text(e["Руководитель"]) || "—"}</td><td className="px-4 py-3">{text(e["Юридический адрес"]) || "—"}</td><td className="px-4 py-3">{text(e["Склад"]) || "—"}</td><td className="px-4 py-3 text-xs">{text(e["Разрешение ЕАЭС"]) || "—"}</td><td className="max-w-72 px-4 py-3 text-xs text-[#74847a]">{text(e["Комментарий"]) || "—"}</td></tr>)}</tbody></table></div> : <><div className="mb-4 flex flex-wrap items-center gap-2"><SearchSelect name="Счёт" value={accountFilter} onChange={(v) => { setAccountFilter(v); setPaymentPage(0); }} items={options(data.accounts)} placeholder="Все счета" className="w-44" /><SearchSelect name="Категория" value={categoryFilter} onChange={(v) => { setCategoryFilter(v); setPaymentPage(0); }} items={[...new Set(data.payments.map((r) => text(r["Категория"])).filter(Boolean))].map((v) => ({ value: v, title: v }))} placeholder="Все категории" className="w-48" /><SearchSelect name="Направление" value={directionFilter} onChange={(v) => { setDirectionFilter(v); setPaymentPage(0); }} items={["Приход", "Расход"].map((v) => ({ value: v, title: v }))} placeholder="Все направления" className="w-40" /><input aria-label="С даты" title="С даты" className={`${uiInput} w-36`} type="date" value={periodFrom} onChange={(e) => { setPeriodFrom(e.target.value); setPaymentPage(0); }} /><input aria-label="По дату" title="По дату" className={`${uiInput} w-36`} type="date" value={periodTo} onChange={(e) => { setPeriodTo(e.target.value); setPaymentPage(0); }} /><button title="Скачать CSV" aria-label="Скачать CSV" className="rounded border border-[#dce4e0] bg-white p-2 hover:bg-[#f2f6f4]" onClick={csv}><Download size={17} /></button></div><div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[850px] text-left text-sm"><thead className="border-b bg-[#fbfcfb] text-xs text-[#849289]"><tr>{["Дата", "Счёт", "Направление", "Категория", "Контрагент", "Описание", "Сумма, сом"].map((h) => <th className={`px-4 py-3 ${h === "Сумма, сом" ? "text-right" : ""}`} key={h}>{h}</th>)}</tr></thead><tbody>{visiblePayments.slice(paymentPage * 50, (paymentPage + 1) * 50).map((r) => <tr className="border-b last:border-0" key={r.id}><td className="px-4 py-3 text-[#7d8b81]">{date(r["Дата"])}</td><td className="px-4 py-3">{linkName("accounts", r["СчётId"])}</td><td className={`px-4 py-3 ${r["Направление"] === "Приход" ? "text-[#228166]" : "text-[#b16f42]"}`}>{text(r["Направление"])}</td><td className="px-4 py-3">{text(r["Категория"]) || "—"}</td><td className="px-4 py-3">{linkName("contacts", r["КонтрагентId"])}</td><td className="max-w-52 truncate px-4 py-3 text-[#74847a]" title={text(r["Описание"])}>{text(r["Описание"]) || "—"}</td><td className={`px-4 py-3 text-right font-medium tabular-nums ${r["Направление"] === "Расход" ? "text-[#ad6856]" : "text-[#227964]"}`}><span className="inline-flex items-center gap-1">{r["Направление"] === "Расход" ? "−" : "+"}{som(r["Сумма, сом"], 2)}<CalcInfo label="Сумма платежа, сом" {...paymentInfo(r)} /></span></td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#798a80]"><span>{visiblePayments.length ? `${paymentPage * 50 + 1}–${Math.min((paymentPage + 1) * 50, visiblePayments.length)} из ${visiblePayments.length}` : "Нет платежей по фильтрам"}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={paymentPage === 0} onClick={() => setPaymentPage((v) => v - 1)}>Назад</Button><Button size="sm" variant="outline" disabled={(paymentPage + 1) * 50 >= visiblePayments.length} onClick={() => setPaymentPage((v) => v + 1)}>Далее</Button></div></div></>}</>}</>}
        {section === "loans" && <><Title title="Займы" subtitle="Кредит банка, полученные и выданные займы · карточка по каждому" />{fail(["contacts"]) ? <Empty message="Не удалось загрузить займы" /> : <LoansView data={data} onPayment={(id) => open("payment", { "Направление": "Приход", "Валюта": "сом", "Категория": "Займы", "Контрагент": id, "В расчёт с контрагентом": true })} />}</>}
        {section === "quotas" && <><Title title="Квоты" subtitle="Квота → лицензии → заявки; к заявке привязываются партия и машина" />{fail(["quotas", "licenses", "requests"]) ? <Empty message="Не удалось загрузить квоты" /> : <QuotasView data={data} busy={busy} onCreate={saveQuota} />}</>}
        {section === "suppliers" && <><Title title="Поставщики" subtitle="Китай — оплаты по партиям, РФ — себестоимость" />{fail(["batches", "contacts"]) ? <Empty message="Не удалось загрузить поставщиков" /> : <SuppliersView data={data} stages={stages} onOpenBatch={(b) => open("batch", {}, b)} />}</>}
        {section === "analytics" && <><Title title="Аналитика" subtitle="Закупка, плановая и фактическая продажа · ABC-анализ" />{fail(["movements", "batches", "products"]) ? <Empty message="Не удалось загрузить данные аналитики" /> : <AnalyticsView data={data} />}</>}
      </main>
    </div>
    <Dialog open={Boolean(selectedContact) && section === "clients"} onOpenChange={(v) => { if (!v) setSelectedContact(null); }}><DialogContent className="max-h-[92vh] max-w-[850px] overflow-y-auto sm:max-w-[850px]"><DialogHeader><DialogTitle>{text(activeContact?.["Название"])}</DialogTitle><DialogDescription>{text(activeContact?.["Тип"])} · Акт сверки</DialogDescription></DialogHeader>{activeContact && <><div className="flex flex-wrap gap-2"><Action onClick={() => { const id = activeContact.id; setSelectedContact(null); open("payment", { "Дата": today(), "Направление": "Приход", "Контрагент": id, "Сумма": "", "Валюта": "сом", "Категория": "Оплата от клиента", "В расчёт с контрагентом": true }); }}><Plus size={15} /> Принять оплату</Action><Action variant="outline" onClick={() => { const id = activeContact.id; setSelectedContact(null); setPage("warehouse"); open("shipment", { "Контрагент": id }); }}><Truck size={15} /> Новая отгрузка</Action></div><div className="mt-3 overflow-x-auto rounded border"><table className="w-full min-w-[570px] text-left text-sm"><thead className="bg-[#f7faf8] text-xs text-[#809087]"><tr><th className="px-3 py-2">Дата</th><th className="px-3 py-2">Операция</th><th className="px-3 py-2 text-right">Изменение</th><th className="px-3 py-2 text-right">Остаток</th></tr></thead><tbody>{closeIndex >= 0 && !showAllLedger ? <tr className="border-b bg-[#f2f8f4]"><td className="px-3 py-2 text-[#7b8c82]">{date(ledger[closeIndex]["Дата"])}</td><td className="px-3 py-2 font-medium" colSpan={2}>Акт закрыт — рассчитались · скрыто операций: {closeIndex + 1} <button type="button" className="ml-2 text-xs font-normal text-[#147d6e] underline" onClick={() => setShowAllLedger(true)}>Показать все операции</button></td><td className="px-3 py-2 text-right font-semibold">{som(0, 2)}</td></tr> : <tr className="border-b bg-[#f9fbfa]"><td className="px-3 py-2">—</td><td className="px-3 py-2 font-medium">Сальдо на начало {closeIndex >= 0 && <button type="button" className="ml-2 text-xs font-normal text-[#147d6e] underline" onClick={() => setShowAllLedger(false)}>Скрыть закрытые операции</button>}</td><td className="px-3 py-2 text-right">—</td><td className="px-3 py-2 text-right font-semibold">{som(activeContact["Сальдо на начало"], 2)}</td></tr>}{visibleLedger.map(({ r, i }) => <tr key={r.id} className="border-b last:border-0"><td className="px-3 py-2 text-[#7b8c82]">{date(r["Дата"])}</td><td className="px-3 py-2">{r.source} <span className="text-[#8a9b90]">{r.source === "Отгрузка" ? linkName("products", r["ТоварId"]) : text(r["Категория"])}</span></td><td className={`px-3 py-2 text-right tabular-nums ${r.impact < 0 ? "text-[#b45b4c]" : "text-[#288067]"}`}><span className="inline-flex items-center gap-1">{r.impact > 0 ? "+" : ""}{som(r.impact, 2)}<CalcInfo label="Изменение баланса" formula={r.source === "Отгрузка" ? "Кг × цена продажи, если в расчёт с контрагентом" : "Приход денег уменьшает долг, расход увеличивает"} substitution={`${som(r["Сумма, сом"], 2)} → ${som(r.impact, 2)}`} source={`${r.source}: ${date(r["Дата"])}`} excel="Лист контрагента: операция в расчёте H2 (адрес строки не указан)" /></span></td><td className="px-3 py-2 text-right tabular-nums"><span className="inline-flex items-center gap-1">{som(r.running, 2)}<CalcInfo label="Остаток после операции" formula="Предыдущий остаток + изменение баланса" substitution={`${som(i === 0 ? activeContact["Сальдо на начало"] : ledger[i - 1].running, 2)} + ${som(r.impact, 2)} = ${som(r.running, 2)}`} source={`Контрагент: ${text(activeContact["Название"])}, движения и платежи`} excel="Лист контрагента!H2 (накопительный остаток)" /></span></td></tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><div><div className="text-xs text-[#829087]">Итого · Баланс</div><div className={`mt-1 text-xl font-semibold tabular-nums ${n(activeContact["Баланс"]) < 0 ? "text-[#b45c50]" : "text-[#1d5541]"}`}><span className="inline-flex items-center gap-1">{som(activeContact["Баланс"], 2)}<CalcInfo label="Баланс контрагента" {...contactInfo(activeContact)} /></span></div></div><Badge variant="outline" className={n(activeContact["Баланс"]) > 1 ? "border-[#ead7b8] bg-[#fff8eb] text-[#a36a2f]" : n(activeContact["Баланс"]) < -1 ? "border-[#d5e5ed] bg-[#f0f8fb] text-[#4f8095]" : "border-[#d8e8db] bg-[#f2f8f2] text-[#488061]"}>{settlementStatus(n(activeContact["Баланс"]))}</Badge></div>{ledger.length > 0 && Math.abs(ledger[ledger.length - 1].running - n(activeContact["Баланс"])) > 0.1 && <div className="text-xs text-[#b27849]">Остаток в ленте отличается от формулы баланса. Проверьте исторические операции.</div>}</>}</DialogContent></Dialog>
    <Dialog open={Boolean(modal)} onOpenChange={(v) => { if (!v && !busy) setModal(null); }}><DialogContent className={`${modal === "batch" ? "sm:max-w-[1050px]" : "sm:max-w-[650px]"} max-h-[92vh] overflow-y-auto`}><DialogHeader><DialogTitle>{modal === "batch" ? selectedBatch ? `Партия ${text(selectedBatch["Номер партии"])}` : "Новая партия" : modal === "shipment" ? "Отгрузка клиенту" : modal === "receipt" ? "Приход на склад" : modal === "tax" ? "Новое начисление налога" : modal === "taxPayment" ? "Оплатить налог" : modal === "reconciliation" ? "Новая сверка" : "Новый платёж / расход"}</DialogTitle><DialogDescription>{modal === "batch" ? "Расчёт справа обновляется сразу при вводе. Поля с пометкой «авто» считаются как в Excel — их можно поправить вручную" : modal === "shipment" ? "Цена и вес определяют долг клиента" : modal === "payment" ? "Сумма в сомах рассчитывается по указанному курсу" : modal === "taxPayment" ? text(selectedTax?.["Основание"]) : modal === "reconciliation" ? "Сверка по итогам поставки" : modal === "tax" ? "Начисление по основанию" : "Укажите товар и количество"}</DialogDescription></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="mt-2 space-y-5">{modal === "batch" ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]"><div className="space-y-5">{batchFields.map((group) => <section key={group.title}><h3 className="mb-3 border-b pb-2 text-sm font-semibold">{group.title}</h3><div className="grid gap-3 sm:grid-cols-2">{group.names.filter((name) => form["Страна"] === "РФ" ? !chinaOnly.has(name) : !russiaOnly.has(name)).map((name) => <Field key={name} name={name} label={batchLabel(name, form)} note={batchNote(name, form)} required={["Номер партии", "Товар"].includes(name)} value={form[name]} onChange={(v) => patchBatch(name, v)} kind={batchNumbers.has(name) ? "number" : name.startsWith("Дата") ? "date" : name === "Комментарий" ? "textarea" : "text"} options={name === "Квота" ? data.quotas.filter((q) => fitsBatch(q, form)).map((q) => ({ value: q.id, title: `${text(q["Квота"])} · остаток ${fmt(q["Остаток по заявкам, кг"])} кг` })) : name === "Лицензия" ? data.licenses.filter((l) => fitsBatch(l, form) && (!form["Квота"] || l["КвотаId"] === form["Квота"])).map((l) => ({ value: l.id, title: `${text(l["Лицензия"])} · остаток ${fmt(l["Остаток, кг"])} кг` })) : name === "Заявка" ? data.requests.filter((r) => fitsBatch(r, form) && (!form["Лицензия"] || r["ЛицензияId"] === form["Лицензия"]) && (!r["ПартияId"] || r["ПартияId"] === selectedBatch?.id)).map((r) => ({ value: r.id, title: `${text(r["Заявка"])} · ${fmt(r["Объём, кг"])} кг${r["Номер машины"] ? ` · ${text(r["Номер машины"])}` : ""}` })) : name === "Страна" ? ["Китай", "РФ"].map((v) => ({ value: v, title: v })) : name === "Импортёр" ? ["ОсОО «Эксперт компани»", "ИП Мырзабеков", "Фудторг", "Бонвивант"].map((v) => ({ value: v, title: v })) : name === "Статус" ? stages.filter((v) => v !== "На складе" || ["На складе", "Продана"].includes(text(selectedBatch?.["Статус"]))).map((v) => ({ value: v, title: v })) : name === "Товар" ? options(data.products) : name === "Поставщик" ? options(data.contacts.filter((c) => c["Тип"] === "Поставщик")) : undefined} />)}</div></section>)}</div><BatchCalculations form={form} /></div> : modal === "tax" ? <div className="grid gap-3 sm:grid-cols-2"><Field name="Основание" required value={form["Основание"]} onChange={(v) => patch("Основание", v)} /><Field name="Дата" kind="date" required value={form["Дата"]} onChange={(v) => patch("Дата", v)} /><Field name="Начислено, сом" kind="number" required value={form["Начислено, сом"]} onChange={(v) => patch("Начислено, сом", v)} /><div className="sm:col-span-2"><Field name="Комментарий" kind="textarea" value={form["Комментарий"]} onChange={(v) => patch("Комментарий", v)} /></div></div> : modal === "taxPayment" ? <div className="grid gap-3 sm:grid-cols-2"><Field name="Дата" kind="date" required value={form["Дата"]} onChange={(v) => patch("Дата", v)} /><Field name="Счёт" required value={form["Счёт"]} onChange={(v) => patch("Счёт", v)} options={options(data.accounts)} /><Field name="Сумма" kind="number" required value={form["Сумма"]} onChange={(v) => patch("Сумма", v)} /><div className="self-end pb-2 text-xs text-[#718278]">К уплате: {som(selectedTax?.["Остаток к уплате, сом"], 2)}</div></div> : modal === "reconciliation" ? <div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Field name="Партии в своде" required value={form["Партии в своде"]} onChange={(v) => patch("Партии в своде", v)} /></div><Field name="Дата свода" kind="date" required value={form["Дата свода"]} onChange={(v) => patch("Дата свода", v)} />{["Остаток на начало, $", "Прибыль по партиям, $", "Факт остаток, $", "Факт расходов, $"].map((key) => <Field key={key} name={key} kind="number" min={-1000000000} required value={form[key]} onChange={(v) => patch(key, v)} />)}<div className="sm:col-span-2"><Field name="Комментарий" kind="textarea" value={form["Комментарий"]} onChange={(v) => patch("Комментарий", v)} /></div></div> : <div className="grid gap-3 sm:grid-cols-2"><Field name="Дата" kind="date" required value={form["Дата"]} onChange={(v) => patch("Дата", v)} />{modal === "payment" ? <><Field name="Счёт" required value={form["Счёт"]} onChange={(v) => patch("Счёт", v)} options={options(data.accounts)} /><Field name="Направление" required value={form["Направление"]} onChange={(v) => patch("Направление", v)} options={["Приход", "Расход"].map((v) => ({ value: v, title: v }))} /><Field name="Категория" value={form["Категория"]} onChange={(v) => patch("Категория", v)} options={["Оплата от клиента", "Оплата поставщику", "Растаможка", "Налоги", "Логистика", "Выгрузка", "Комиссия банка", "Зарплата", "Аренда", "Займы", "Расчёты с партнёром", "Перевод между счетами", "Расходы вне себестоимости", "Личные расходы", "Яйца", "Прочий приход", "Прочие расходы", "Прочее"].map((v) => ({ value: v, title: v }))} /><Field name="Сумма" kind="number" required value={form["Сумма"]} onChange={(v) => patch("Сумма", v)} /><Field name="Валюта" required value={form["Валюта"]} onChange={(v) => patch("Валюта", v)} options={["сом", "$", "₽"].map((v) => ({ value: v, title: v }))} />{form["Валюта"] !== "сом" && <Field name="Курс" kind="number" required value={form["Курс"]} onChange={(v) => patch("Курс", v)} />}<Field name="Контрагент" value={form["Контрагент"]} onChange={(v) => patch("Контрагент", v)} options={options(data.contacts)} /><Field name="Партия" value={form["Партия"]} onChange={(v) => patch("Партия", v)} options={options(data.batches, "Номер партии")} /><Field name="В расчёт с контрагентом" kind="checkbox" value={form["В расчёт с контрагентом"]} onChange={(v) => patch("В расчёт с контрагентом", v)} /><div className="sm:col-span-2"><Field name="Описание" kind="textarea" value={form["Описание"]} onChange={(v) => patch("Описание", v)} /></div></> : <><Field name="Товар" required value={form["Товар"]} onChange={(v) => setForm((old) => { const product = data.products.find((p) => p.id === v); const perBox = kgPerBox(product); return { ...old, "Товар": v, "Цена плановая продажная, сом/кг": modal === "shipment" ? product?.["Средняя плановая цена, сом/кг"] ?? 0 : old["Цена плановая продажная, сом/кг"], "Кг": old["Коробки"] && perBox ? n(old["Коробки"]) * perBox : old["Кг"] }; })} options={options(data.products)} />{modal === "shipment" && <Field name="Клиент / контрагент" required value={form["Контрагент"]} onChange={(v) => patch("Контрагент", v)} options={options(data.contacts, "Название", true)} />}<Field name="Партия" value={form["Партия"]} onChange={(v) => setForm((old) => { const batch = data.batches.find((b) => b.id === v); return { ...old, "Партия": v, ...(modal === "receipt" && batch ? { "Цена плановая продажная, сом/кг": batch["Цена продажи сом/кг"] ?? old["Цена плановая продажная, сом/кг"] } : {}) }; })} options={options(data.batches.filter((b) => !form["Товар"] || b["ТоварId"] === form["Товар"]), "Партия")} /><Field name="Коробки" kind="number" value={form["Коробки"]} onChange={(v) => { const perBox = kgPerBox(data.products.find((p) => p.id === form["Товар"])); if (v !== "" && !perBox) toast.error("У товара не задано поле «Кг в коробке»"); setForm((old) => ({ ...old, "Коробки": v, "Кг": v === "" || !perBox ? "" : n(v) * perBox })); }} /><Field name="Кг" kind="number" required value={form["Кг"]} onChange={(v) => patch("Кг", v)} />{modal === "shipment" && (() => { const product = data.products.find((p) => p.id === form["Товар"]); return <div className="space-y-2 text-xs text-[#718278] sm:col-span-2"><div className="flex flex-wrap items-center gap-2">Доступно: {fmt(product?.["Остаток, кг"], 2)} кг {product && <CalcInfo label="Остаток, кг" {...productInfo(product, "Остаток, кг", data.movements)} />} · Кг в коробке: {product?.["Кг в коробке"] == null ? "не указано" : fmt(product["Кг в коробке"], 2)} · Плановая цена: {som(product?.["Средняя плановая цена, сом/кг"], 2)} / кг {product && <CalcInfo label="Средняя плановая цена, сом/кг" {...productInfo(product, "Средняя плановая цена, сом/кг", data.movements)} />}</div>{n(form["Цена сом/кг"]) > 0 && <div className="flex items-center gap-1 font-semibold text-[#215e4b]">Отклонение от плана: {som((n(form["Цена сом/кг"]) - n(product?.["Средняя плановая цена, сом/кг"])) * n(form["Кг"]), 2)}<CalcInfo label="Отклонение от плана" formula="(Фактическая цена продажи − плановая цена за кг) × кг" substitution={`(${som(form["Цена сом/кг"], 2)} − ${som(product?.["Средняя плановая цена, сом/кг"], 2)}) × ${fmt(form["Кг"], 2)} = ${som((n(form["Цена сом/кг"]) - n(product?.["Средняя плановая цена, сом/кг"])) * n(form["Кг"]), 2)}`} source={`Форма отгрузки и Товары: ${text(product?.["Название"])}`} excel="Складской лист: колонка «разница» (с обратным знаком)" /></div>}</div>; })()}<Field name={modal === "shipment" ? "Цена продажи, сом/кг" : "Цена сом/кг"} kind="number" required={modal === "shipment"} value={form["Цена сом/кг"]} onChange={(v) => patch("Цена сом/кг", v)} />{modal === "receipt" && <Field name="Цена плановая продажная, сом/кг" kind="number" value={form["Цена плановая продажная, сом/кг"]} onChange={(v) => patch("Цена плановая продажная, сом/кг", v)} />}<div className="sm:col-span-2"><Field name="Комментарий" kind="textarea" value={form["Комментарий"]} onChange={(v) => patch("Комментарий", v)} /></div></>}</div>}
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">{modal === "batch" && selectedBatch && <Button type="button" variant="outline" className="mr-auto" onClick={() => addProductToBatch(selectedBatch)}><Plus size={15} /> Ещё вид товара в партию {text(selectedBatch["Номер партии"])}</Button>}<Button type="button" variant="outline" onClick={() => setModal(null)}>Отмена</Button><Button type="submit" disabled={busy} className="bg-[#147d6e] hover:bg-[#10675b]">{busy ? "Сохранение..." : "Сохранить"}</Button></div></form></DialogContent></Dialog>
  </div></TooltipProvider>;
}
