"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { CalcInfo } from "./calc-info";
import type { Dataset, Row } from "./actions";
import { SummaryDrill, type Drill, type Line } from "./summary-drill";
import { PeriodInputs, Segmented, date, fmt, inPeriod, labelOf, n, panel, som, td, text, th } from "./ui-kit";

type AbcRow = { id: string; name: string; revenue: number; share: number; cumulative: number; cls: "A" | "B" | "C"; count: number };
function abc(groups: Map<string, { name: string; revenue: number; count: number }>): AbcRow[] {
  const list = [...groups].map(([id, g]) => ({ id, ...g })).filter((g) => g.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const total = list.reduce((s, g) => s + g.revenue, 0);
  let acc = 0;
  return list.map((g) => { const before = acc; acc += g.revenue; const share = total ? g.revenue / total * 100 : 0; const cumulative = total ? acc / total * 100 : 0; return { ...g, share, cumulative, cls: before / (total || 1) * 100 < 80 ? "A" : before / (total || 1) * 100 < 95 ? "B" : "C" }; });
}
const clsTone = { A: "border-[#cfe5d8] bg-[#eef8f2] text-[#23734f]", B: "border-[#ead7b8] bg-[#fff8eb] text-[#a36a2f]", C: "border-[#e3e7e4] bg-[#f5f7f6] text-[#76857c]" };
const batchDate = (b: Row) => b["Дата прибытия"] ?? b["Дата предоплаты"];

function AbcTable({ rows, title, what }: { rows: AbcRow[]; title: string; what: string }) {
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  const byClass = (["A", "B", "C"] as const).map((c) => ({ c, count: rows.filter((r) => r.cls === c).length, revenue: rows.filter((r) => r.cls === c).reduce((s, r) => s + r.revenue, 0) }));
  return <div className={`${panel} min-w-0`}><div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><div className="flex items-center gap-1 text-sm font-semibold">{title}<CalcInfo label={title} formula={`${what} сортируются по фактической выручке (Σ сумм отгрузок) по убыванию. A — первые, дающие 80% выручки; B — следующие до 95%; C — остальные`} substitution={`${rows.length} позиций, выручка ${som(total)}`} source="Движения склада: отгрузки за период" excel="В Excel ABC-анализа нет — считается по отгрузкам" /></div><div className="flex gap-1.5">{byClass.map((b) => <Badge key={b.c} variant="outline" className={clsTone[b.c]}>{b.c}: {b.count} · {total ? fmt(b.revenue / total * 100, 1) : 0}%</Badge>)}</div></div>
    <div className="max-h-[420px] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-[#fbfcfb]"><tr>{["#", what, "Выручка факт", "Доля", "Накоплено", "Класс"].map((h) => <th key={h} className={`${th} ${["Выручка факт", "Доля", "Накоплено"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={r.id} className="border-t"><td className={`${td} text-[#a0aca5]`}>{i + 1}</td><td className={`${td} font-medium`}>{r.name}<span className="ml-1 text-[11px] font-normal text-[#9aa79f]">{r.count} отгр.</span></td><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(r.revenue)}</td><td className={`${td} text-right tabular-nums`}>{fmt(r.share, 1)}%</td><td className={`${td} text-right tabular-nums text-[#7d8b83]`}>{fmt(r.cumulative, 1)}%</td><td className={td}><Badge variant="outline" className={clsTone[r.cls]}>{r.cls}</Badge></td></tr>)}</tbody></table>{!rows.length && <div className="p-6 text-center text-xs text-[#86958b]">Нет отгрузок за период</div>}</div></div>;
}

export default function AnalyticsView({ data, onOpenBatch, onOpenContact }: { data: Dataset; onOpenBatch: (row: Row) => void; onOpenContact: (row: Row) => void }) {
  const [drillKey, setDrillKey] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [country, setCountry] = useState<"all" | "Китай" | "РФ">("all");
  const shipments = data.movements.filter((m) => m["Тип"] === "Отгрузка" && inPeriod(m["Дата"], from, to));
  const batches = data.batches.filter((b) => (country === "all" || b["Страна"] === country) && inPeriod(batchDate(b), from, to));

  const purchaseChina = batches.filter((b) => b["Страна"] === "Китай").reduce((s, b) => s + n(b["Себестоимость итого, сом"]), 0);
  const purchaseRussia = batches.filter((b) => b["Страна"] === "РФ").reduce((s, b) => s + n(b["Себестоимость итого, сом"]), 0);
  const planned = batches.reduce((s, b) => s + n(b["Выручка, сом"]), 0);
  const factRevenue = shipments.reduce((s, m) => s + n(m["Сумма, сом"]), 0);
  const withPlan = shipments.filter((m) => n(m["Кг"]) > 0 && n(m["Цена плановая продажная, сом/кг"]) > 0);
  const deviation = withPlan.reduce((s, m) => s + (n(m["Цена сом/кг"]) - n(m["Цена плановая продажная, сом/кг"])) * n(m["Кг"]), 0);

  const products = data.products.map((p) => {
    const own = data.batches.filter((b) => b["ТоварId"] === p.id);
    const boughtAll = own.reduce((s, b) => s + n(b["Кг"]), 0); const costAll = own.reduce((s, b) => s + n(b["Себестоимость итого, сом"]), 0);
    const avgCost = boughtAll ? costAll / boughtAll : 0;
    const bought = batches.filter((b) => b["ТоварId"] === p.id);
    const sold = shipments.filter((m) => m["ТоварId"] === p.id && n(m["Кг"]) > 0);
    const soldKg = sold.reduce((s, m) => s + n(m["Кг"]), 0);
    const plan = sold.reduce((s, m) => s + n(m["Кг"]) * n(m["Цена плановая продажная, сом/кг"]), 0);
    const fact = sold.reduce((s, m) => s + n(m["Сумма, сом"]), 0);
    return { id: p.id, name: text(p["Название"]), boughtKg: bought.reduce((s, b) => s + n(b["Кг"]), 0), boughtSom: bought.reduce((s, b) => s + n(b["Себестоимость итого, сом"]), 0), avgCost, soldKg, plan, fact, dev: fact - plan, margin: avgCost ? fact - soldKg * avgCost : null, ops: sold.length };
  }).filter((r) => r.boughtKg || r.soldKg);
  const chart = products.filter((r) => r.fact || r.plan).map((r) => ({ name: r.name, "План": Math.round(r.plan), "Факт": Math.round(r.fact) }));

  const clientAbc = abc(shipments.reduce((m, s) => { const id = text(s["КонтрагентId"]) || "none"; const g = m.get(id) ?? { name: s["КонтрагентId"] ? labelOf(data.contacts, s["КонтрагентId"]) : "Без контрагента", revenue: 0, count: 0 }; g.revenue += n(s["Сумма, сом"]); g.count += 1; m.set(id, g); return m; }, new Map<string, { name: string; revenue: number; count: number }>()));
  const productAbc = abc(shipments.filter((s) => s["ТоварId"]).reduce((m, s) => { const id = text(s["ТоварId"]); const g = m.get(id) ?? { name: labelOf(data.products, id), revenue: 0, count: 0 }; g.revenue += n(s["Сумма, сом"]); g.count += 1; m.set(id, g); return m; }, new Map<string, { name: string; revenue: number; count: number }>()));

  const tiles = [
    { key: "china", label: "Закупка Китай", value: purchaseChina, formula: "Σ «Себестоимость итого» партий из Китая (оплата поставщику + комиссия + таможня + НДС/НсП + логистика)", excel: "расчет прибыли!Z (сумма)" },
    { key: "russia", label: "Закупка РФ", value: purchaseRussia, formula: "Σ «Себестоимость итого» партий из РФ (цена ₽ × курс × кг + НДС 12% + НсП 4% + логистика)", excel: "РФ расчет!K × L (сумма)" },
    { key: "planned", label: "Плановая продажа (партии)", value: planned, formula: "Σ кг партии × плановая цена продажи — так продажу считает Excel", excel: "расчет прибыли!AE (сумма)" },
    { key: "fact", label: "Фактическая продажа (отгрузки)", value: factRevenue, formula: "Σ сумм отгрузок клиентам (кг × фактическая цена или сумма из листа взаиморасчёта)", excel: "Листы контрагентов: «поставлено товара на сумму»" },
    { key: "deviation", label: "Отклонение факт − план", value: deviation, formula: "Σ (факт. цена − плановая цена) × кг по отгрузкам, где известны обе цены", excel: "Складские листы: колонка «разница» (с обратным знаком)" },
  ];
  // drill-down of a tile: the batches / shipments that add up to its value
  const close = (fn: (row: Row) => void) => (row: Row) => { setDrillKey(null); fn(row); };
  const batchLine = (b: Row, value: number, cells: string[]): Line => ({ key: b.id, value, open: () => close(onOpenBatch)(b), cells: [text(b["Партия"]) || text(b["Номер партии"]), date(batchDate(b)), ...cells] });
  const shipmentLine = (m: Row, value: number, cells: string[]): Line => {
    const contact = data.contacts.find((c) => c.id === m["КонтрагентId"]);
    return { key: m.id, value, open: contact ? () => close(onOpenContact)(contact) : undefined, cells: [date(m["Дата"]), contact ? text(contact["Название"]) : "—", labelOf(data.products, m["ТоварId"]), ...cells] };
  };
  const newest = (key: (r: Row) => unknown) => (a: Row, b: Row) => text(key(b)).localeCompare(text(key(a)));
  const purchase = (country: string) => batches.filter((b) => b["Страна"] === country).sort(newest(batchDate))
    .map((b) => batchLine(b, n(b["Себестоимость итого, сом"]), [`${fmt(b["Кг"])} кг`, som(b["Себестоимость 1 кг, сом"], 2), som(b["Себестоимость итого, сом"])]));
  const purchaseColumns = ["Партия", "Дата прибытия", "Кг", "Себестоимость 1 кг", "Себестоимость итого"];
  const drills: Record<string, () => Omit<Drill, "value" | "total">> = {
    china: () => ({ title: "Закупка Китай", formula: "Сумма «Себестоимость итого» партий из Китая за период: оплата поставщику по курсам + комиссия + банк + пошлина + НДС/НсП + прочие + выгрузка.", excel: "«расчет прибыли»!Z", groups: [{ title: "Партии из Китая", columns: purchaseColumns, lines: purchase("Китай") }] }),
    russia: () => ({ title: "Закупка РФ", formula: "Сумма «Себестоимость итого» партий из РФ за период: цена ₽ × курс × кг + НДС 12% + НсП 4% + логистика.", excel: "«РФ расчет»!K × L", groups: [{ title: "Партии из РФ", columns: purchaseColumns, lines: purchase("РФ") }] }),
    planned: () => ({ title: "Плановая продажа (партии)", formula: "Сумма по партиям: кг × плановая цена продажи — так продажу считает Excel.", excel: "«расчет прибыли»!AE", groups: [{ title: "Партии", columns: ["Партия", "Дата прибытия", "Кг", "Плановая цена", "Плановая продажа"], lines: [...batches].sort(newest(batchDate)).map((b) => batchLine(b, n(b["Выручка, сом"]), [`${fmt(b["Кг"])} кг`, som(b["Цена продажи сом/кг"], 2), som(b["Выручка, сом"])])) }] }),
    fact: () => ({ title: "Фактическая продажа (отгрузки)", formula: "Сумма всех отгрузок клиентам за период: кг × фактическая цена (или сумма из листа взаиморасчёта, если веса нет).", excel: "листы контрагентов: «поставлено товара на сумму»", groups: [{ title: "Отгрузки", columns: ["Дата", "Клиент", "Товар", "Кг", "Цена", "Сумма"], lines: [...shipments].sort(newest((r) => r["Дата"])).map((m) => shipmentLine(m, n(m["Сумма, сом"]), [n(m["Кг"]) ? fmt(m["Кг"], 2) : "—", n(m["Цена сом/кг"]) ? som(m["Цена сом/кг"], 2) : "—", som(m["Сумма, сом"])])) }] }),
    deviation: () => ({ title: "Отклонение факт − план", formula: "Сумма по отгрузкам, где известны обе цены: (фактическая цена − плановая цена) × кг. «+» — продали дороже плана, «−» — дешевле.", excel: "складские листы: колонка «разница» (с обратным знаком)", groups: [{ title: "Отгрузки с плановой и фактической ценой", columns: ["Дата", "Клиент", "Товар", "Кг", "План", "Факт", "Отклонение"], lines: [...withPlan].sort(newest((r) => r["Дата"])).map((m) => { const dev = (n(m["Цена сом/кг"]) - n(m["Цена плановая продажная, сом/кг"])) * n(m["Кг"]); return shipmentLine(m, dev, [fmt(m["Кг"], 2), som(m["Цена плановая продажная, сом/кг"], 2), som(m["Цена сом/кг"], 2), som(dev)]); }) }] }),
  };
  const activeTile = tiles.find((t) => t.key === drillKey);
  const activeDrill: Drill | null = activeTile ? { ...drills[activeTile.key](), value: som(activeTile.value), total: activeTile.value } : null;
  const period = from || to ? `${from ? date(from) : "начала"} — ${to ? date(to) : "сегодня"}` : "весь период";
  return <>
    <div className="mb-5 flex flex-wrap items-center gap-3"><PeriodInputs title="Период" from={from} to={to} onFrom={setFrom} onTo={setTo} /><Segmented<"all" | "Китай" | "РФ"> value={country} onChange={setCountry} items={[{ value: "all", title: "Китай и РФ" }, { value: "Китай", title: "Китай" }, { value: "РФ", title: "РФ" }]} /><span className="text-xs text-[#8b998f]">Партии — по дате прибытия, отгрузки — по дате отгрузки</span></div>
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{tiles.map((t) => <div key={t.label} role="button" tabIndex={0} onClick={() => setDrillKey(t.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrillKey(t.key); } }} className={`${panel} group cursor-pointer p-4 outline-none transition hover:border-[#9fcbb9] hover:shadow-[0_2px_8px_rgba(20,80,60,.07)] focus-visible:ring-2 focus-visible:ring-[#178779]/30`}><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{t.label}<span onClick={(e) => e.stopPropagation()}><CalcInfo label={t.label} formula={t.formula} substitution={`${period}: ${som(t.value)}`} source={t.label.includes("отгруз") || t.label.includes("Отклонение") ? `Движения склада: ${shipments.length} отгрузок` : `Партии: ${batches.length}`} excel={t.excel} /></span></div><div className={`mt-3 text-lg font-semibold tabular-nums ${t.value < 0 ? "text-[#b45c50]" : ""}`}>{som(t.value)}</div><div className="mt-2 text-[11px] text-[#7d958a] opacity-70 group-hover:opacity-100">Из чего сложилось →</div></div>)}</div>

    <div className={`${panel} mb-6 p-5`}><div className="mb-4 flex items-center justify-between gap-2 text-sm font-semibold">План и факт продаж по товарам<CalcInfo label="План и факт по товарам" formula="План = Σ кг отгрузок × плановая цена продажи; Факт = Σ сумм отгрузок; учитываются отгрузки с указанным товаром и весом" substitution={`${products.length} товаров, ${period}`} source="Движения склада и Партии" excel="Складские листы: цена (план) и реализация (факт)" /></div>{chart.length ? <div className="h-72"><ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 800, height: 288 }}><BarChart data={chart} margin={{ top: 4, right: 5, left: -8, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e9eeeb" /><XAxis dataKey="name" tick={{ fontSize: 10, fill: "#84918a" }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} /><YAxis tickFormatter={(v) => `${fmt(v / 1000000, 1)}м`} tick={{ fontSize: 10, fill: "#84918a" }} axisLine={false} tickLine={false} /><ChartTooltip formatter={(v) => som(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="План" fill="#b9d6ca" radius={[3, 3, 0, 0]} maxBarSize={26} /><Bar dataKey="Факт" fill="#168272" radius={[3, 3, 0, 0]} maxBarSize={26} /></BarChart></ResponsiveContainer></div> : <div className="py-10 text-center text-xs text-[#89968e]">Нет отгрузок за период</div>}</div>

    <div className={`${panel} mb-6 overflow-x-auto`}><table className="w-full min-w-[1150px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Товар", "Закуплено, кг", "Закупка, сом", "Ср. закупка, сом/кг", "Отгружено, кг", "Продажа план", "Продажа факт", "Факт − план", "Валовая прибыль факт"].map((h, i) => <th key={h} className={`${th} ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>{products.map((r) => <tr key={r.id} className="border-b last:border-0">
      <td className={`${td} font-medium`}>{r.name}</td><td className={`${td} text-right tabular-nums`}>{fmt(r.boughtKg)}</td><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(r.boughtSom)}</td>
      <td className={`${td} whitespace-nowrap text-right tabular-nums`}><span className="inline-flex items-center gap-1">{r.avgCost ? som(r.avgCost, 2) : "—"}<CalcInfo label="Средняя закупка, сом/кг" formula="Σ себестоимости всех партий товара ÷ Σ кг этих партий (за всё время)" substitution={r.avgCost ? `${som(r.avgCost, 2)} / кг` : "по товару нет партий"} source={`Партии товара «${r.name}»`} excel="расчет прибыли!AA, РФ расчет!K (средневзвешенно)" /></span></td>
      <td className={`${td} text-right tabular-nums`}>{fmt(r.soldKg)}</td><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(r.plan)}</td><td className={`${td} whitespace-nowrap text-right tabular-nums`}>{som(r.fact)}</td>
      <td className={`${td} whitespace-nowrap text-right tabular-nums ${r.dev < 0 ? "text-[#b45c50]" : r.dev ? "text-[#227964]" : ""}`}><span className="inline-flex items-center gap-1">{r.dev > 0 ? "+" : ""}{som(r.dev)}<CalcInfo label="Факт − план" formula="Продажа факт − продажа план по отгрузкам товара" substitution={`${som(r.fact)} − ${som(r.plan)} = ${som(r.dev)}`} source={`${r.ops} отгрузок`} excel="Складской лист: «разница»" /></span></td>
      <td className={`${td} whitespace-nowrap text-right tabular-nums ${r.margin != null && r.margin < 0 ? "text-[#b45c50]" : ""}`}><span className="inline-flex items-center gap-1">{r.margin == null ? "—" : som(r.margin)}<CalcInfo label="Валовая прибыль факт" formula="Продажа факт − отгружено кг × средняя закупка сом/кг" substitution={r.margin == null ? "нет данных о закупке товара" : `${som(r.fact)} − ${fmt(r.soldKg)} × ${som(r.avgCost, 2)} = ${som(r.margin)}`} source={`Отгрузки и партии товара «${r.name}»`} excel="В Excel нет: там прибыль считается от плановой цены" /></span></td>
    </tr>)}</tbody></table>{!products.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет данных за период</div>}</div>

    <div className="grid gap-5 xl:grid-cols-2"><AbcTable rows={clientAbc} title="ABC-анализ клиентов" what="Контрагент" /><AbcTable rows={productAbc} title="ABC-анализ товаров" what="Товар" /></div>
    <div className="mt-3 text-xs text-[#8b998f]">ABC товаров учитывает только отгрузки с указанным товаром; суммы из листов взаиморасчёта без товара попадают только в ABC клиентов.</div>
    <SummaryDrill drill={activeDrill ? { ...activeDrill, title: `${activeDrill.title} · ${period}` } : null} onClose={() => setDrillKey(null)} />
  </>;
}
