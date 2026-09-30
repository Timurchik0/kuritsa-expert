"use client";

import { Camera, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalcInfo } from "./calc-info";
import type { Row } from "./actions";
import { amount, type calculateSummary } from "./finance";

const fmt = (value: unknown, digits = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount(value));
const som = (value: unknown) => `${fmt(value)} сом`;
const usd = (value: unknown) => value == null || value === "" ? "—" : `${fmt(value, 2)} $`;
const shownDate = (value: unknown) => value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(String(value))) : "—";
const th = "px-3 py-3 text-left text-xs font-medium text-[#839188]";
const td = "px-3 py-3 text-sm";
type Attachment = { name?: string; presignedUrl?: string };
type Line = { id: string; date: unknown; title: string; source: string; turnover: number; loans: number; capital: number; taxes: number; capitalUsd: unknown; realUsd: unknown; files: Attachment[]; live?: boolean };

export default function SnapshotsView({ rows, summary: s, busy, onSnapshot }: { rows: Row[]; summary: ReturnType<typeof calculateSummary>; busy: boolean; onSnapshot: () => void }) {
  const saved: Line[] = [...rows].sort((a, b) => String(b["Дата"] ?? "").localeCompare(String(a["Дата"] ?? ""))).map((row) => ({
    id: row.id, date: row["Дата"], title: String(row["Снимок"] ?? ""), source: String(row["Источник"] ?? ""),
    turnover: amount(row["Деньги в обороте, сом"]), loans: amount(row["Займы (нетто), сом"]), capital: amount(row["Капитал, сом"]), taxes: amount(row["Налоги к уплате, сом"]),
    capitalUsd: row["Капитал, $"], realUsd: row["Реальный остаток, $"], files: Array.isArray(row["Исходный файл"]) ? row["Исходный файл"] as Attachment[] : [],
  }));
  const lines: Line[] = [{ id: "live", date: new Date().toISOString(), title: "Сейчас (живые данные)", source: "Приложение", turnover: s.turnover, loans: s.loans, capital: s.capital, taxes: s.taxes, capitalUsd: s.capitalUsd, realUsd: s.realUsd, files: [], live: true }, ...saved];
  return <section className="mt-8">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-base font-semibold">История баланса<CalcInfo label="История баланса" formula="Снимок фиксирует значения сводки на дату: деньги в обороте, займы, капитал, налоги и реальный остаток. Изменение — разница капитала со следующим более ранним снимком." substitution={`${saved.length} сохранённых снимков + текущие данные`} source="Снимки баланса" excel="лист «баланс денег»: F16, B16, I16, J16, K16" /></h2><div className="mt-0.5 text-xs text-[#8b998f]">Первая строка — текущие цифры, ниже — зафиксированные снимки (в т.ч. исходный Excel клиента)</div></div>
      <Button size="sm" className="bg-[#147d6e] hover:bg-[#10675b]" disabled={busy} onClick={onSnapshot}><Camera size={15} /> Зафиксировать баланс</Button>
    </div>
    <div className="overflow-x-auto rounded-md border border-[#e1e7e4] bg-white"><table className="w-full min-w-[1080px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Дата", "Снимок", "Деньги в обороте", "Займы (нетто)", "Капитал", "Капитал, $", "Налоги к уплате", "Реальный остаток, $", "Изменение капитала", "Файл"].map((h, i) => <th key={h} className={`${th} ${i >= 2 && i <= 8 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{lines.map((line, i) => {
        const previous = lines[i + 1];
        const delta = previous ? line.capital - previous.capital : null;
        return <tr key={line.id} className={`border-b last:border-0 ${line.live ? "bg-[#f3faf6]" : ""}`}>
          <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{shownDate(line.date)}</td>
          <td className={td}><div className="font-medium">{line.title}</div><div className="text-[11px] text-[#8b998f]">{line.source}</div></td>
          <td className={`${td} text-right tabular-nums`}>{som(line.turnover)}</td>
          <td className={`${td} text-right tabular-nums`}>{som(line.loans)}</td>
          <td className={`${td} text-right font-semibold tabular-nums`}>{som(line.capital)}</td>
          <td className={`${td} text-right tabular-nums`}>{usd(line.capitalUsd)}</td>
          <td className={`${td} text-right tabular-nums`}>{som(line.taxes)}</td>
          <td className={`${td} text-right tabular-nums`}>{usd(line.realUsd)}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums ${delta == null ? "" : delta < 0 ? "text-[#b45c50]" : "text-[#227964]"}`}>{delta == null ? "—" : <span className="inline-flex items-center gap-1">{delta > 0 ? "+" : ""}{som(delta)}<CalcInfo label="Изменение капитала" formula="Капитал этой строки − капитал предыдущего (более раннего) снимка" substitution={`${som(line.capital)} − ${som(previous!.capital)} = ${som(delta)}`} source="Снимки баланса: Капитал, сом" excel="I16 на разные даты" /></span>}</td>
          <td className={td}>{line.files.filter((f) => f.presignedUrl).map((f) => <a key={f.presignedUrl} href={f.presignedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#147d6e] underline" title={f.name}><FileSpreadsheet size={14} />Excel</a>)}{!line.files.length && <span className="text-xs text-[#9aa79f]">—</span>}</td>
        </tr>;
      })}</tbody></table></div>
  </section>;
}
