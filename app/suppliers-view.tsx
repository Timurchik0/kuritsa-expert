"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CalcInfo } from "./calc-info";
import { batchDetail } from "./batch-calculations";
import type { Dataset, Row } from "./actions";
import { contactInfo } from "./record-info";
import { Pager, SearchSelect, Segmented, SortDirection, date, fmt, labelOf, n, panel, som, td, text, th, usd } from "./ui-kit";

const PAGE = 50;
const inTransit = ["Предоплата", "В пути", "На таможне"];

export default function SuppliersView({ data, stages, onOpenBatch }: { data: Dataset; stages: string[]; onOpenBatch: (row: Row) => void }) {
  const [tab, setTab] = useState<"china" | "russia">("china");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(0);
  const suppliers = data.contacts.filter((c) => c["Тип"] === "Поставщик");
  const country = tab === "china" ? "Китай" : "РФ";
  const q = search.toLocaleLowerCase("ru");
  const rows = data.batches.filter((b) => b["Страна"] === country && (!status || b["Статус"] === status) && (!q || `${text(b["Партия"])} ${text(b["Импортёр"])} ${text(b["Номер фуры"])}`.toLocaleLowerCase("ru").includes(q)))
    .sort((a, b) => { const d = text(a["Дата предоплаты"] ?? a["Дата прибытия"]).localeCompare(text(b["Дата предоплаты"] ?? b["Дата прибытия"])) || (parseInt(text(a["Номер партии"]).replace(/\D+/g, ""), 10) || 0) - (parseInt(text(b["Номер партии"]).replace(/\D+/g, ""), 10) || 0); return desc ? -d : d; });
  const paid = rows.reduce((s, r) => s + n(r["Оплачено поставщику, сом"]), 0);
  const debt = rows.reduce((s, r) => s + n(r["Долг поставщику, $"]), 0);
  const advance = rows.filter((r) => inTransit.includes(text(r["Статус"]))).reduce((s, r) => s + n(r["Аванс поставщику (в пути), сом"]), 0);
  const cell = (b: Row, key: string, value: string) => <span className="inline-flex items-center gap-1">{value}<CalcInfo label={key} {...batchDetail(key, b)} /></span>;

  return <>
    <div className="mb-5 grid gap-3 md:grid-cols-2">{suppliers.map((s) => <div key={s.id} className={`${panel} p-4`}><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{text(s["Название"])}<CalcInfo label={`Баланс: ${text(s["Название"])}`} {...contactInfo(s)} /></div><div className="mt-2 text-lg font-semibold tabular-nums">{som(s["Баланс"])}</div><div className="mt-1 text-[11px] text-[#8b998f]">{n(s["Баланс"]) > 0 ? "Оплачено за товар, который ещё не пришёл" : "Расчёты закрыты"} · {data.batches.filter((b) => b["ПоставщикId"] === s.id).length} партий</div></div>)}</div>
    <div className="mb-4 flex flex-wrap items-center gap-2"><Segmented<"china" | "russia"> value={tab} onChange={(v) => { setTab(v); setPage(0); setStatus(""); }} items={[{ value: "china", title: "Китай — оплаты" }, { value: "russia", title: "РФ — себестоимость" }]} /><div className="relative min-w-[200px] flex-1 md:max-w-xs"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="pl-9" placeholder="Поиск: партия, импортёр, фура" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div><SearchSelect name="Статус" value={status} onChange={(v) => { setStatus(v); setPage(0); }} items={stages.map((v) => ({ value: v, title: v }))} placeholder="Все статусы" className="w-40" /><SortDirection desc={desc} onToggle={() => setDesc(!desc)} /></div>

    {tab === "china" ? <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">{[
        { label: "Оплачено поставщику", value: som(paid), formula: "Σ (предоплата $ × курс + постоплата $ × курс) по партиям фильтра", excel: "Китай!R2 (отправлено)" },
        { label: "Долг поставщику", value: usd(debt), formula: "Σ (кг × цена $/кг − предоплата $ − постоплата $)", excel: "расчет прибыли!K (остаток)" },
        { label: "Авансы за товар в пути", value: som(advance), formula: "Σ оплаченного по партиям со статусом Предоплата / В пути / На таможне", excel: "Китай!T2 = отправлено − поставлено" },
      ].map((t) => <div key={t.label} className={`${panel} p-4`}><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{t.label}<CalcInfo label={t.label} formula={t.formula} substitution={`${rows.length} партий = ${t.value}`} source="Партии: Страна = Китай" excel={t.excel} /></div><div className="mt-2 text-lg font-semibold tabular-nums">{t.value}</div></div>)}</div>
      <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[1250px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Партия", "Статус", "Дата предоплаты", "Предоплата $", "Курс", "Дата постоплаты", "Постоплата $", "Курс", "Оплачено, сом", "Стоимость, $", "Долг, $", "Аванс в пути"].map((h, i) => <th key={h + i} className={`${th} ${i >= 3 && ![5].includes(i) ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>{rows.slice(page * PAGE, (page + 1) * PAGE).map((b) => <tr key={b.id} className="cursor-pointer border-b last:border-0 hover:bg-[#f5faf7]" onClick={() => onOpenBatch(b)}>
        <td className={`${td} font-medium`}>{text(b["Партия"])}</td><td className={td}><Badge variant="outline">{text(b["Статус"])}</Badge></td>
        <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{date(b["Дата предоплаты"])}</td><td className={`${td} text-right tabular-nums`}>{usd(b["Предоплата $"])}</td><td className={`${td} text-right tabular-nums`}>{fmt(b["Курс предоплаты"], 2)}</td>
        <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{date(b["Дата постоплаты"])}</td><td className={`${td} text-right tabular-nums`}>{usd(b["Постоплата $"])}</td><td className={`${td} text-right tabular-nums`}>{fmt(b["Курс постоплаты"], 2)}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}>{cell(b, "Оплачено поставщику, сом", som(b["Оплачено поставщику, сом"]))}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}>{cell(b, "Стоимость товара, $", usd(b["Стоимость товара, $"]))}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums ${n(b["Долг поставщику, $"]) > 0 ? "font-semibold text-[#a36a2f]" : ""}`} onClick={(e) => e.stopPropagation()}>{cell(b, "Долг поставщику, $", usd(b["Долг поставщику, $"]))}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}>{cell(b, "Аванс поставщику (в пути), сом", som(b["Аванс поставщику (в пути), сом"]))}</td>
      </tr>)}</tbody></table>{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет партий по фильтрам</div>}</div>
    </> : <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[1250px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Позиция", "Партия РФ", "Дата прибытия", "Вес, кг", "Цена в РФ, ₽/кг", "Курс ₽→сом", "Закупка, сом/кг", "НДС + НсП, сом/кг", "Логистика, сом/кг", "Итого за кг", "Цена продажи", "Прибыль"].map((h, i) => <th key={h} className={`${th} ${i >= 3 ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>{rows.slice(page * PAGE, (page + 1) * PAGE).map((b) => {
      const kgv = n(b["Кг"]); const buy = n(b["Цена ₽/кг"]) * n(b["Курс ₽→сом"]); const tax = kgv ? n(b["НДС и НсП"]) / kgv : 0; const log = kgv ? n(b["Выгрузка / логистика"]) / kgv : 0;
      return <tr key={b.id} className="cursor-pointer border-b last:border-0 hover:bg-[#f5faf7]" onClick={() => onOpenBatch(b)}>
        <td className={`${td} font-medium`}>{labelOf(data.products, b["ТоварId"])}</td><td className={td}>{text(b["Номер партии"])}</td><td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{date(b["Дата прибытия"])}</td>
        <td className={`${td} text-right tabular-nums`}>{fmt(kgv)}</td><td className={`${td} text-right tabular-nums`}>{fmt(b["Цена ₽/кг"], 2)}</td><td className={`${td} text-right tabular-nums`}>{fmt(b["Курс ₽→сом"], 4)}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1">{som(buy, 2)}<CalcInfo label="Закупка, сом/кг" formula="Цена в РФ, ₽/кг × курс ₽→сом" substitution={`${fmt(b["Цена ₽/кг"], 2)} × ${fmt(b["Курс ₽→сом"], 4)} = ${som(buy, 2)}`} source={`Партия ${text(b["Номер партии"])}`} excel="РФ расчет!G = E × F" /></span></td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1">{som(tax, 2)}<CalcInfo label="НДС + НсП, сом/кг" formula="НДС на импорт 12% + НсП 4% от (закупка + НДС + 2); в партии хранится сумма на всю партию, здесь ÷ кг" substitution={`${som(b["НДС и НсП"])} ÷ ${fmt(kgv)} = ${som(tax, 2)}`} source={`Партия ${text(b["Номер партии"])}`} excel="РФ расчет!H + I (H = G × 12%, I = (G + H + 2) × 4%)" /></span></td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(log, 2)}</td>
        <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums`} onClick={(e) => e.stopPropagation()}>{cell(b, "Себестоимость 1 кг, сом", som(b["Себестоимость 1 кг, сом"], 2))}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(b["Цена продажи сом/кг"], 2)}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums ${n(b["Прибыль, сом"]) < 0 ? "text-[#b9584c]" : "text-[#287862]"}`} onClick={(e) => e.stopPropagation()}>{cell(b, "Прибыль, сом", som(b["Прибыль, сом"]))}</td>
      </tr>; })}</tbody></table>{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет партий из РФ по фильтрам</div>}</div>}
    <Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />
  </>;
}
