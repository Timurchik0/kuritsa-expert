"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { loadAudit, type AuditRow } from "./actions";
import { Pager, PeriodInputs, SearchSelect, inPeriod, panel, td, th } from "./ui-kit";

const PAGE = 50;
const when = (value: string) => value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const tone: Record<string, string> = { "Создание": "text-[#228166]", "Изменение": "text-[#a0773f]", "Удаление": "text-[#b45c50]" };

function useAudit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(async () => {
    try { setRows(await loadAudit()); setError(false); } catch { setError(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { rows, error, reload };
}

/** Section «Журнал»: who created, changed or deleted what through the app, and when. */
export default function AuditView() {
  const { rows, error, reload } = useAudit();
  const [user, setUser] = useState("");
  const [section, setSection] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  if (error && !rows) return <div className={`${panel} p-8 text-center text-sm text-[#86958b]`}>Не удалось загрузить журнал. <button className="underline" onClick={() => void reload()}>Повторить</button></div>;
  if (!rows) return <div className={`${panel} p-8 text-center text-sm text-[#86958b]`}>Загрузка журнала…</div>;
  const q = search.toLocaleLowerCase("ru");
  const list = rows.filter((r) => (!user || r.user === user) && (!section || r.section === section) && (!action || r.action === action) && inPeriod(r.time, from, to)
    && (!q || `${r.title} ${r.changes}`.toLocaleLowerCase("ru").includes(q)));
  const options = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")).map((v) => ({ value: v, title: v }));
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(0); };
  return <>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] flex-1 md:max-w-xs"><Search size={16} className="absolute left-3 top-2.5 text-[#95a39a]" /><Input className="pl-9" placeholder="Поиск: запись, изменения" value={search} onChange={(e) => reset(setSearch)(e.target.value)} /></div>
      <SearchSelect name="Пользователь" value={user} onChange={reset(setUser)} items={options(rows.map((r) => r.user))} placeholder="Все пользователи" className="w-44" />
      <SearchSelect name="Раздел" value={section} onChange={reset(setSection)} items={options(rows.map((r) => r.section))} placeholder="Все разделы" className="w-44" />
      <SearchSelect name="Действие" value={action} onChange={reset(setAction)} items={options(["Создание", "Изменение", "Удаление"])} placeholder="Все действия" className="w-36" />
      <PeriodInputs from={from} to={to} onFrom={reset(setFrom)} onTo={reset(setTo)} />
      <button className="flex h-9 items-center gap-1.5 rounded border border-[#dce4e0] bg-white px-3 text-xs text-[#5d7166] hover:bg-[#f0f6f2]" onClick={() => void reload()}><RefreshCw size={14} /> Обновить</button>
    </div>
    <div className={`${panel} overflow-x-auto`}><table className="w-full min-w-[980px]"><thead className="border-b bg-[#fbfcfb]"><tr>{["Когда", "Кто", "Действие", "Раздел", "Запись", "Что изменилось"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>{list.slice(page * PAGE, (page + 1) * PAGE).map((r) => <tr key={r.id} className="border-b align-top last:border-0">
        <td className={`${td} whitespace-nowrap text-[#7d8b81]`}>{when(r.time)}</td>
        <td className={`${td} whitespace-nowrap font-medium`}>{r.user || "—"}</td>
        <td className={td}><Badge variant="outline" className={tone[r.action] ?? ""}>{r.action}</Badge></td>
        <td className={`${td} whitespace-nowrap text-[#6e7e74]`}>{r.section}</td>
        <td className={`${td} max-w-[220px]`}>{r.title}</td>
        <td className={`${td} whitespace-pre-line text-xs text-[#4f6158]`}>{r.changes || "—"}</td>
      </tr>)}</tbody></table>{!list.length && <div className="p-8 text-center text-sm text-[#86958b]">{rows.length ? "Нет записей по фильтрам" : "Журнал пока пуст: здесь появятся все изменения, сделанные в приложении"}</div>}</div>
    <Pager page={page} size={PAGE} total={list.length} onPage={setPage} />
  </>;
}

/** Compact «кто и когда» history of one record (used in record cards). */
export function RecordHistory({ recordId }: { recordId: string }) {
  const { rows } = useAudit();
  const own = (rows ?? []).filter((r) => r.recordId === recordId);
  if (!rows) return <div className="text-xs text-[#9aa79f]">История загружается…</div>;
  if (!own.length) return <div className="text-xs text-[#9aa79f]">Изменений через приложение пока не было</div>;
  return <ul className="space-y-2 text-xs">{own.slice(0, 8).map((r) => <li key={r.id}><div className="text-[#4f6158]"><b>{r.user || "—"}</b> · {r.action.toLocaleLowerCase("ru")} · {when(r.time)}</div>{r.action === "Изменение" && <div className="whitespace-pre-line text-[11px] text-[#8b998f]">{r.changes}</div>}</li>)}</ul>;
}

