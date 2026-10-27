"use client";

import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Dataset, Row } from "./actions";
import { UPCOMING, amount, plannedTransfersSom, type calculateSummary } from "./finance";

// Drill-down of a summary metric: the formula in words and every record that adds up to the number.
export type DrillKey = "accounts" | "counterparts" | "inTransit" | "stock" | "turnover" | "loans" | "capital" | "taxes" | "upcoming" | "real" | "profitPlan" | "profitFact";
type Summary = ReturnType<typeof calculateSummary>;
export type Line = { key: string; cells: string[]; value: number; muted?: boolean; open?: () => void };
export type Group = { title: string; columns: string[]; lines: Line[]; total?: number; note?: string };
export type Drill = { title: string; value: string; formula: string; groups: Group[]; total: number; excel: string };

const fmt = (value: unknown, digits = 0) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount(value));
const som = (value: unknown, digits = 0) => `${fmt(value, digits)} сом`;
const usd = (value: unknown) => value == null ? "нет курса" : `${fmt(value, 2)} $`;
const text = (value: unknown) => value == null ? "" : String(value);
const transit = ["Предоплата", "В пути", "На таможне"];

export function buildDrill(key: DrillKey, data: Dataset, s: Summary, open: { contact: (row: Row) => void; batch: (row: Row) => void }): Drill {
  const byValue = (a: Line, b: Line) => Math.abs(b.value) - Math.abs(a.value);
  const contactLine = (c: Row): Line => ({ key: c.id, value: amount(c["Баланс"]), open: () => open.contact(c),
    cells: [text(c["Название"]), som(c["Сальдо на начало"]), som(c["Отгрузки в долг"]), som(c["Платежи в расчёт"]), som(c["Авансы за партии в пути"]), som(c["Через кассы (взаиморасчёт)"]), som(c["Баланс"])] });
  const contactColumns = ["Контрагент", "Сальдо на начало", "Отгрузки в долг", "Платежи", "Авансы за партии", "По его кассам", "Баланс"];
  const contacts = (type: string) => data.contacts.filter((c) => c["Тип"] === type && Math.abs(amount(c["Баланс"])) >= 0.005).map(contactLine).sort(byValue);
  const group = (title: string, columns: string[], lines: Line[], note?: string): Group => ({ title, columns, lines, total: lines.reduce((sum, l) => sum + l.value, 0), note });

  const accounts = (): Group[] => {
    const line = (a: Row): Line => ({ key: a.id, value: amount(a["Остаток"]), muted: !a["Учитывать в сводке"], cells: [text(a["Название"]), text(a["Юрлицо"]) || "—", som(a["Остаток на начало"], 2), som(a["Оборот по счёту"], 2), som(a["Остаток"], 2)] });
    const columns = ["Счёт", "Юрлицо", "Остаток на начало", "Приходы − расходы", "Остаток"];
    return [group("Входят в сводку", columns, data.accounts.filter((a) => a["Учитывать в сводке"]).map(line).sort(byValue)),
      { ...group("Не входят в сводку (как в формуле Excel)", columns, data.accounts.filter((a) => !a["Учитывать в сводке"]).map(line).sort(byValue)), note: "Показаны для справки, в сумму не входят" }];
  };
  const counterparts = (): Group[] => [
    group("Клиенты", contactColumns, contacts("Клиент")),
    group("Партнёры", contactColumns, contacts("Партнёр")),
    group("Прочее", contactColumns, contacts("Прочее")),
  ];
  const inTransit = (): Group[] => {
    const unlinked = data.batches.filter((b) => transit.includes(text(b["Статус"])) && !b["ПоставщикId"] && amount(b["Аванс поставщику (в пути), сом"]));
    return [
      group("Поставщики: предоплата на начало + авансы их партий в пути", contactColumns, data.contacts.filter((c) => c["Тип"] === "Поставщик").map(contactLine).sort(byValue)),
      group("Партии в пути без поставщика", ["Партия", "Статус", "Оплачено поставщику", "Аванс в пути"], unlinked.map((b) => ({ key: b.id, value: amount(b["Аванс поставщику (в пути), сом"]), open: () => open.batch(b), cells: [text(b["Партия"]), text(b["Статус"]), som(plannedTransfersSom(b)), som(b["Аванс поставщику (в пути), сом"])] }))),
    ];
  };
  const stock = (): Group[] => [group("Остатки товаров", ["Товар", "Остаток, кг", "Средняя плановая цена", "Стоимость"],
    data.products.filter((p) => Math.abs(amount(p["Остаток, кг"])) >= 0.005 || amount(p["Стоимость остатка, сом"])).map((p) => ({ key: p.id, value: amount(p["Стоимость остатка, сом"]), cells: [text(p["Название"]), `${fmt(p["Остаток, кг"], 2)} кг`, som(p["Средняя плановая цена, сом/кг"], 2), som(p["Стоимость остатка, сом"])] })).sort(byValue))];
  const loans = (): Group[] => [
    group("Займодавцы (кредит, полученные займы)", contactColumns, contacts("Займодавец")),
    group("Заёмщики (выданные займы)", contactColumns, contacts("Заёмщик")),
  ];
  // profit of the arrived batches: the plan, and for the sold ones the plan + the actual price deviation of their shipments
  const shipments = data.movements ?? [];
  const deviation = (batchId: string) => shipments.reduce((sum, m) => m["ПартияId"] === batchId && m["Тип"] === "Отгрузка" ? sum + amount(m["Отклонение от плана, сом"]) : sum, 0);
  const arrived = data.batches.filter((b) => ["На складе", "Продана"].includes(text(b["Статус"])) && amount(b["Цена продажи сом/кг"]) > 0)
    .sort((a, b) => text(b["Дата прибытия"]).localeCompare(text(a["Дата прибытия"])));
  const profit = (fact: boolean): Group[] => {
    const line = (b: Row): Line => {
      const plan = amount(b["Прибыль, сом"]), sold = b["Статус"] === "Продана", dev = sold ? deviation(b.id) : 0;
      return { key: b.id, value: fact ? plan + dev : plan, open: () => open.batch(b),
        cells: fact ? [text(b["Партия"]), text(b["Статус"]), som(plan), sold ? (Math.abs(dev) < 0.005 ? "по плану" : `${dev > 0 ? "+" : ""}${som(dev)}`) : "ещё не продана", som(plan + dev)] : [text(b["Партия"]), text(b["Статус"]), som(b["Выручка, сом"]), som(b["Себестоимость итого, сом"]), som(plan)] };
    };
    const groups = [group("Пришедшие партии", fact ? ["Партия", "Статус", "Прибыль по плану", "Продали дороже (+) / дешевле (−) плана", "Итого"] : ["Партия", "Статус", "Выручка (план)", "Себестоимость", "Прибыль (план)"], arrived.map(line))];
    // shipments without a batch: their deviation is real but belongs to no batch — shown apart, not in the total
    const loose = shipments.filter((m) => m["Тип"] === "Отгрузка" && !m["ПартияId"] && Math.abs(amount(m["Отклонение от плана, сом"])) >= 0.005);
    if (fact && loose.length) groups.push({ ...group("Отгрузки без партии (не входят в прибыль партий)", ["Отгрузка", "Продали дороже (+) / дешевле (−) плана"], loose.map((m) => ({ key: m.id, value: amount(m["Отклонение от плана, сом"]), muted: true, cells: [text(m["Операция"]), som(m["Отклонение от плана, сом"])] }))), note: "Указывайте партию в отгрузке — тогда отклонение цены попадёт в прибыль этой партии." });
    return groups;
  };
  const parts = (lines: [string, number][]): Group => group("Составляющие", ["Показатель", "Сумма"], lines.map(([title, value]) => ({ key: title, value, cells: [title, som(value, 2)] })));

  switch (key) {
    case "accounts": return { title: "Деньги на счетах", value: som(s.accounts), total: s.accounts, formula: "Сумма остатков счетов с галочкой «Учитывать в сводке». Остаток счёта = остаток на начало + приходы − расходы по платежам.", groups: accounts(), excel: "«Итого на РС (кроме Мырзабеков)»" };
    case "counterparts": return { title: "Остаток у контрагентов", value: som(s.counterparts), total: s.counterparts, formula: "Сумма балансов клиентов, партнёров и прочих. Баланс = сальдо на начало + отгрузки в долг + платежи (оплата клиента со знаком минус) + авансы за партии. «+» — должны нам, «−» — мы должны. Выданные займы считаются в «Займах».", groups: counterparts(), excel: "«Остаток по контрагентам» (клиенты + партнёры)" };
    case "inTransit": return { title: "Отправлено поставщикам (товар в пути)", value: som(s.inTransit), total: s.inTransit, formula: "Деньги, реально отправленные за товар, который ещё не пришёл: балансы поставщиков (предоплата на начало + оплаты из кассы по их партиям в пути) плюс оплаты из кассы по партиям в пути без поставщика. Плановая предоплата в карточке партии не считается, пока оплата не записана в кассе.", groups: inTransit(), excel: "«Расчеты с поставщиками»: РФ + Китай" };
    case "stock": return { title: "Склад по плановой цене", value: som(s.stock), total: s.stock, formula: "Сумма по товарам: остаток, кг × плановая цена продажи (по каждому приходу и отгрузке).", groups: stock(), excel: "«Остаток по складу»: итого кг × цена реализации" };
    case "loans": return { title: "Займы (нетто)", value: som(s.loans), total: s.loans, formula: "Сумма балансов займодавцев и заёмщиков. «+» — нам должны (выданные займы, ИП Мырзабеков), «−» — мы должны (кредит банка, полученные займы).", groups: loans(), excel: "«Итого займов» с обратным знаком" };
    case "taxes": return { title: "Налоги к уплате", value: som(s.taxes), total: s.taxes, formula: "Сумма «начислено − оплачено» по всем начислениям налогов.", excel: "Расходы!E1",
      groups: [group("Начисления", ["Основание", "Начислено", "Оплачено", "Остаток к уплате"], data.taxes.filter((t) => t["Статья"] !== UPCOMING && amount(t["Остаток к уплате, сом"])).map((t) => ({ key: t.id, value: amount(t["Остаток к уплате, сом"]), cells: [text(t["Основание"]), som(t["Начислено, сом"]), som(t["Оплачено, сом"]), som(t["Остаток к уплате, сом"])] })).sort(byValue))] };
    case "upcoming": return { title: "Предстоящие оплаты по партиям", value: som(s.upcoming), total: s.upcoming, formula: "Сумма «начислено − оплачено» по предстоящим оплатам (логистика, растаможка и др. за товар, который уже пришёл, но ещё не оплачен). Касса → Плановые расходы.", excel: "—",
      groups: [group("Предстоящие оплаты", ["Основание", "Партия", "Начислено", "Оплачено", "Остаток к оплате"], data.taxes.filter((t) => t["Статья"] === UPCOMING && amount(t["Остаток к уплате, сом"])).map((t) => ({ key: t.id, value: amount(t["Остаток к уплате, сом"]), cells: [text(t["Основание"]), text(data.batches.find((b) => b.id === t["ПартияId"])?.["Партия"]) || "—", som(t["Начислено, сом"]), som(t["Оплачено, сом"]), som(t["Остаток к уплате, сом"])] })).sort(byValue))] };
    case "turnover": return { title: "Итого денег в обороте", value: som(s.turnover), total: s.turnover, formula: "Деньги на счетах + остаток у контрагентов + отправлено поставщикам + склад по плановой цене. Каждую составляющую можно открыть на сводке.", excel: "F16 / сумма строки «остаток у контрагентов, на Р/С, отправлено, склад»",
      groups: [parts([["Деньги на счетах", s.accounts], ["Остаток у контрагентов", s.counterparts], ["Отправлено поставщикам", s.inTransit], ["Склад по плановой цене", s.stock]])] };
    case "capital": return { title: "Разница / прибыль (капитал)", value: som(s.capital), total: s.capital, formula: "Итого денег в обороте + займы (нетто).", excel: "I16 = F16 − займы",
      groups: [parts([["Итого денег в обороте", s.turnover], ["Займы (нетто)", s.loans]])] };
    case "profitPlan": return { title: "Плановая прибыль по пришедшим партиям", value: som(s.plannedProfitSom), total: s.plannedProfitSom, formula: "Сумма прибыли по плановой цене продажи (выручка по плану − себестоимость) партий «На складе» и «Продана». Нажмите на партию, чтобы открыть её.", excel: "«расчет прибыли» AG", groups: profit(false) };
    case "profitFact": return { title: "Прибыль: проданные — факт, остальные — план", value: som(s.factProfitSom), total: s.factProfitSom, formula: "Для проданных партий — плановая прибыль плюс то, насколько их фактически продали дороже или дешевле плановой цены (по отгрузкам этой партии); «по плану» — продали ровно по плановой цене. Для непроданных — плановая прибыль. Нажмите на партию, чтобы открыть её.", excel: "—", groups: profit(true) };
    case "real": return { title: "Реальный остаток после налогов, $", value: usd(s.realUsd), total: s.capital - s.taxes - s.upcoming, formula: `(Капитал − налоги к уплате − предстоящие оплаты по партиям) ÷ курс $ для отчётов (${s.rate == null ? "не указан" : fmt(s.rate, 2)}). Итог ниже — в сомах, до перевода в доллары.`, excel: "K16",
      groups: [parts([["Капитал", s.capital], ["Налоги к уплате", -s.taxes], ...(s.upcoming ? [["Предстоящие оплаты по партиям", -s.upcoming] as [string, number]] : [])])] };
  }
}

