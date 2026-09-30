"use client";

import { useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CalcInfo } from "./calc-info";
import type { Dataset, Row } from "./actions";
import { deviationInfo, movementInfo, productInfo } from "./record-info";
import { Pager, PeriodInputs, SearchSelect, SortDirection, date, fmt, inPeriod, labelOf, n, panel, som, td, text, th } from "./ui-kit";

const PAGE = 50;
const outgoing = (row: Row) => row["Тип"] !== "Приход";

export default function WarehouseView({ data }: { data: Dataset }) {
  const [product, setProduct] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(0);
  const withKg = data.movements.filter((row) => n(row["Кг"]) > 0);
  const received = withKg.filter((row) => row["Тип"] === "Приход").reduce((sum, row) => sum + n(row["Кг"]), 0);
  const shipped = withKg.filter(outgoing).reduce((sum, row) => sum + n(row["Кг"]), 0);
  const stockKg = data.products.reduce((sum, row) => sum + n(row["Остаток, кг"]), 0);
  const positive = data.products.filter((row) => n(row["Остаток, кг"]) > 0).length;

  // cost of 1 kg for a shipment: its batch if linked, otherwise the weighted average over the product's batches
  const avgCost = new Map(data.products.map((p) => {
    const own = data.batches.filter((b) => b["ТоварId"] === p.id && n(b["Кг"]) > 0 && n(b["Себестоимость итого, сом"]) > 0);
    const kg = own.reduce((s, b) => s + n(b["Кг"]), 0);
    return [p.id, { cost: kg ? own.reduce((s, b) => s + n(b["Себестоимость итого, сом"]), 0) / kg : 0, batches: own.length }];
  }));
  const markupOf = (r: Row) => {
    if (r["Тип"] !== "Отгрузка" || n(r["Кг"]) <= 0) return null;
    const batch = r["ПартияId"] ? data.batches.find((b) => b.id === r["ПартияId"]) : undefined;
    const exact = n(batch?.["Себестоимость 1 кг, сом"]);
    const avg = avgCost.get(String(r["ТоварId"]));
    const cost = exact || avg?.cost || 0;
    if (!cost) return null;
    return { cost, exact: Boolean(exact), batches: avg?.batches ?? 0, value: (n(r["Цена сом/кг"]) - cost) * n(r["Кг"]) };
  };
  const shipments = withKg.filter((r) => r["Тип"] === "Отгрузка");
  const markups = shipments.map(markupOf).filter((m) => m != null);
  const markupTotal = markups.reduce((sum, m) => sum + m.value, 0);
  const markupKg = shipments.filter((r) => markupOf(r) != null).reduce((sum, r) => sum + n(r["Кг"]), 0);

  const perProduct = new Map(data.products.map((p) => {
    const rows = withKg.filter((m) => m["ТоварId"] === p.id);
    return [p.id, { in: rows.filter((m) => m["Тип"] === "Приход").reduce((s, m) => s + n(m["Кг"]), 0), out: rows.filter(outgoing).reduce((s, m) => s + n(m["Кг"]), 0), ops: rows.length }];
  }));

  const q = search.toLocaleLowerCase("ru");
  const rows = data.movements.filter((r) => (!product || r["ТоварId"] === product) && (!kind || r["Тип"] === kind) && inPeriod(r["Дата"], from, to)
    && (!q || [labelOf(data.contacts, r["КонтрагентId"]), labelOf(data.batches, r["ПартияId"], "Партия"), text(r["Комментарий"]), text(r["Источник"])].join(" ").toLocaleLowerCase("ru").includes(q)))
    .sort((a, b) => {
      const d = sortBy === "kg" ? n(a["Кг"]) - n(b["Кг"]) : sortBy === "sum" ? n(a["Сумма, сом"]) - n(b["Сумма, сом"]) : text(a["Дата"]).localeCompare(text(b["Дата"]));
      return desc ? -d : d;
    });

  const tiles = [
    { label: "Остаток всего", value: `${fmt(stockKg)} кг`, extra: `${data.products.length} позиций · ${positive} с положительным остатком`, formula: "Σ «Остаток, кг» по всем товарам", substitution: `${data.products.map((p) => fmt(p["Остаток, кг"])).join(" + ")} = ${fmt(stockKg)} кг` },
    { label: "Приход всего", value: `${fmt(received)} кг`, formula: "Σ кг движений типа «Приход»", substitution: `${withKg.filter((r) => r["Тип"] === "Приход").length} приходов = ${fmt(received)} кг` },
    { label: "Отгрузка всего", value: `${fmt(shipped)} кг`, formula: "Σ кг движений типа «Отгрузка» и «Списание»", substitution: `${withKg.filter(outgoing).length} операций = ${fmt(shipped)} кг` },
    { label: "Наценка к себестоимости", value: som(markupTotal), extra: `${markups.length} из ${shipments.length} отгрузок · ${fmt(markupKg)} кг`, formula: "Σ (цена продажи − себестоимость 1 кг) × кг по отгрузкам. Себестоимость — из партии отгрузки, а если партия не указана — средневзвешенная себестоимость партий этого товара (Σ себестоимость итого ÷ Σ кг).", substitution: `${markups.length} отгрузок = ${som(markupTotal)}; без себестоимости (нет партий товара): ${shipments.length - markups.length}` },
    { label: "Операций всего", value: fmt(withKg.length), formula: "Количество движений склада с весом (кг > 0)", substitution: `${withKg.length} из ${data.movements.length} записей (остальные — суммы из листов взаиморасчёта без веса)` },
  ];

  return <>
    <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-md border border-[#e1e7e4] bg-white lg:grid-cols-5">{tiles.map((t) => <div key={t.label} className="border-b border-r border-[#edf1ee] p-4 last:border-r-0 lg:border-b-0"><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{t.label}<CalcInfo label={t.label} formula={t.formula} substitution={t.substitution} source="Товары, Движения склада, Партии" excel="Складские листы Excel: итоги кг; «расчет прибыли»: себестоимость 1 кг" /></div><div className="mt-2 text-xl font-semibold tabular-nums">{t.value}</div>{t.extra && <div className="mt-1 text-[11px] text-[#8b998f]">{t.extra}</div>}</div>)}</div>

    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">Остатки по позициям</h2>{product && <button className="text-xs text-[#147d6e] underline" onClick={() => setProduct("")}>Показать все позиции в журнале</button>}</div>
    <div className={`${panel} mb-8 grid md:grid-cols-2 xl:grid-cols-3`}>{[...data.products].sort((a, b) => text(a["Название"]).localeCompare(text(b["Название"]), "ru")).map((p) => {
      const s = perProduct.get(p.id) ?? { in: 0, out: 0, ops: 0 }; const kg = n(p["Остаток, кг"]);
      // a div, not a button: the card contains the ⓘ button (nested buttons are invalid HTML)
      const pick = () => { setProduct(product === p.id ? "" : p.id); setPage(0); };
      return <div key={p.id} role="button" tabIndex={0} aria-pressed={product === p.id} onClick={pick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } }} className={`flex cursor-pointer items-start justify-between gap-3 border-b border-r border-[#eef2ef] px-4 py-3 text-left outline-none hover:bg-[#f6faf8] focus-visible:ring-2 focus-visible:ring-[#178779]/30 ${product === p.id ? "bg-[#eef7f2]" : ""}`}>
        <div className="min-w-0"><div className="truncate text-sm font-medium">{text(p["Название"])}</div><div className="mt-0.5 text-[11px] text-[#8b998f]">Приход {fmt(s.in)} кг · отгрузка {fmt(s.out)} кг · {s.ops} оп.</div><div className="mt-0.5 text-[11px] text-[#8b998f]">По плановой цене: {som(p["Стоимость остатка, сом"])}</div></div>
        <span className={`flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums ${kg < 0 ? "text-[#bd5749]" : ""}`}>{kg < 0 && <AlertTriangle size={14} aria-label="Отгрузок больше, чем приходов: в Excel не внесён приход" />}{fmt(kg)} кг<CalcInfo label={`Остаток: ${text(p["Название"])}`} {...productInfo(p, "Остаток, кг", data.movements)} /></span>
      </div>;
    })}</div>

    <h2 className="mb-3 text-base font-semibold">Журнал движений <span className="text-sm font-normal text-[#8b998f]">· {rows.length} записей</span></h2>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 md:max-w-xs"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="pl-9" placeholder="Поиск: контрагент, партия, комментарий" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
      <SearchSelect name="Позиция" value={product} onChange={(v) => { setProduct(v); setPage(0); }} items={data.products.map((p) => ({ value: p.id, title: text(p["Название"]) }))} placeholder="Все позиции" className="w-48" />
      <SearchSelect name="Тип движения" value={kind} onChange={(v) => { setKind(v); setPage(0); }} items={["Приход", "Отгрузка", "Списание"].map((v) => ({ value: v, title: v }))} placeholder="Все типы" className="w-36" />
      <PeriodInputs from={from} to={to} onFrom={(v) => { setFrom(v); setPage(0); }} onTo={(v) => { setTo(v); setPage(0); }} />
      <SearchSelect name="Сортировка" required value={sortBy} onChange={setSortBy} items={[{ value: "date", title: "По дате" }, { value: "kg", title: "По весу" }, { value: "sum", title: "По сумме" }]} className="w-32" />
      <SortDirection desc={desc} onToggle={() => setDesc(!desc)} />
    </div>
    <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[1300px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Дата", "Партия", "Контрагент", "Позиция", "Тип", "Коробки", "Кг", "Цена плановая продажная", "Цена продажи факт", "Сумма", "Отклонение от плана", "Наценка к себестоимости"].map((h) => <th key={h} className={`${th} ${["Коробки", "Кг", "Цена плановая продажная", "Цена продажи факт", "Сумма", "Отклонение от плана", "Наценка к себестоимости"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.slice(page * PAGE, (page + 1) * PAGE).map((r) => {
        const ship = r["Тип"] === "Отгрузка"; const kg = n(r["Кг"]); const sign = r["Тип"] === "Приход" ? "" : "−";
        const markup = markupOf(r);
        const dev = ship && kg ? (n(r["Цена сом/кг"]) - n(r["Цена плановая продажная, сом/кг"])) * kg : null;
        return <tr key={r.id} className="border-b last:border-0">
          <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{date(r["Дата"])}</td>
          <td className={td}>{r["ПартияId"] ? <span className="font-medium">{labelOf(data.batches, r["ПартияId"], "Партия")}</span> : <span className="text-xs text-[#9aa79f]" title="Партия не указана в Excel">{text(r["Источник"]) || "—"}</span>}</td>
          <td className={td}>{labelOf(data.contacts, r["КонтрагентId"])}</td>
          <td className={td}>{labelOf(data.products, r["ТоварId"])}</td>
          <td className={td}><Badge variant="outline" className={r["Тип"] === "Приход" ? "text-[#228166]" : ship ? "text-[#b16f42]" : "text-[#7d8a82]"}>{text(r["Тип"])}</Badge></td>
          <td className={`${td} text-right tabular-nums`}>{r["Коробки"] == null ? "—" : `${sign}${fmt(r["Коробки"], 1)}`}</td>
          <td className={`${td} text-right tabular-nums`}>{kg ? `${sign}${fmt(kg, 2)}` : "—"}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{n(r["Цена плановая продажная, сом/кг"]) ? som(r["Цена плановая продажная, сом/кг"]) : "—"}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{ship && kg ? som(r["Цена сом/кг"]) : "—"}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums`}><span className="inline-flex items-center gap-1">{som(r["Сумма, сом"])}<CalcInfo label="Сумма движения" {...movementInfo(r)} /></span></td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums ${dev != null && dev < 0 ? "text-[#b45c50]" : dev ? "text-[#227964]" : ""}`}>{dev == null ? "—" : <span className="inline-flex items-center gap-1">{dev > 0 ? "+" : ""}{som(dev)}<CalcInfo label="Отклонение от плана" {...deviationInfo(r)} /></span>}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums ${markup && markup.value < 0 ? "text-[#b45c50]" : ""}`}>{markup == null ? "—" : <span className="inline-flex items-center gap-1">{som(markup.value)}{!markup.exact && <span className="text-[10px] text-[#9aa79f]" title="Партия не указана: средняя себестоимость партий товара">≈</span>}<CalcInfo label="Наценка к себестоимости" formula={markup.exact ? "(цена продажи − себестоимость 1 кг партии) × кг" : "(цена продажи − средняя себестоимость 1 кг партий товара) × кг; партия в отгрузке не указана, поэтому это оценка"} substitution={`(${som(r["Цена сом/кг"])} − ${som(Math.round(markup.cost * 100) / 100)}) × ${fmt(kg, 2)} = ${som(markup.value)}`} source={markup.exact ? "Партии: Себестоимость 1 кг, сом" : `Партии товара: ${markup.batches} шт., Σ себестоимость ÷ Σ кг`} excel="«расчет прибыли»: себестоимость за 1 кг; складской лист: цена продажи" /></span>}</td>
        </tr>;
      })}</tbody></table>{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет движений по фильтрам</div>}</div>
    <Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />
  </>;
}
