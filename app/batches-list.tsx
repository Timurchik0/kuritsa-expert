"use client";

import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CalcInfo } from "./calc-info";
import { batchDetail } from "./batch-calculations";
import type { Dataset, Row } from "./actions";
import { Pager, PeriodInputs, kinds, SearchSelect, SortDirection, date, fmt, groupByNumber, inPeriod, labelOf, n, panel, som, td, text, th, usd } from "./ui-kit";

const PAGE = 50;
const stageTone: Record<string, string> = { "Предоплата": "text-[#a0773f]", "В пути": "text-[#3d8199]", "На таможне": "text-[#8d7446]", "На складе": "text-[#23805f]", "Продана": "text-[#6d7d73]" };

export default function BatchesList({ data, stages, onOpen, onAddProduct }: { data: Dataset; stages: string[]; onOpen: (row: Row) => void; onAddProduct: (row: Row) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateField, setDateField] = useState("Дата прибытия");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(0);
  const q = search.toLocaleLowerCase("ru");
  const num = (row: Row) => parseInt(text(row["Номер партии"]).replace(/\D+/g, ""), 10) || 0;
  const rows = data.batches.filter((b) => (!status || b["Статус"] === status) && inPeriod(b[dateField], from, to)
    && (!q || [text(b["Партия"]), text(b["Импортёр"]), text(b["Номер фуры"]), labelOf(data.products, b["ТоварId"])].join(" ").toLocaleLowerCase("ru").includes(q)))
    .sort((a, b) => {
      const d = sortBy === "number" ? num(a) - num(b) : sortBy === "profit" ? n(a["Прибыль, сом"]) - n(b["Прибыль, сом"]) : sortBy === "kg" ? n(a["Кг"]) - n(b["Кг"]) : text(a[dateField]).localeCompare(text(b[dateField]));
      return desc ? -d : d;
    });
  const groups = groupByNumber(rows);
  const totalKg = rows.reduce((s, r) => s + n(r["Кг"]), 0), totalProfit = rows.reduce((s, r) => s + n(r["Прибыль, сом"]), 0), totalDebt = rows.reduce((s, r) => s + n(r["Долг поставщику, $"]), 0);
  const batchRow = (b: Row, inGroup: boolean) => <tr key={b.id} className="cursor-pointer border-b last:border-0 hover:bg-[#f5faf7]" onClick={() => onOpen(b)}>
        <td className={`${td} font-medium`}>{inGroup ? <span className="pl-4 text-[#4f6158]">↳ {labelOf(data.products, b["ТоварId"])}</span> : text(b["Партия"]) || text(b["Номер партии"])}</td>
        <td className={td}><Badge variant="outline" className={stageTone[text(b["Статус"])] ?? ""}>{text(b["Статус"])}</Badge></td>
        <td className={`${td} text-[#6e7e74]`}>{text(b["Импортёр"]).replace("ОсОО «Эксперт компани»", "Эксперт") || "—"}</td>
        <td className={td}>{text(b["Страна"])}</td>
        <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{date(b["Дата предоплаты"])}</td>
        <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{date(b["Дата прибытия"])}</td>
        <td className={`${td} text-right tabular-nums`}>{fmt(b["Кг"])}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1">{som(b["Себестоимость 1 кг, сом"], 2)}<CalcInfo label="Себестоимость 1 кг, сом" {...batchDetail("Себестоимость 1 кг, сом", b)} /></span></td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(b["Цена продажи сом/кг"], 2)}</td>
        <td className={`${td} whitespace-nowrap text-right tabular-nums`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1">{usd(b["Долг поставщику, $"])}<CalcInfo label="Долг поставщику, $" {...batchDetail("Долг поставщику, $", b)} /></span></td>
        <td className={`${td} whitespace-nowrap text-right font-medium tabular-nums ${n(b["Прибыль, сом"]) < 0 ? "text-[#b9584c]" : "text-[#287862]"}`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1">{som(b["Прибыль, сом"])}{b["Статус"] !== "Продана" && <span className="text-[10px] font-normal text-[#8b998f]">план</span>}<CalcInfo label="Прибыль, сом" {...batchDetail("Прибыль, сом", b)} /></span></td>
        <td className={`${td} text-[#9aaba2]`}><ChevronRight size={15} /></td>
      </tr>;
  return <>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 md:max-w-xs"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="pl-9" placeholder="Поиск: партия, товар, импортёр, фура" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
      <SearchSelect name="Статус" value={status} onChange={(v) => { setStatus(v); setPage(0); }} items={stages.map((v) => ({ value: v, title: v }))} placeholder="Все статусы" className="w-40" />
      <SearchSelect name="Дата для периода" required value={dateField} onChange={setDateField} items={["Дата предоплаты", "Дата постоплаты", "Дата прибытия"].map((v) => ({ value: v, title: v }))} className="w-44" />
      <PeriodInputs from={from} to={to} onFrom={(v) => { setFrom(v); setPage(0); }} onTo={(v) => { setTo(v); setPage(0); }} />
      <SearchSelect name="Сортировка" required value={sortBy} onChange={setSortBy} items={[{ value: "date", title: "По дате" }, { value: "number", title: "По номеру" }, { value: "profit", title: "По прибыли" }, { value: "kg", title: "По весу" }]} className="w-36" />
      <SortDirection desc={desc} onToggle={() => setDesc(!desc)} />
    </div>
    <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[1200px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Партия", "Статус", "Импортёр", "Страна", "Дата предоплаты", "Дата прибытия", "Кг", "Себест. 1 кг", "Цена плановая", "Долг поставщику", "Прибыль", ""].map((h) => <th key={h} className={`${th} ${["Кг", "Себест. 1 кг", "Цена плановая", "Долг поставщику", "Прибыль"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{groups.slice(page * PAGE, (page + 1) * PAGE).flatMap((group) => {
        if (group.length === 1) return [batchRow(group[0], false)];
        const sum = (key: string) => group.reduce((s, b) => s + n(b[key]), 0);
        const kg = sum("Кг"), cost = sum("Себестоимость итого, сом"), revenue = sum("Выручка, сом"), debt = sum("Долг поставщику, $"), profit = sum("Прибыль, сом");
        const number = text(group[0]["Номер партии"]);
        return [
          <tr key={`head-${group[0].id}`} className="border-b border-t-2 border-t-[#dfe8e2] bg-[#f4f8f6]"><td className={`${td} font-semibold`} colSpan={12}><div className="flex flex-wrap items-center justify-between gap-2"><span>Партия {number} · {text(group[0]["Страна"])} · {kinds(group.length)} · {[...new Set(group.map((b) => text(b["Статус"])))].join(", ")}</span><button className="text-xs font-normal text-[#147d6e] hover:underline" onClick={() => onAddProduct(group[0])}>+ вид товара</button></div></td></tr>,
          ...group.map((b) => batchRow(b, true)),
          <tr key={`total-${group[0].id}`} className="border-b-2 border-b-[#dfe8e2] bg-[#fafcfb] font-semibold">
            <td className={td} colSpan={6}>Итого по партии {number}</td>
            <td className={`${td} text-right tabular-nums`}>{fmt(kg)}</td>
            <td className={`${td} whitespace-nowrap text-right tabular-nums`}><span className="inline-flex items-center gap-1">{som(kg ? cost / kg : 0, 2)}<CalcInfo label="Себестоимость 1 кг по партии" formula="Σ себестоимости итого видов товара ÷ Σ кг" substitution={`${som(cost, 2)} ÷ ${fmt(kg)} = ${som(kg ? cost / kg : 0, 2)}`} source={`Партии с номером ${number}`} excel="«РФ расчет»: итоги по партии" /></span></td>
            <td className={`${td} whitespace-nowrap text-right tabular-nums`}><span className="inline-flex items-center gap-1">{som(kg ? revenue / kg : 0, 2)}<CalcInfo label="Средняя плановая цена по партии" formula="Σ выручки видов товара ÷ Σ кг" substitution={`${som(revenue, 2)} ÷ ${fmt(kg)} = ${som(kg ? revenue / kg : 0, 2)}`} source={`Партии с номером ${number}`} excel="«РФ расчет»: итоги по партии" /></span></td>
            <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{usd(debt)}</td>
            <td className={`${td} whitespace-nowrap text-right tabular-nums ${profit < 0 ? "text-[#b9584c]" : "text-[#287862]"}`}><span className="inline-flex items-center gap-1">{som(profit)}<CalcInfo label={`Прибыль по партии ${number}`} formula="Σ прибыли видов товара партии" substitution={`${group.map((b) => som(b["Прибыль, сом"])).join(" + ")} = ${som(profit)}`} source={`Партии с номером ${number}`} excel="«РФ расчет»!V — итого прибыль сом по партии" /></span></td>
            <td className={td} />
          </tr>,
        ];
      })}</tbody>
      {rows.length > 0 && <tfoot className="border-t bg-[#fbfcfb] text-sm font-semibold"><tr><td className={td} colSpan={6}>Итого по фильтру: {groups.length} партий · {rows.length} строк товара</td><td className={`${td} text-right tabular-nums`}>{fmt(totalKg)}</td><td className={td} /><td className={td} /><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{usd(totalDebt)}</td><td className={`${td} whitespace-nowrap text-right tabular-nums`}><span className="inline-flex items-center gap-1">{som(totalProfit)}<CalcInfo label="Прибыль по фильтру" formula="Σ «Прибыль, сом» партий, попавших в фильтр (для непроданных — плановая)" substitution={`${rows.length} партий = ${som(totalProfit)}`} source="Партии" excel="«расчет прибыли» AG (сумма по строкам)" /></span></td><td className={td} /></tr></tfoot>}
    </table>{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет партий по фильтрам</div>}</div>
    <Pager page={page} size={PAGE} total={groups.length} onPage={setPage} />
  </>;
}
