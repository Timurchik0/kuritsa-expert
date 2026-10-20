"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { Dataset, Row } from "./actions";
import { PeriodInputs, date, dateInput, fmt, labelOf, n, panel, som, text } from "./ui-kit";

type Cell = { boxes: number; kg: number; sum: number };
type Line = { key: string; day: string; title: string; cells: Map<string, Cell>; total: number };

const today = () => dateInput(new Date().toISOString());
const add = (cells: Map<string, Cell>, product: string, boxes: number, kg: number, sum: number) => {
  const c = cells.get(product) ?? { boxes: 0, kg: 0, sum: 0 };
  cells.set(product, { boxes: c.boxes + boxes, kg: c.kg + kg, sum: c.sum + sum });
};

/**
 * The warehouse sheet of the Excel day files for a day or a period: one column group per product (boxes / kg / price),
 * opening stock, receipts, a line per customer and day with its shipments and their sum, totals and closing stock.
 */
export default function WarehouseReport({ data }: { data: Dataset }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const oneDay = from && from === to;

  const report = useMemo(() => {
    const moves = data.movements.filter((m) => m["ТоварId"] && (n(m["Кг"]) || n(m["Коробки"])));
    const day = (m: Row) => dateInput(m["Дата"]);
    // undated operations are old history: they count in the opening stock
    const before = moves.filter((m) => from && (!m["Дата"] || day(m) < from));
    const inside = moves.filter((m) => m["Дата"] && (!from || day(m) >= from) && (!to || day(m) <= to));
    const opening = new Map<string, Cell>();
    for (const m of before) add(opening, String(m["ТоварId"]), n(m["Коробки ±"]), n(m["Кг ±"]), 0);
    const receipts = new Map<string, Cell>();
    for (const m of inside.filter((m) => m["Тип"] === "Приход")) add(receipts, String(m["ТоварId"]), n(m["Коробки"]), n(m["Кг"]), n(m["Сумма, сом"]));
    const lines = new Map<string, Line>();
    for (const m of inside.filter((m) => m["Тип"] !== "Приход")) {
      const title = m["Тип"] === "Отгрузка" ? labelOf(data.contacts, m["КонтрагентId"]) : `${text(m["Тип"])}${m["Комментарий"] ? ` · ${text(m["Комментарий"])}` : ""}`;
      const key = `${day(m)}|${title}`;
      const line = lines.get(key) ?? { key, day: day(m), title, cells: new Map(), total: 0 };
      add(line.cells, String(m["ТоварId"]), n(m["Коробки"]), n(m["Кг"]), n(m["Сумма, сом"]));
      line.total += n(m["Сумма, сом"]);
      lines.set(key, line);
    }
    const shipped = new Map<string, Cell>();
    for (const line of lines.values()) for (const [p, c] of line.cells) add(shipped, p, c.boxes, c.kg, c.sum);
    const closing = new Map<string, Cell>();
    for (const p of data.products) {
      const o = opening.get(p.id), r = receipts.get(p.id), s = shipped.get(p.id);
      closing.set(p.id, { boxes: n(o?.boxes) + n(r?.boxes) - n(s?.boxes), kg: n(o?.kg) + n(r?.kg) - n(s?.kg), sum: 0 });
    }
    // products with stock or movement in the period, in the order of the products list (alphabetical)
    const products = [...data.products].sort((a, b) => text(a["Название"]).localeCompare(text(b["Название"]), "ru"))
      .filter((p) => [opening, receipts, shipped, closing].some((m) => Math.abs(n(m.get(p.id)?.kg)) > 0.005 || Math.abs(n(m.get(p.id)?.boxes)) > 0.005));
    const sorted = [...lines.values()].sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title, "ru"));
    return { opening, receipts, shipped, closing, products, lines: sorted, total: sorted.reduce((s, l) => s + l.total, 0) };
  }, [data, from, to]);

  const price = (c?: Cell) => c && c.kg ? c.sum / c.kg : 0;
  const rows: { title: string; day?: string; cells: Map<string, Cell>; total?: number; withPrice?: boolean; strong?: boolean; tone?: string }[] = [
    { title: from ? `Остаток на начало ${date(from)}` : "Остаток на начало", cells: report.opening, strong: true, tone: "bg-[#f7faf8]" },
    { title: "Приход", cells: report.receipts, tone: "bg-[#f2f8f4]" },
    ...report.lines.map((l) => ({ title: l.title, day: l.day, cells: l.cells, total: l.total, withPrice: true })),
    { title: "Итого отгрузка", cells: report.shipped, total: report.total, withPrice: true, strong: true, tone: "bg-[#f7faf8]" },
    { title: to ? `Остаток на конец ${date(to)}` : "Остаток на конец", cells: report.closing, strong: true, tone: "bg-[#eef6f1]" },
  ];

  // an .xlsx laid out like the client's warehouse sheet: product name over «коробка / кг», a narrow blue «Цена» column,
  // the opening stock in red, a «Приход» line, a line per customer with its sum on the right, totals and closing stock
  const [saving, setSaving] = useState(false);
  const download = async () => {
    setSaving(true);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet(oneDay ? date(from) : "Склад", { views: [{ state: "frozen", xSplit: oneDay ? 1 : 2, ySplit: 2 }] });
      const lead = oneDay ? 1 : 2, sumCol = lead + report.products.length * 3 + 1;
      const thin = { style: "thin" as const, color: { argb: "FF9E9E9E" } };
      const blue = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDCE6F1" } };
      const green = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEAF4EC" } };
      const at = (row: number, col: number) => sheet.getCell(row, col);
      const value = (v: number) => Math.abs(v) > 0.005 ? Math.round(v * 100) / 100 : null;

      at(1, 1).value = oneDay ? date(from) : `${date(from)} — ${date(to)}`;
      at(1, 1).font = { bold: true, size: 11 }; at(1, 1).alignment = { horizontal: "center", vertical: "middle" };
      at(1, 1).border = { top: { style: "medium", color: { argb: "FF8E7CC3" } }, left: { style: "medium", color: { argb: "FF8E7CC3" } }, bottom: { style: "medium", color: { argb: "FF8E7CC3" } }, right: { style: "medium", color: { argb: "FF8E7CC3" } } };
      at(2, 1).value = "Остатки на начало"; at(2, 1).font = { bold: true };
      if (!oneDay) { at(2, 2).value = "Дата"; at(2, 2).font = { bold: true }; }
      report.products.forEach((p, i) => {
        const col = lead + 1 + i * 3;
        sheet.mergeCells(1, col, 1, col + 1);
        at(1, col).value = text(p["Название"]);
        at(1, col).font = { bold: true, italic: true, size: 13 }; at(1, col).alignment = { horizontal: "center", vertical: "middle" };
        at(1, col + 2).value = "Цена"; at(1, col + 2).font = { size: 8 }; at(1, col + 2).alignment = { horizontal: "center" };
        at(2, col).value = "коробка"; at(2, col + 1).value = "кг";
        for (const c of [col, col + 1]) { at(2, c).font = { bold: true, size: 9 }; at(2, c).alignment = { horizontal: "center" }; }
        sheet.getColumn(col).width = 9; sheet.getColumn(col + 1).width = 9; sheet.getColumn(col + 2).width = 7;
      });
      sheet.getColumn(1).width = 26; if (!oneDay) sheet.getColumn(2).width = 11; sheet.getColumn(sumCol).width = 16;
      sheet.getRow(1).height = 24;

      const lines: { title: string; day?: string; cells: Map<string, Cell>; total?: number; withPrice?: boolean; kind: "opening" | "receipt" | "line" | "total" | "closing" }[] = [
        { title: "", cells: report.opening, kind: "opening" },
        { title: "Приход", cells: report.receipts, kind: "receipt" },
        ...report.lines.map((l) => ({ title: l.title, day: l.day, cells: l.cells, total: l.total, withPrice: true, kind: "line" as const })),
        { title: "Итого отгрузка", cells: report.shipped, total: report.total, withPrice: true, kind: "total" },
        { title: `Остаток на конец ${date(to || today())}`, cells: report.closing, kind: "closing" },
      ];
      lines.forEach((l, i) => {
        const r = 3 + i;
        at(r, 1).value = l.title;
        if (!oneDay && l.day) at(r, 2).value = date(l.day);
        report.products.forEach((p, j) => {
          const col = lead + 1 + j * 3, c = l.cells.get(p.id);
          at(r, col).value = value(n(c?.boxes)); at(r, col + 1).value = value(n(c?.kg));
          if (l.withPrice && c?.kg) at(r, col + 2).value = value(c.sum / c.kg);
          at(r, col).numFmt = "# ##0.##"; at(r, col + 1).numFmt = "# ##0.##"; at(r, col + 2).numFmt = "0.##";
        });
        if (l.total) { at(r, sumCol).value = value(l.total); at(r, sumCol).numFmt = "# ##0.00"; at(r, sumCol).font = { bold: true }; }
        const row = sheet.getRow(r);
        if (l.kind === "opening") row.eachCell({ includeEmpty: true }, (cell, col) => { if (col > lead && col < sumCol) cell.font = { bold: true, color: { argb: "FFFF0000" } }; });
        if (l.kind === "receipt") at(r, 1).font = { bold: true };
      });

      // grid, blue price columns, centred numbers
      const last = 2 + lines.length;
      for (let r = 1; r <= last; r++) for (let col = 1; col <= sumCol; col++) {
        const cell = at(r, col);
        if (!(r === 1 && col === 1)) cell.border = { top: thin, left: thin, bottom: thin, right: thin };
        if (col > lead && col < sumCol && (col - lead) % 3 === 0) cell.fill = blue;
        if (r > 2 && col > lead && col < sumCol) cell.alignment = { horizontal: "center" };
      }
      // «Итого отгрузка» and the closing stock: bold on a light green band
      for (const r of [last - 1, last]) for (let col = 1; col <= sumCol; col++) { at(r, col).font = { bold: true }; at(r, col).fill = green; }
      for (let r = 3; r <= last; r++) at(r, 1).alignment = { indent: 1 };

      const buffer = await book.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = `Склад ${oneDay ? date(from) : `${date(from)} — ${date(to)}`}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } finally { setSaving(false); }
  };

  const cellCls = "border-b border-r border-[#eef2ef] px-2 py-1.5 text-right tabular-nums whitespace-nowrap";
  return <>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <PeriodInputs title="Период" from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <button type="button" className="rounded border border-[#dbe2df] bg-white px-2.5 py-1.5 text-xs text-[#4f6158] hover:bg-[#f3f7f5]" onClick={() => { setFrom(today()); setTo(today()); }}>Сегодня</button>
      <button type="button" className="inline-flex items-center gap-1.5 rounded border border-[#bcd9ce] bg-white px-2.5 py-1.5 text-xs font-medium text-[#167561] hover:bg-[#eff8f3] disabled:opacity-50" disabled={!report.products.length || saving} onClick={() => void download()}><Download size={14} /> {saving ? "Готовлю файл…" : "Скачать Excel"}</button>
    </div>
    {!report.products.length ? <div className={`${panel} p-8 text-center text-sm text-[#86958b]`}>Нет остатков и движений за выбранный период</div> :
    <div className={`${panel} max-h-[70vh] overflow-auto`}><table className="min-w-full border-separate border-spacing-0 text-xs">
      <thead className="sticky top-0 z-10 bg-[#fbfcfb]">
        <tr><th rowSpan={2} className="sticky left-0 z-20 min-w-[170px] border-b border-r border-[#e3e9e5] bg-[#fbfcfb] px-3 py-2 text-left font-semibold">{oneDay ? date(from) : `${date(from)} — ${date(to)}`}</th>
          {report.products.map((p) => <th key={p.id} colSpan={3} className="border-b border-r border-[#e3e9e5] px-2 py-1.5 text-center font-semibold">{text(p["Название"])}</th>)}
          <th rowSpan={2} className="border-b border-[#e3e9e5] px-3 py-2 text-right font-semibold">Сумма</th></tr>
        <tr>{report.products.flatMap((p) => [<th key={`${p.id}b`} className="border-b border-r border-[#eef2ef] px-2 py-1 text-right font-normal text-[#7d8b81]">коробка</th>, <th key={`${p.id}k`} className="border-b border-r border-[#eef2ef] px-2 py-1 text-right font-normal text-[#7d8b81]">кг</th>, <th key={`${p.id}p`} className="border-b border-r border-[#e3e9e5] bg-[#eef4f8] px-2 py-1 text-right font-normal text-[#7d8b81]">цена</th>])}</tr>
      </thead>
      <tbody>{rows.map((r, i) => <tr key={`${r.title}${r.day ?? ""}${i}`} className={r.tone ?? "hover:bg-[#f8fbf9]"}>
        <td className={`sticky left-0 z-[5] border-b border-r border-[#e3e9e5] px-3 py-1.5 ${r.tone ?? "bg-white"} ${r.strong ? "font-semibold" : ""}`}>{r.title}{!oneDay && r.day && <span className="ml-1.5 text-[10px] text-[#8b998f]">{date(r.day)}</span>}</td>
        {report.products.flatMap((p) => { const c = r.cells.get(p.id); const neg = (v: number) => v < -0.005 ? "text-[#b9584c]" : ""; return [
          <td key={`${p.id}b`} className={`${cellCls} ${neg(n(c?.boxes))} ${r.strong ? "font-semibold" : ""}`}>{c && Math.abs(c.boxes) > 0.005 ? fmt(c.boxes, 1) : ""}</td>,
          <td key={`${p.id}k`} className={`${cellCls} ${neg(n(c?.kg))} ${r.strong ? "font-semibold" : ""}`}>{c && Math.abs(c.kg) > 0.005 ? fmt(c.kg, 2) : ""}</td>,
          <td key={`${p.id}p`} className={`${cellCls} border-r-[#e3e9e5] bg-[#f4f8fb]/60`}>{r.withPrice && price(c) ? fmt(price(c), 2) : ""}</td>]; })}
        <td className={`border-b border-[#eef2ef] px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${r.strong ? "font-semibold" : ""}`}>{r.total ? som(r.total, 2) : ""}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="mt-2 text-[11px] text-[#8b998f]">Остаток на начало — все движения до первого дня периода (операции без даты считаются старыми). Цена в строке клиента — средняя за кг по его отгрузкам за день; «Сумма» — сумма отгрузок. Нажмите на запись в «Журнале движений», чтобы исправить.</p>
  </>;
}