/** The drill over a period: every line with its value at the start, the change and the value at the end
 *  (lines that were there only at the start are kept with 0 at the end). Accounts also show the money in and out. */
export function periodDrill(end: Drill, start: Drill, period: { from: string; to: string; flows?: Map<string, { inflow: number; outflow: number }> }): Drill {
  const groups = end.groups.map((g, i) => {
    const before = new Map((start.groups[i]?.lines ?? []).map((l) => [l.key, l]));
    const keys = new Set(g.lines.map((l) => l.key));
    const gone = [...before.values()].filter((l) => !keys.has(l.key)).map((l): Line => ({ ...l, value: 0, cells: [l.cells[0]] }));
    const lines = [...g.lines, ...gone].map((l): Line => {
      const was = before.get(l.key)?.value ?? 0, flow = period.flows?.get(l.key);
      return { ...l, cells: [l.cells[0], som(was, 2), ...(flow ? [som(flow.inflow, 2), som(-flow.outflow, 2)] : [signed(l.value - was)]), som(l.value, 2)] };
    }).filter((l) => Math.abs(l.value) >= 0.005 || Math.abs(before.get(l.key)?.value ?? 0) >= 0.005);
    return { ...g, columns: [g.columns[0], `На ${period.from}`, ...(period.flows ? ["Приходы", "Расходы"] : ["Изменение"]), `На ${period.to}`], lines };
  });
  const change = end.total - start.total;
  return { ...end, groups, value: `${end.value} · ${signed(change)} за период`, formula: `${end.formula} Период: на ${period.from} было ${som(start.total, 2)}, изменение ${signed(change)}, на ${period.to} стало ${som(end.total, 2)}.` };
}
const signed = (value: number) => Math.abs(value) < 0.005 ? "0 сом" : `${value > 0 ? "+" : "−"}${som(Math.abs(value), 2)}`;

