"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CalcInfo } from "./calc-info";
import type { Dataset, Row } from "./actions";
import { amount, localDay, type calculateSummary } from "./finance";
import { PAYMENT_CATEGORIES } from "./ui-kit";

const fmt = (value: unknown, digits = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount(value));
const som = (value: unknown) => `${fmt(value)} сом`;
const usd = (value: unknown) => `${fmt(value, 2)} $`;
const shown = (day: string) => day ? day.split("-").reverse().join(".") : "—";
// expenses that are not «расходы вне себестоимости»: the goods and their costs (incl. the bank commission of a China batch), loans, partners, own transfers, taxes (accrued separately)
const NOT_EXPENSES = ["Оплата поставщику", "Логистика", "Выгрузка", "Растаможка", "Комиссия банка", "Налоги", "Займы", "Расчёты с партнёром", "Перевод между счетами"];

/**
 * The client's cross-check of the real balance: the balance fixed on a date + profit of the batches that arrived after it
 * − expenses outside the cost price (all accounts, ИП Мырзабеков included) ÷ the report rate must come out at what the
 * summary shows now. It can only grow by profit and shrink by such expenses.
 */
export default function BalanceCheck({ data, summary: s, asOf = "" }: { data: Dataset; summary: ReturnType<typeof calculateSummary>; asOf?: string }) {
  const end = asOf || localDay(new Date().toISOString());
  const bases = useMemo(() => data.snapshots.filter((r) => r["Дата"] && r["Реальный остаток, $"] != null && localDay(r["Дата"]) < end)
    .sort((a, b) => localDay(b["Дата"]).localeCompare(localDay(a["Дата"]))), [data.snapshots, end]);
  const [baseId, setBaseId] = useState("");
  const [excluded, setExcluded] = useState<string[]>(NOT_EXPENSES);
  const [open, setOpen] = useState<string | null>(null);
  const base = bases.find((r) => r.id === baseId) ?? bases[0];
  const rate = s.rate && s.rate > 0 ? s.rate : null;

  const check = useMemo(() => {
    if (!base || !rate) return null;
    const from = localDay(base["Дата"]);
    const inside = (value: unknown) => { const day = localDay(value); return Boolean(day) && day > from && day <= end; };
    const batches = data.batches.filter((b) => ["На складе", "Продана"].includes(String(b["Статус"])) && inside(b["Дата прибытия"]))
      .sort((a, b) => localDay(a["Дата прибытия"]).localeCompare(localDay(b["Дата прибытия"])));
    const profit = batches.reduce((sum, b) => sum + amount(b["Прибыль, сом"]), 0);
    const spent = data.payments.filter((p) => p["Направление"] === "Расход" && inside(p["Дата"]) && !excluded.includes(String(p["Категория"] ?? "")));
    const byCategory = new Map<string, Row[]>();
    for (const p of spent) { const c = String(p["Категория"] || "Без категории"); byCategory.set(c, [...(byCategory.get(c) ?? []), p]); }
    const expenses = spent.reduce((sum, p) => sum + amount(p["Сумма, сом"]), 0);
    const opening = amount(base["Реальный остаток, $"]);
    const expected = opening + profit / rate - expenses / rate;
    const actual = amount(s.realUsd);
    return { from, batches, profit, byCategory: [...byCategory.entries()].sort((a, b) => sum(b[1]) - sum(a[1])), expenses, opening, expected, actual, diff: actual - expected };
  }, [base, rate, data.batches, data.payments, excluded, end, s.realUsd]);

  const account = (id: unknown) => String(data.accounts.find((a) => a.id === id)?.["Название"] ?? "—");
  const categories = PAYMENT_CATEGORIES["Расход"];
  const row = "flex items-center justify-between gap-3 border-b border-[#eef2ef] px-4 py-2.5 text-sm last:border-0";

  return <section className="mt-8">
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">Проверка баланса<CalcInfo label="Проверка баланса" formula="Зафиксированный реальный остаток на дату + прибыль партий, пришедших после этой даты ÷ курс − расходы вне себестоимости за этот период по всем счетам (в т.ч. ИП Мырзабеков) ÷ курс. Должно совпасть с реальным остатком на сводке: баланс растёт только на прибыль и уменьшается только на такие расходы." substitution={check ? `${usd(check.opening)} + ${usd(check.profit / rate!)} − ${usd(check.expenses / rate!)} = ${usd(check.expected)}` : "—"} source="Снимки баланса, Партии (дата прибытия, прибыль), Платежи (расходы)" excel="проверка баланса клиента: предыдущий баланс + прибыль по пришедшим партиям − расходы вне себестоимости" /></h2>
      {bases.length > 0 && <label className="flex items-center gap-2 text-xs text-[#718278]">от снимка
        <select className="h-8 rounded border border-[#dbe2df] bg-white px-2 text-sm text-[#22332f]" value={base?.id ?? ""} onChange={(e) => setBaseId(e.target.value)}>
          {bases.map((r) => <option key={r.id} value={r.id}>{shown(localDay(r["Дата"]))} · {usd(r["Реальный остаток, $"])}</option>)}
        </select></label>}
      <span className="text-xs text-[#8b998f]">по {shown(end)}{rate ? ` · курс ${fmt(rate, 2)}` : ""}</span>
    </div>
    {!rate ? <div className="rounded-md border border-[#e1e7e4] bg-white p-6 text-center text-sm text-[#86958b]">Не указан курс $ для отчётов в настройках</div>
      : !check ? <div className="rounded-md border border-[#e1e7e4] bg-white p-6 text-center text-sm text-[#86958b]">Нет зафиксированного баланса раньше {shown(end)} — нажмите «Зафиксировать баланс» и вернитесь к проверке позже</div>
      : <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-md border border-[#e1e7e4] bg-white">
          <div className={row}><span>Баланс на {shown(check.from)} (зафиксирован)</span><span className="font-semibold whitespace-nowrap tabular-nums">{usd(check.opening)}</span></div>
          <button type="button" className={`${row} w-full text-left hover:bg-[#f6faf8]`} onClick={() => setOpen(open === "profit" ? null : "profit")}><span className="flex items-center gap-1"><ChevronRight size={14} className={open === "profit" ? "rotate-90" : ""} />+ Прибыль по пришедшим партиям ({check.batches.length})</span><span className="whitespace-nowrap tabular-nums text-[#227964]">+{usd(check.profit / rate)}</span></button>
          {open === "profit" && <div className="bg-[#fafcfb] px-4 py-2 text-xs">{check.batches.map((b) => <div key={b.id} className="flex justify-between gap-3 py-1"><span>{String(b["Партия"] ?? b["Номер партии"] ?? "")} · пришла {shown(localDay(b["Дата прибытия"]))}</span><span className="whitespace-nowrap tabular-nums">{som(b["Прибыль, сом"])} = {usd(amount(b["Прибыль, сом"]) / rate)}</span></div>)}{!check.batches.length && <div className="py-1 text-[#8b998f]">Партии за период не приходили</div>}</div>}
          <button type="button" className={`${row} w-full text-left hover:bg-[#f6faf8]`} onClick={() => setOpen(open === "spent" ? null : "spent")}><span className="flex items-center gap-1"><ChevronRight size={14} className={open === "spent" ? "rotate-90" : ""} />− Расходы вне себестоимости</span><span className="whitespace-nowrap tabular-nums text-[#b45c50]">−{usd(check.expenses / rate)}</span></button>
          {open === "spent" && <div className="bg-[#fafcfb] px-4 py-2 text-xs">{check.byCategory.map(([category, list]) => <details key={category} className="py-1"><summary className="flex cursor-pointer justify-between gap-3"><span>{category} ({list.length})</span><span className="whitespace-nowrap tabular-nums">{som(sum(list))}</span></summary>{list.map((p) => <div key={p.id} className="flex justify-between gap-3 py-0.5 pl-4 text-[#6e8277]"><span>{shown(localDay(p["Дата"]))} · {account(p["СчётId"])}{p["Описание"] ? ` · ${String(p["Описание"])}` : ""}</span><span className="whitespace-nowrap tabular-nums">{som(p["Сумма, сом"])}</span></div>)}</details>)}{!check.byCategory.length && <div className="py-1 text-[#8b998f]">Расходов за период нет</div>}</div>}
          <div className={`${row} bg-[#f7faf8] font-semibold`}><span>Должно быть по проверке</span><span className="whitespace-nowrap tabular-nums">{usd(check.expected)}</span></div>
          <div className={`${row} font-semibold`}><span>Реальный остаток на сводке</span><span className="whitespace-nowrap tabular-nums">{usd(check.actual)}</span></div>
          <div className={`${row} ${Math.abs(check.diff) < 1 ? "bg-[#eef7f1] text-[#227964]" : "bg-[#fdf3f1] text-[#a14b3d]"} font-semibold`}><span>{Math.abs(check.diff) < 1 ? "Сходится" : "Расхождение"}</span><span className="whitespace-nowrap tabular-nums">{check.diff > 0 ? "+" : ""}{usd(check.diff)}</span></div>
        </div>
        <div className="rounded-md border border-[#e1e7e4] bg-white p-4 text-xs">
          <div className="mb-2 font-medium text-[#4f6158]">Не считаются расходами вне себестоимости (снимите галочку, чтобы учитывать):</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">{categories.map((c) => <label key={c} className="flex items-center gap-1.5 text-[#4f6158]"><input type="checkbox" checked={excluded.includes(c)} onChange={(e) => setExcluded(e.target.checked ? [...excluded, c] : excluded.filter((x) => x !== c))} />{c}</label>)}</div>
          <p className="mt-3 text-[#8b998f]">Расхождение покажет то, чего нет в формуле: например, прочие приходы, неоплаченные расходы без начисления в «Плановых расходах», изменение плановых цен на складе или правки задним числом до даты снимка.</p>
        </div>
      </div>}
  </section>;
}

function sum(list: Row[]) { return list.reduce((total, p) => total + amount(p["Сумма, сом"]), 0); }
