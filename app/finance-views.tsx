"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalcInfo } from "./calc-info";
import type { Row } from "./actions";
import { amount } from "./finance";

const money = (value: unknown, digits = 0) => `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount(value))} сом`;
const dollars = (value: unknown) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount(value))} $`;
const shownDate = (value: unknown) => value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(value))) : "—";
const box = "rounded-md border border-[#e1e7e4] bg-white";
const th = "px-3 py-3 text-left text-xs font-medium text-[#839188]";
const td = "px-3 py-3 text-sm";

export function TaxesView({ rows, onPay, onCreate }: { rows: Row[]; onPay: (row: Row) => void; onCreate: () => void }) {
  const [filter, setFilter] = useState("Все");
  const filtered = rows.filter((row) => filter === "Все" || row["Направление"] === filter);
  const accrued = filtered.reduce((sum, row) => sum + amount(row["Начислено, сом"]), 0);
  const paid = filtered.reduce((sum, row) => sum + amount(row["Оплачено, сом"]), 0);
  const remaining = filtered.reduce((sum, row) => sum + amount(row["Остаток к уплате, сом"]), 0);
  return <section>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded border border-[#dce6de] bg-white p-1">{["Все", "Китай", "РФ"].map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded px-3 py-1.5 text-xs ${filter === value ? "bg-[#e5f2eb] font-semibold text-[#14745f]" : "text-[#708177]"}`}>{value}</button>)}</div><Button size="sm" className="bg-[#147d6e] hover:bg-[#10675b]" onClick={onCreate}><Plus size={15} /> Новое начисление</Button></div>
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">{[
      { label: "Начислено", value: accrued, formula: "Σ «Начислено, сом»", substitution: `${filtered.length} записей = ${money(accrued, 2)}` },
      { label: "Оплачено", value: paid, formula: "Σ «Оплачено, сом»", substitution: `${filtered.length} записей = ${money(paid, 2)}` },
      { label: "Остаток к уплате", value: remaining, formula: "Σ «Остаток к уплате» = Σ (начислено − оплачено)", substitution: `${money(accrued, 2)} − ${money(paid, 2)} = ${money(remaining, 2)}` },
    ].map((item) => <div key={item.label} className={`${box} p-4`}><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{item.label}<CalcInfo label={item.label} formula={item.formula} substitution={item.substitution} source={`Налоги, ${filter === "Все" ? "все направления" : filter}`} excel={item.label === "Остаток к уплате" ? "Расходы!E1" : "лист «Расходы»: итог по налогам (адрес ячейки не указан)"} /></div><div className={`mt-3 text-lg font-semibold tabular-nums ${item.value < 0 ? "text-[#b45c50]" : ""}`}>{money(item.value, 2)}</div></div>)}</div>
    <div className={`${box} overflow-x-auto`}><table className="w-full min-w-[720px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Основание", "Дата", "Направление", "Начислено", "Оплачено", "Остаток к уплате", ""].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead><tbody>{filtered.map((row) => { const left = amount(row["Остаток к уплате, сом"]); return <tr key={row.id} className="border-b last:border-0"><td className={`${td} font-medium`}>{String(row["Основание"] ?? "")}</td><td className={`${td} text-[#718278]`}>{shownDate(row["Дата"])}</td><td className={td}>{String(row["Направление"] ?? "")}</td><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(row["Начислено, сом"], 2)}</td><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{money(row["Оплачено, сом"], 2)}</td><td className={`${td} whitespace-nowrap text-right tabular-nums ${left < 0 ? "text-[#b45c50]" : ""}`}><span className="inline-flex items-center gap-1">{money(left, 2)}<CalcInfo label="Остаток к уплате" formula="Начислено − Оплачено" substitution={`${money(row["Начислено, сом"], 2)} − ${money(row["Оплачено, сом"], 2)} = ${money(left, 2)}`} source={`Налоги: ${String(row["Основание"] ?? "")}`} excel="Расходы!E1 (сумма остатков)" /></span></td><td className={`${td} text-right`}>{left > 0 && <Button size="sm" variant="outline" onClick={() => onPay(row)}>Оплатить налог</Button>}</td></tr>; })}</tbody></table>{!filtered.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет начислений</div>}</div>
  </section>;
}

