"use client";

import { useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalcInfo } from "./calc-info";
import type { Dataset, Row } from "./actions";
import { contactInfo } from "./record-info";
import { Segmented, date, labelOf, n, panel, som, td, text, th } from "./ui-kit";

const LOAN_TYPES = ["Займодавец", "Заёмщик"];
export const loanStatus = (row: Row) => Math.abs(n(row["Баланс"])) < 1 ? "Погашен" : "Активен";
const direction = (row: Row) => n(row["Баланс"]) > 0 ? "Должны нам" : n(row["Баланс"]) < 0 ? "Мы должны" : "—";

export default function LoansView({ data, onPayment }: { data: Dataset; onPayment: (contactId: string) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "Активен" | "Погашен">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const loans = data.contacts.filter((c) => LOAN_TYPES.includes(text(c["Тип"])));
  const q = search.toLocaleLowerCase("ru");
  const rows = loans.filter((c) => (status === "all" || loanStatus(c) === status) && (!q || `${text(c["Название"])} ${text(c["Комментарий"])}`.toLocaleLowerCase("ru").includes(q)))
    .sort((a, b) => Math.abs(n(b["Баланс"])) - Math.abs(n(a["Баланс"])));
  const net = loans.filter((c) => c["Тип"] === "Займодавец").reduce((s, c) => s + n(c["Баланс"]), 0);
  const lent = loans.filter((c) => c["Тип"] === "Заёмщик").reduce((s, c) => s + n(c["Баланс"]), 0);
  const weOwe = loans.filter((c) => n(c["Баланс"]) < 0).reduce((s, c) => s + n(c["Баланс"]), 0);
  const oweUs = loans.filter((c) => n(c["Баланс"]) > 0).reduce((s, c) => s + n(c["Баланс"]), 0);
  const active = openId ? data.contacts.find((c) => c.id === openId) ?? null : null;
  const ops = active ? [...data.payments.filter((p) => p["КонтрагентId"] === active.id), ...data.movements.filter((m) => m["КонтрагентId"] === active.id)].sort((a, b) => text(a["Дата"]).localeCompare(text(b["Дата"]))) : [];
  const runningAfter = ops.reduce<number[]>((acc, r) => [...acc, (acc.length ? acc[acc.length - 1] : active ? n(active["Сальдо на начало"]) : 0) + n(r["Влияние на долг"])], []);

  const tiles = [
    { label: "Займы нетто (как в сводке)", value: net, formula: "Σ балансов займодавцев: «+» нам должны, «−» мы должны. Выданные займы (заёмщики) в Excel считаются в «остатке у контрагентов», поэтому сюда не входят", excel: "баланс денег!B16 (с обратным знаком)" },
    { label: "Выданные займы (заёмщики)", value: lent, formula: "Σ балансов контрагентов типа «Заёмщик»; в сводке входят в «Остаток у контрагентов»", excel: "лист «Займ Жолдошбек»!H2 (входит в D5)" },
    { label: "Мы должны", value: weOwe, formula: "Σ отрицательных балансов займов (полученные займы, кредит банка)", excel: "баланс денег: займы со знаком «+»" },
    { label: "Должны нам", value: oweUs, formula: "Σ положительных балансов (выданные займы, деньги у ИП Мырзабеков)", excel: "баланс денег: займы со знаком «−» и лист «Займ Жолдошбек»" },
  ];
  return <>
    <div className="mb-5 rounded border-l-2 border-[#9abeb0] bg-white px-4 py-3 text-xs leading-5 text-[#607166]">Знак как у контрагентов: <b>«+» — должны нам</b> (выдали займ, наши деньги у человека), <b>«−» — мы должны</b>. В Excel на листе «баланс денег» займы записаны с обратным знаком: там «+» — это наш долг (например, кредит банка).</div>
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tiles.map((t) => <div key={t.label} className={`${panel} p-4`}><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{t.label}<CalcInfo label={t.label} formula={t.formula} substitution={`${loans.length} займов → ${som(t.value, 2)}`} source="Контрагенты: типы Займодавец и Заёмщик" excel={t.excel} /></div><div className={`mt-3 text-lg font-semibold tabular-nums ${t.value < 0 ? "text-[#b45c50]" : ""}`}>{som(t.value)}</div></div>)}</div>
    <div className="mb-3 flex flex-wrap items-center gap-2"><div className="relative min-w-[200px] flex-1 md:max-w-xs"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="pl-9" placeholder="Поиск по займам" value={search} onChange={(e) => setSearch(e.target.value)} /></div><Segmented<"all" | "Активен" | "Погашен"> value={status} onChange={setStatus} items={[{ value: "all", title: "Все" }, { value: "Активен", title: "Активные" }, { value: "Погашен", title: "Погашенные" }]} /></div>
    <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[820px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Кредитор / займ", "Тип", "Статус", "Сумма", "Заметки", ""].map((h) => <th key={h} className={`${th} ${h === "Сумма" ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>{rows.map((c) => <tr key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-[#f5faf7]" onClick={() => setOpenId(c.id)}>
      <td className={`${td} font-medium`}>{text(c["Название"])}</td>
      <td className={`${td} text-[#6e7e74]`}>{text(c["Тип"]) === "Заёмщик" ? "Выдан (заёмщик)" : "Получен / кредит"}</td>
      <td className={td}><Badge variant="outline" className={loanStatus(c) === "Активен" ? "border-[#cfe5d8] bg-[#f1f9f4] text-[#2f7a57]" : "text-[#7d8a82]"}>{loanStatus(c)}</Badge></td>
      <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums ${n(c["Баланс"]) < 0 ? "text-[#b45c50]" : ""}`} onClick={(e) => e.stopPropagation()}><span className="inline-flex items-center gap-1">{n(c["Баланс"]) > 0 ? "+" : ""}{som(c["Баланс"])}<CalcInfo label="Баланс займа" {...contactInfo(c)} /></span></td>
      <td className={`${td} max-w-[420px] truncate text-[#74847a]`} title={text(c["Комментарий"])}>{text(c["Комментарий"]) || "—"}</td>
      <td className={`${td} text-[#9aaba2]`}><ChevronRight size={15} /></td>
    </tr>)}</tbody></table>{!rows.length && <div className="p-8 text-center text-sm text-[#86958b]">Нет займов по фильтрам</div>}</div>

    <Dialog open={Boolean(active)} onOpenChange={(v) => { if (!v) setOpenId(null); }}><DialogContent className="max-h-[92vh] max-w-[760px] overflow-y-auto sm:max-w-[760px]"><DialogHeader><DialogTitle>{text(active?.["Название"])}</DialogTitle><DialogDescription>{active ? `${text(active["Тип"]) === "Заёмщик" ? "Выданный займ" : "Полученный займ / кредит"} · ${loanStatus(active)}` : ""}</DialogDescription></DialogHeader>
      {active && <>
        <div className="grid gap-3 sm:grid-cols-2"><div className={`${panel} p-4`}><div className="flex items-center justify-between text-xs text-[#718278]">Остаток<CalcInfo label="Баланс займа" {...contactInfo(active)} /></div><div className={`mt-2 text-2xl font-semibold tabular-nums ${n(active["Баланс"]) < 0 ? "text-[#b45c50]" : "text-[#1d5541]"}`}>{n(active["Баланс"]) > 0 ? "+" : ""}{som(active["Баланс"], 2)}</div><div className="mt-1 text-xs text-[#7d8b83]">{direction(active)}</div></div>
          <div className={`${panel} p-4 text-xs leading-5 text-[#56695e]`}><div className="mb-1 font-semibold text-[#2d4639]">История из Excel</div>{text(active["Комментарий"]) || "Комментарий не указан"}</div></div>
        <div className="mt-2"><Button size="sm" className="bg-[#147d6e] hover:bg-[#10675b]" onClick={() => { const id = active.id; setOpenId(null); onPayment(id); }}><Plus size={15} /> Записать платёж по займу</Button></div>
        <div className="mt-2 overflow-x-auto rounded border"><table className="w-full min-w-[560px] text-sm"><thead className="bg-[#f7faf8]"><tr>{["Дата", "Операция", "Описание", "Изменение", "Остаток"].map((h) => <th key={h} className={`${th} ${["Изменение", "Остаток"].includes(h) ? "text-right" : ""}`}>{h}</th>)}</tr></thead><tbody>
          <tr className="border-b bg-[#f9fbfa]"><td className={td}>—</td><td className={`${td} font-medium`}>Сальдо на начало</td><td className={`${td} text-[#7d8b83]`}>перенос из Excel</td><td className={`${td} text-right`}>—</td><td className={`${td} text-right font-semibold tabular-nums`}>{som(active["Сальдо на начало"], 2)}</td></tr>
          {ops.map((r, i) => { const impact = n(r["Влияние на долг"]); const running = runningAfter[i]; return <tr key={r.id} className="border-b last:border-0"><td className={`${td} whitespace-nowrap text-[#7b8c82]`}>{date(r["Дата"])}</td><td className={td}>{"Направление" in r ? `${text(r["Направление"])} · ${labelOf(data.accounts, r["СчётId"])}` : text(r["Тип"])}</td><td className={`${td} max-w-60 truncate text-[#74847a]`} title={text(r["Описание"] ?? r["Комментарий"])}>{text(r["Описание"] ?? r["Комментарий"]) || "—"}</td><td className={`${td} text-right tabular-nums ${impact < 0 ? "text-[#b45b4c]" : impact ? "text-[#288067]" : "text-[#9aa79f]"}`}>{impact ? `${impact > 0 ? "+" : ""}${som(impact, 2)}` : "не в расчёте"}</td><td className={`${td} text-right tabular-nums`}>{som(running, 2)}</td></tr>; })}
        </tbody></table>{!ops.length && <div className="p-4 text-center text-xs text-[#86958b]">Операций после переноса из Excel нет — остаток равен сальдо на начало</div>}</div>
      </>}
    </DialogContent></Dialog>
  </>;
}