export function SummaryDrill({ drill, onClose }: { drill: Drill | null; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const q = search.toLocaleLowerCase("ru");
  const many = (drill?.groups.reduce((n, g) => n + g.lines.length, 0) ?? 0) > 12;
  return <Sheet open={Boolean(drill)} onOpenChange={(v) => { if (!v) { setSearch(""); onClose(); } }}>
    <SheetContent side="right" className="w-full overflow-y-auto bg-[#f7f9f8] sm:max-w-[820px]">
      {drill && <>
        <SheetHeader className="border-b bg-white px-6 py-5"><SheetTitle className="text-lg">{drill.title}</SheetTitle><SheetDescription className="text-2xl font-semibold tabular-nums text-[#1b352b]">{drill.value}</SheetDescription></SheetHeader>
        <div className="space-y-5 px-6 py-5">
          <div className="rounded-md border border-[#dce7df] bg-white p-4 text-sm"><div className="mb-1 text-xs font-medium text-[#718278]">Как считается</div><div className="text-[#2f453b]">{drill.formula}</div><div className="mt-2 text-[11px] text-[#8b998f]">В таблице клиента: {drill.excel}</div></div>
          {many && <div className="relative"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="bg-white pl-9" placeholder="Поиск по строкам" value={search} onChange={(e) => setSearch(e.target.value)} /></div>}
          {drill.groups.filter((g) => g.lines.length || drill.groups.every((x) => !x.lines.length)).map((g) => { const lines = g.lines.filter((l) => !q || l.cells.join(" ").toLocaleLowerCase("ru").includes(q)); return <section key={g.title} className="rounded-md border border-[#e1e7e4] bg-white">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><div><div className="text-sm font-semibold">{g.title}</div>{g.note && <div className="text-[11px] text-[#8b998f]">{g.note}</div>}</div><div className="text-right text-sm font-semibold tabular-nums">{g.lines.length} · {som(g.total ?? g.lines.reduce((sum, l) => sum + l.value, 0), 2)}</div></div>
            {lines.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-[#fbfcfb] text-xs text-[#839188]"><tr>{g.columns.map((c, i) => <th key={c} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{c}</th>)}<th className="w-6" /></tr></thead>
              <tbody>{lines.map((l) => <tr key={l.key} onClick={l.open} className={`border-t ${l.open ? "cursor-pointer hover:bg-[#f5faf7]" : ""} ${l.muted ? "text-[#9aa79f]" : ""}`}>{l.cells.map((c, i) => <td key={i} className={`px-3 py-2 ${i ? "whitespace-nowrap text-right tabular-nums" : ""} ${i === l.cells.length - 1 ? "font-semibold" : ""}`}>{c}</td>)}<td className="pr-2 text-[#9aaba2]">{l.open && <ChevronRight size={14} />}</td></tr>)}</tbody></table></div>
              : <div className="px-4 py-5 text-center text-xs text-[#86958b]">{g.lines.length ? "Ничего не найдено" : "Нет записей"}</div>}
          </section>; })}
          <div className="flex items-center justify-between rounded-md border border-[#c7e0d5] bg-[#eaf5ee] px-4 py-3 text-sm font-semibold"><span>Итого</span><span className="tabular-nums">{som(drill.total, 2)}</span></div>
        </div>
      </>}
    </SheetContent>
  </Sheet>;
}
