"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalcInfo } from "./calc-info";
import type { Dataset, Row, TableKey } from "./actions";
import { Progress, SearchSelect, date, fmt, labelOf, n, panel, text, uiInput } from "./ui-kit";

type Kind = "quotas" | "licenses" | "requests";
type Form = Record<string, unknown>;
const kg = (v: unknown) => `${fmt(v)} кг`;
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function QuotasView({ data, busy, onCreate }: { data: Dataset; busy: boolean; onCreate: (key: TableKey, input: Form, optimistic: Form) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(data.quotas.map((q) => q.id)));
  const [modal, setModal] = useState<{ kind: Kind; parent?: Row } | null>(null);
  const [form, setForm] = useState<Form>({});
  // quotas and licenses exist only for imports from China (RF goes without them)
  const country = "Китай";
  const quotas = data.quotas.filter((q) => !q["Страна"] || q["Страна"] === country);
  const licensesOf = (q: Row) => data.licenses.filter((l) => l["КвотаId"] === q.id).sort((a, b) => text(a["Лицензия"]).localeCompare(text(b["Лицензия"]), "ru", { numeric: true }));
  const requestsOf = (l: Row) => data.requests.filter((r) => r["ЛицензияId"] === l.id).sort((a, b) => text(a["Заявка"]).localeCompare(text(b["Заявка"]), "ru", { numeric: true }));
  const requestedOf = (l: Row) => requestsOf(l).reduce((s, r) => s + n(r["Объём, кг"]), 0);
  const quotaTotals = (q: Row) => {
    const ls = licensesOf(q); const inLicenses = ls.reduce((s, l) => s + n(l["Объём, кг"]), 0); const requested = ls.reduce((s, l) => s + requestedOf(l), 0);
    return { ls, inLicenses, requested, notDistributed: n(q["Объём, кг"]) - inLicenses, left: n(q["Объём, кг"]) - requested };
  };
  const start = (kind: Kind, parent?: Row) => {
    const scope = { "Товар": parent?.["ТоварId"] ?? "", "Страна": text(parent?.["Страна"]) || country };
    setForm(kind === "quotas" ? { "Дата": today(), "Период": new Date().getFullYear().toString(), "Страна": country } : kind === "licenses" ? { "Дата": today(), "Квота": parent?.id, ...scope } : { "Дата": today(), "Лицензия": parent?.id, "Статус": "Открыта", ...scope });
    setModal({ kind, parent });
  };
  const toggle = (id: string) => setOpen((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const set = (name: string, value: unknown) => setForm((f) => ({ ...f, [name]: value }));

  function submit() {
    if (!modal) return;
    const volume = n(form["Объём, кг"]);
    if (volume <= 0) { toast.error("Укажите объём в кг"); return; }
    if (modal.kind === "quotas") {
      if (!form["Квота"]) { toast.error("Укажите название квоты"); return; }
      onCreate("quotas", form, { ...form, "ЮрлицоId": form["Юрлицо"], "ТоварId": form["Товар"] });
    } else if (modal.kind === "licenses") {
      const q = data.quotas.find((x) => x.id === form["Квота"]); if (!q || !form["Лицензия"]) { toast.error("Укажите номер лицензии и квоту"); return; }
      const free = quotaTotals(q).notDistributed; if (volume > free) { toast.error(`В квоте не распределено только ${kg(free)}`); return; }
      onCreate("licenses", form, { ...form, "КвотаId": form["Квота"], "ТоварId": form["Товар"], "Заявлено, кг": 0, "Остаток, кг": volume });
    } else {
      const l = data.licenses.find((x) => x.id === form["Лицензия"]); if (!l || !form["Заявка"]) { toast.error("Укажите номер заявки и лицензию"); return; }
      const free = n(l["Объём, кг"]) - requestedOf(l); if (volume > free) { toast.error(`В лицензии осталось только ${kg(free)}`); return; }
      onCreate("requests", form, { ...form, "ЛицензияId": form["Лицензия"], "ПартияId": form["Партия"], "ТоварId": form["Товар"] });
    }
    setModal(null);
  }

  const all = quotas.map(quotaTotals);
  const total = { volume: quotas.reduce((s, q) => s + n(q["Объём, кг"]), 0), requested: all.reduce((s, t) => s + t.requested, 0) };
  return <>
    <div className="mb-5 grid gap-3 sm:grid-cols-3">{[
      { label: "Объём квот", value: total.volume, formula: "Σ «Объём, кг» всех квот", sub: `${quotas.length} квот = ${kg(total.volume)}` },
      { label: "Заявлено", value: total.requested, formula: "Σ «Объём, кг» всех заявок во всех лицензиях", sub: `${all.reduce((s, t) => s + t.ls.reduce((c, l) => c + requestsOf(l).length, 0), 0)} заявок = ${kg(total.requested)}` },
      { label: "Остаток по заявкам", value: total.volume - total.requested, formula: "Объём квот − заявлено", sub: `${kg(total.volume)} − ${kg(total.requested)} = ${kg(total.volume - total.requested)}` },
    ].map((t) => <div key={t.label} className={`${panel} p-4`}><div className="flex items-center justify-between gap-2 text-xs text-[#718278]">{t.label}<CalcInfo label={t.label} formula={t.formula} substitution={t.sub} source="Квоты, Лицензии, Заявки (Китай)" excel="В Excel квот нет — учёт по описанию клиента" /></div><div className="mt-3 text-lg font-semibold tabular-nums">{kg(t.value)}</div></div>)}</div>
    <div className="mb-3 flex justify-end"><Button size="sm" className="bg-[#147d6e] hover:bg-[#10675b]" disabled={busy} onClick={() => start("quotas")}><Plus size={15} /> Новая квота</Button></div>
    <div className="space-y-3">{quotas.map((q) => { const t = quotaTotals(q); const isOpen = open.has(q.id); return <div key={q.id} className={panel}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(q.id)}>{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<div className="min-w-0"><div className="truncate text-sm font-semibold">{text(q["Квота"])}</div><div className="text-xs text-[#7d8b83]">{labelOf(data.entities, q["ЮрлицоId"])} · {labelOf(data.products, q["ТоварId"])} · {text(q["Период"]) || "—"} · {t.ls.length} лицензий</div></div></button>
        <div className="grid w-full gap-1 text-xs sm:w-[420px]"><div className="flex justify-between"><span className="text-[#7d8b83]">Объём {kg(q["Объём, кг"])}</span><span className="inline-flex items-center gap-1">Заявлено {kg(t.requested)} · остаток <b className="tabular-nums">{kg(t.left)}</b><CalcInfo label="Остаток по заявкам" formula="Объём квоты − Σ заявок всех её лицензий" substitution={`${kg(q["Объём, кг"])} − ${kg(t.requested)} = ${kg(t.left)}`} source={`Квота ${text(q["Квота"])}`} excel="В Excel квот нет" /></span></div><Progress value={t.requested} max={n(q["Объём, кг"])} /><div className="flex justify-between text-[11px] text-[#8b998f]"><span>В лицензиях {kg(t.inLicenses)}</span><span className="inline-flex items-center gap-1">Не распределено {kg(t.notDistributed)}<CalcInfo label="Не распределено по лицензиям" formula="Объём квоты − Σ объёмов её лицензий" substitution={`${kg(q["Объём, кг"])} − ${kg(t.inLicenses)} = ${kg(t.notDistributed)}`} source={`Квота ${text(q["Квота"])}`} excel="В Excel квот нет" /></span></div></div>
        <Button size="sm" variant="outline" disabled={busy || t.notDistributed <= 0} onClick={() => start("licenses", q)}><Plus size={14} /> Лицензия</Button>
      </div>
      {isOpen && <div className="border-t bg-[#fafcfb] px-4 py-3">{t.ls.length ? <div className="grid gap-3 lg:grid-cols-2">{t.ls.map((l) => { const req = requestedOf(l); const left = n(l["Объём, кг"]) - req; return <div key={l.id} className={`${panel} p-3`}>
        <div className="mb-2 flex items-center justify-between gap-2"><div><div className="text-sm font-semibold">{text(l["Лицензия"])}</div><div className="text-[11px] text-[#8b998f]">{date(l["Дата"])} · {kg(l["Объём, кг"])} · {labelOf(data.products, l["ТоварId"])}</div></div><Button size="sm" variant="outline" disabled={busy || left <= 0} onClick={() => start("requests", l)}><Plus size={14} /> Заявка</Button></div>
        <div className="mb-1 flex justify-between text-xs"><span className="text-[#7d8b83]">Заявлено {kg(req)}</span><span className="inline-flex items-center gap-1">Остаток <b className="tabular-nums">{kg(left)}</b><CalcInfo label="Остаток лицензии" formula="Объём лицензии − Σ объёмов её заявок" substitution={`${kg(l["Объём, кг"])} − ${kg(req)} = ${kg(left)}`} source={`Лицензия ${text(l["Лицензия"])}`} excel="В Excel квот нет" /></span></div><Progress value={req} max={n(l["Объём, кг"])} tone="#5e9eb2" />
        {requestsOf(l).length > 0 && <table className="mt-3 w-full text-xs"><thead className="text-[#8b998f]"><tr><th className="py-1 text-left font-medium">Заявка</th><th className="py-1 text-left font-medium">Дата</th><th className="py-1 text-left font-medium">Товар</th><th className="py-1 text-right font-medium">Объём</th><th className="py-1 text-left font-medium pl-3">Партия</th><th className="py-1 text-left font-medium">Машина</th><th className="py-1 text-left font-medium">Статус</th></tr></thead><tbody>{requestsOf(l).map((r) => <tr key={r.id} className="border-t border-[#eef2ef]"><td className="py-1.5 font-medium">{text(r["Заявка"])}</td><td className="py-1.5 text-[#7d8b83]">{date(r["Дата"])}</td><td className="py-1.5 text-[#6e7e74]">{labelOf(data.products, r["ТоварId"])}</td><td className="py-1.5 text-right tabular-nums">{kg(r["Объём, кг"])}</td><td className="py-1.5 pl-3">{r["ПартияId"] ? labelOf(data.batches, r["ПартияId"], "Партия") : "—"}</td><td className="py-1.5 text-[#6e7e74]">{text(r["Номер машины"]) || "—"}</td><td className="py-1.5"><Badge variant="outline" className="text-[10px]">{text(r["Статус"]) || "—"}</Badge></td></tr>)}</tbody></table>}
      </div>; })}</div> : <div className="py-3 text-center text-xs text-[#86958b]">В квоте пока нет лицензий</div>}{text(q["Комментарий"]) && <div className="mt-3 text-[11px] text-[#8b998f]">{text(q["Комментарий"])}</div>}</div>}
    </div>; })}{!quotas.length && <div className={`${panel} p-8 text-center text-sm text-[#86958b]`}>Квот пока нет</div>}</div>

    <Dialog open={Boolean(modal)} onOpenChange={(v) => { if (!v) setModal(null); }}><DialogContent className="sm:max-w-[560px]"><DialogHeader><DialogTitle>{modal?.kind === "quotas" ? "Новая квота" : modal?.kind === "licenses" ? `Новая лицензия · ${text(modal.parent?.["Квота"])}` : `Новая заявка · ${text(modal?.parent?.["Лицензия"])}`}</DialogTitle><DialogDescription>{modal?.kind === "licenses" && modal.parent ? `Не распределено в квоте: ${kg(quotaTotals(modal.parent).notDistributed)}` : modal?.kind === "requests" && modal.parent ? `Остаток лицензии: ${kg(n(modal.parent["Объём, кг"]) - requestedOf(modal.parent))}` : "Объём в килограммах"}</DialogDescription></DialogHeader>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">{modal?.kind === "quotas" ? "Название квоты" : modal?.kind === "licenses" ? "Номер лицензии" : "Номер заявки"} *<input className={uiInput} value={text(form[modal?.kind === "quotas" ? "Квота" : modal?.kind === "licenses" ? "Лицензия" : "Заявка"])} onChange={(e) => set(modal?.kind === "quotas" ? "Квота" : modal?.kind === "licenses" ? "Лицензия" : "Заявка", e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Объём, кг *<input className={uiInput} type="number" min={0} step="any" value={text(form["Объём, кг"])} onChange={(e) => set("Объём, кг", e.target.value)} /></label>
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Дата<input className={uiInput} type="date" value={text(form["Дата"])} onChange={(e) => set("Дата", e.target.value)} /></label>
        {modal?.kind === "quotas" && <><label className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Период<input className={uiInput} value={text(form["Период"])} onChange={(e) => set("Период", e.target.value)} /></label><div className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Юрлицо<SearchSelect name="Юрлицо" value={form["Юрлицо"]} onChange={(v) => set("Юрлицо", v)} items={data.entities.map((x) => ({ value: x.id, title: text(x["Название"]) }))} /></div><div className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Товар<SearchSelect name="Товар" value={form["Товар"]} onChange={(v) => set("Товар", v)} items={data.products.map((x) => ({ value: x.id, title: text(x["Название"]) }))} /></div></>}
        {modal?.kind !== "quotas" && <div className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Вид товара<SearchSelect name="Вид товара" value={form["Товар"]} onChange={(v) => set("Товар", v)} items={data.products.map((x) => ({ value: x.id, title: text(x["Название"]) }))} /></div>}
        {modal?.kind === "requests" && <><label className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Номер машины<input className={uiInput} value={text(form["Номер машины"])} onChange={(e) => set("Номер машины", e.target.value)} /></label><div className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Партия<SearchSelect name="Партия" value={form["Партия"]} onChange={(v) => set("Партия", v)} items={data.batches.filter((x) => (!form["Товар"] || x["ТоварId"] === form["Товар"]) && (!form["Страна"] || x["Страна"] === form["Страна"])).map((x) => ({ value: x.id, title: text(x["Партия"]) }))} /></div><div className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Статус<SearchSelect name="Статус" required value={form["Статус"]} onChange={(v) => set("Статус", v)} items={["Открыта", "Исполнена", "Отменена"].map((v) => ({ value: v, title: v }))} /></div></>}
        <label className="flex flex-col gap-1.5 text-xs font-medium text-[#65746e] sm:col-span-2">Комментарий<textarea className={`${uiInput} min-h-16 py-2`} value={text(form["Комментарий"])} onChange={(e) => set("Комментарий", e.target.value)} /></label>
        <div className="flex justify-end gap-2 border-t pt-4 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setModal(null)}>Отмена</Button><Button type="submit" disabled={busy} className="bg-[#147d6e] hover:bg-[#10675b]">Сохранить</Button></div>
      </form>
    </DialogContent></Dialog>
  </>;
}
