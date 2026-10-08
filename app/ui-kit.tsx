"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Row } from "./actions";

export const n = (value: unknown) => Number(value) || 0;
export const text = (value: unknown) => value == null ? "" : String(value);
export const fmt = (value: unknown, digits = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(n(value));
export const som = (value: unknown, digits = 0) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n(value))} сом`;
export const usd = (value: unknown, digits = 0) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n(value))} $`;
export const date = (value: unknown) => value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(value))) : "—";
export const dateInput = (value: unknown) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(value))) : "";
export const inPeriod = (value: unknown, from: string, to: string) => (!from || dateInput(value) >= from) && (!to || (Boolean(value) && dateInput(value) <= to));
export const labelOf = (list: Row[], id: unknown, field = "Название") => text(list.find((item) => item.id === id)?.[field]) || "—";

export const uiInput = "h-9 w-full rounded border border-[#dbe2df] bg-white px-3 text-sm text-[#22332f] outline-none focus:border-[#178779] focus:ring-2 focus:ring-[#178779]/10 disabled:bg-[#f3f5f4]";
export const panel = "rounded-md border border-[#e1e7e4] bg-white";
export const th = "px-3 py-3 text-left text-xs font-medium text-[#839188]";
export const td = "px-3 py-2.5 text-sm";

// rows of one batch number (one truck / one RF delivery) stay together, in the order they come
export function groupByNumber(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) { const key = text(row["Номер партии"]).trim() || row.id; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return [...groups.values()];
}

export const kinds = (count: number) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? "вид" : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? "вида" : "видов"} товара`;

export type Choice = { value: string; title: string; group?: string };

export function SearchSelect({ name, value, onChange, items, required, className = "", placeholder = "Выберите..." }: { name: string; value: unknown; onChange: (v: string) => void; items: Choice[]; required?: boolean; className?: string; placeholder?: string }) {
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

/** Simple list filter bar pieces */
export function PeriodInputs({ from, to, onFrom, onTo, title = "" }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; title?: string }) {
  return <div className="flex items-center gap-1.5 text-xs text-[#7d8b83]">{title && <span>{title}</span>}<span>с</span><input aria-label={`${title} с`} className={`${uiInput} w-36`} type="date" value={from} onChange={(e) => onFrom(e.target.value)} /><span>по</span><input aria-label={`${title} по`} className={`${uiInput} w-36`} type="date" value={to} onChange={(e) => onTo(e.target.value)} /></div>;
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; title: string }[] }) {
  return <div className="flex gap-1 rounded border border-[#dce6de] bg-white p-1">{items.map((item) => <button key={item.value} type="button" onClick={() => onChange(item.value)} className={`rounded px-3 py-1.5 text-xs ${value === item.value ? "bg-[#e5f2eb] font-semibold text-[#14745f]" : "text-[#708177] hover:text-[#2c4a3d]"}`}>{item.title}</button>)}</div>;
}

export function SortDirection({ desc, onToggle }: { desc: boolean; onToggle: () => void }) {
  return <button type="button" aria-label={desc ? "По убыванию" : "По возрастанию"} title={desc ? "По убыванию" : "По возрастанию"} onClick={onToggle} className="h-9 rounded border border-[#dce4e0] bg-white px-3 text-sm text-[#50675c] hover:bg-[#f2f6f4]">{desc ? "↓" : "↑"}</button>;
}

export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  if (total <= size) return <div className="mt-3 text-xs text-[#798a80]">{total ? `Записей: ${total}` : ""}</div>;
  return <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#798a80]"><span>{page * size + 1}–{Math.min((page + 1) * size, total)} из {total}</span><div className="flex gap-2"><button className="rounded border border-[#dce4e0] bg-white px-3 py-1.5 disabled:opacity-40" disabled={page === 0} onClick={() => onPage(page - 1)}>Назад</button><button className="rounded border border-[#dce4e0] bg-white px-3 py-1.5 disabled:opacity-40" disabled={(page + 1) * size >= total} onClick={() => onPage(page + 1)}>Далее</button></div></div>;
}

export function Progress({ value, max, tone = "#168272" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  return <div className="h-2 rounded-full bg-[#eef2ef]"><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: tone }} /></div>;
}
