"use client";

import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { ru } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// The summary's date choice: «сегодня» (nothing set), the balance on a day (asOf), or a period (from … asOf; asOf "" = today).
// Dates are ГГГГ-ММ-ДД strings, like the rest of the app.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const shown = (s: string) => s.split("-").reverse().join(".");

export function SummaryPeriod({ today, asOf, from, onChange }: { today: string; asOf: string; from: string; onChange: (value: { asOf: string; from: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "period">(from ? "period" : "day");
  const [range, setRange] = useState<DateRange | undefined>();
  const end = asOf || today;
  // a day before today is stored as asOf; today itself is "" (live numbers)
  const apply = (value: { asOf: string; from: string }) => { onChange({ asOf: value.asOf >= today ? "" : value.asOf, from: value.from }); setOpen(false); };
  const now = parse(today);
  const presets: { label: string; value: { asOf: string; from: string } }[] = [
    { label: "Сегодня", value: { asOf: "", from: "" } },
    { label: "Вчера (на конец дня)", value: { asOf: ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)), from: "" } },
    { label: "Последние 7 дней", value: { asOf: "", from: ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)) } },
    { label: "Этот месяц", value: { asOf: "", from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)) } },
    { label: "Прошлый месяц", value: { asOf: ymd(new Date(now.getFullYear(), now.getMonth(), 0)), from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)) } },
    { label: "С начала года", value: { asOf: "", from: `${now.getFullYear()}-01-01` } },
  ];
  const label = from ? `${shown(from)} — ${shown(end)}` : asOf ? `На ${shown(asOf)}` : "Сегодня";
  const active = (v: { asOf: string; from: string }) => v.asOf === asOf && v.from === from;
  return <div className="flex items-center gap-1.5">
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) { setMode(from ? "period" : "day"); setRange(from ? { from: parse(from), to: parse(end) } : undefined); } }}>
      <PopoverTrigger asChild>
        <button type="button" className={`flex h-9 items-center gap-2 rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[#178779]/30 ${asOf || from ? "border-[#9fcbb9] bg-[#eaf5ee] text-[#1b4d3e]" : "border-[#dbe2df] bg-white text-[#22332f] hover:border-[#b9cfc5]"}`}>
          <CalendarDays size={16} className="text-[#147d6e]" />{from ? <span><span className="text-[#6b7f74]">Период </span>{label}</span> : asOf ? <span>Баланс {label.toLowerCase()}</span> : <span>Баланс на сегодня</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-32px)] p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b p-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">{presets.map((p) => <button key={p.label} type="button" onClick={() => apply(p.value)} className={`whitespace-nowrap rounded px-2.5 py-1.5 text-left text-xs ${active(p.value) ? "bg-[#147d6e] text-white" : "text-[#3d5148] hover:bg-[#eef5f1]"}`}>{p.label}</button>)}</div>
          <div className="p-3 [--accent:#e3f1ea] [--accent-foreground:#1b4d3e] [--primary-foreground:#ffffff] [--primary:#147d6e]">
            <div className="mb-2 grid grid-cols-2 rounded-md bg-[#eef2f0] p-0.5 text-xs">{(["day", "period"] as const).map((m) => <button key={m} type="button" onClick={() => { setMode(m); setRange(undefined); }} className={`rounded px-3 py-1.5 ${mode === m ? "bg-white font-medium text-[#1b352b] shadow-sm" : "text-[#65746e]"}`}>{m === "day" ? "Баланс на дату" : "Период"}</button>)}</div>
            {mode === "day"
              ? <Calendar mode="single" locale={ru} weekStartsOn={1} selected={parse(end)} defaultMonth={parse(end)} disabled={{ after: now }} onSelect={(d) => d && apply({ asOf: ymd(d), from: "" })} />
              : <><Calendar mode="range" showOutsideDays={false} locale={ru} weekStartsOn={1} selected={range} defaultMonth={range?.from ?? new Date(now.getFullYear(), now.getMonth() - 1, 1)} numberOfMonths={2} disabled={{ after: now }} onSelect={setRange} className="max-sm:[&_.rdp-months]:flex-col" />
                <div className="flex items-center justify-between gap-3 border-t pt-3 text-xs text-[#65746e]"><span>{range?.from ? `${shown(ymd(range.from))} — ${range.to ? shown(ymd(range.to)) : "выберите конец"}` : "Выберите начало и конец периода"}</span><button type="button" disabled={!range?.from || !range.to} onClick={() => range?.from && range.to && apply({ from: ymd(range.from), asOf: ymd(range.to) })} className="rounded-md bg-[#147d6e] px-3 py-1.5 font-medium text-white hover:bg-[#10675b] disabled:opacity-40">Показать</button></div></>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
    {(asOf || from) && <button type="button" title="Сбросить — показать на сегодня" onClick={() => onChange({ asOf: "", from: "" })} className="flex h-9 items-center gap-1 rounded-md px-2 text-xs text-[#65746e] hover:bg-[#eef2f0] hover:text-[#1b352b]"><X size={14} /> Сбросить</button>}
  </div>;
}