export function ReconciliationsView({ rows, onCreate }: { rows: Row[]; onCreate: () => void }) {
  const sorted = [...rows].sort((a, b) => String(b["Дата свода"] ?? "").localeCompare(String(a["Дата свода"] ?? "")));
  return <section><div className="mb-4 flex justify-end"><Button size="sm" className="bg-[#147d6e] hover:bg-[#10675b]" onClick={onCreate}><Plus size={15} /> Новая сверка</Button></div><div className={`${box} overflow-x-auto`}><table className="w-full min-w-[1100px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Дата", "Партии в своде", "Остаток на начало", "Прибыль", "После поставки", "Факт расходов", "Расчётный остаток", "Факт остаток", "Расхождение", "Комментарий"].map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead><tbody>{sorted.map((row) => <tr key={row.id} className="border-b last:border-0"><td className={`${td} whitespace-nowrap`}>{shownDate(row["Дата свода"])}</td><td className={`${td} font-medium`}>{String(row["Партии в своде"] ?? "")}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{dollars(row["Остаток на начало, $"])}</td><td className={`${td} whitespace-nowrap tabular-nums`}>{dollars(row["Прибыль по партиям, $"])}</td><td className={`${td} whitespace-nowrap tabular-nums`}><span className="inline-flex items-center gap-1">{dollars(row["После поставки, $"])}<CalcInfo label="После поставки, $" formula="Остаток на начало + прибыль по партиям" substitution={`${dollars(row["Остаток на начало, $"])} + ${dollars(row["Прибыль по партиям, $"])} = ${dollars(row["После поставки, $"])}`} source={`Сверки: ${String(row["Партии в своде"] ?? "")}`} excel="лист «итоги»: после поставки (адрес ячейки не указан)" /></span></td><td className={`${td} whitespace-nowrap tabular-nums`}>{dollars(row["Факт расходов, $"])}</td><td className={`${td} whitespace-nowrap tabular-nums`}><span className="inline-flex items-center gap-1">{dollars(row["Расчётный остаток, $"])}<CalcInfo label="Расчётный остаток, $" formula="После поставки − факт расходов" substitution={`${dollars(row["После поставки, $"])} − ${dollars(row["Факт расходов, $"])} = ${dollars(row["Расчётный остаток, $"])}`} source={`Сверки: ${String(row["Партии в своде"] ?? "")}`} excel="лист «итоги»: расчётный остаток (адрес ячейки не указан)" /></span></td><td className={`${td} whitespace-nowrap tabular-nums`}>{dollars(row["Факт остаток, $"])}</td><td className={`${td} whitespace-nowrap tabular-nums ${Math.abs(amount(row["Расхождение, $"])) > 1 ? "text-[#bd5d4e]" : "text-[#258064]"}`}><span className="inline-flex items-center gap-1">{dollars(row["Расхождение, $"])}<CalcInfo label="Расхождение, $" formula="Факт остаток − расчётный остаток" substitution={`${dollars(row["Факт остаток, $"])} − ${dollars(row["Расчётный остаток, $"])} = ${dollars(row["Расхождение, $"])}`} source={`Сверки: ${String(row["Партии в своде"] ?? "")}`} excel="лист «итоги»: расхождение (адрес ячейки не указан)" /></span></td><td className={`${td} max-w-60 text-[#718278]`}>{String(row["Комментарий"] ?? "")}</td></tr>)}</tbody></table>{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Сверок пока нет</div>}</div></section>;
}

function SettingRow({ row, onSave, busy }: { row: Row; onSave: (row: Row, value: number) => void; busy: boolean }) {
  const currentValue = String(row["Значение"] ?? "");
  const [value, setValue] = useState(currentValue);
  useEffect(() => { setValue(currentValue); }, [currentValue]);
  const changed = Number(value) !== Number(row["Значение"]);
  return <div className="grid gap-3 border-b px-4 py-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_130px_105px] sm:items-center"><div><div className="text-sm font-medium">{String(row["Параметр"] ?? "")}</div><div className="mt-1 text-xs text-[#829087]">{String(row["Где используется"] ?? "")}</div></div><Input aria-label={String(row["Параметр"] ?? "")} type="number" min="0" step="any" value={value} onChange={(event) => setValue(event.target.value)} /><Button size="sm" variant="outline" disabled={busy || !changed || value === "" || !Number.isFinite(Number(value))} onClick={() => onSave(row, Number(value))}>Сохранить</Button></div>;
}
export function SettingsView({ rows, onSave, busy }: { rows: Row[]; onSave: (row: Row, value: number) => void; busy: boolean }) {
  return <section className={box}>{rows.map((row) => <SettingRow key={row.id} row={row} onSave={onSave} busy={busy} />)}{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Настройки не найдены</div>}</section>;
}
