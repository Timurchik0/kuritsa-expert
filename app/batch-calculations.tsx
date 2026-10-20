"use client";

import { CalcInfo } from "./calc-info";
import { amount, supplierPaidSom } from "./finance";

const formatted = (value: unknown, digits = 2) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(amount(value));
const som = (value: unknown) => `${formatted(value)} сом`;
const usd = (value: unknown) => `${formatted(value)} $`;
const keys = ["Стоимость товара, $", "Оплачено поставщику, сом", "Себестоимость итого, сом", "Себестоимость 1 кг, сом", "Выручка, сом", "Прибыль, сом", "Прибыль, $", "Маржа, %"];

/** Not a base field: the batch's share of its supplier's earlier prepayment (see prepaidShares), passed along for the hints */
export const PREPAID = "Из сальдо поставщика, сом";

export function batchDetail(key: string, row: Record<string, unknown>) {
  const kg = amount(row["Кг"]), paid = amount(row["Оплачено поставщику, сом"]), cost = amount(row["Себестоимость итого, сом"]);
  const revenue = amount(row["Выручка, сом"]), profit = amount(row["Прибыль, сом"]), rate = amount(row["Курс $ для отчёта"]);
  const input = (name: string) => formatted(row[name]);
  const prepaid = amount(row[PREPAID]);
  const info: Record<string, { formula: string; substitution: string; excel: string }> = {
    "Стоимость товара, $": { formula: "Кг × цена $/кг", substitution: `${formatted(kg)} × ${input("Цена $/кг")} = ${usd(row[key])}`, excel: "Китай/РФ: стоимость партии (адрес ячейки не указан)" },
    "Оплачено поставщику, сом": { formula: "Предоплата $ × курс предоплаты + постоплата $ × курс постоплаты; для РФ: цена ₽/кг × курс ₽→сом × кг", substitution: `${input("Предоплата $")} × ${input("Курс предоплаты")} + ${input("Постоплата $")} × ${input("Курс постоплаты")} + ${input("Цена ₽/кг")} × ${input("Курс ₽→сом")} × ${formatted(kg)} = ${som(row[key])}`, excel: "Китай/РФ: оплата поставщику (адрес ячейки не указан)" },
    "Долг поставщику, $": { formula: "Для Китая: стоимость товара $ − предоплата $ − постоплата $; для РФ: 0", substitution: `${usd(row["Стоимость товара, $"])} − ${usd(row["Предоплата $"])} − ${usd(row["Постоплата $"])}; ${String(row["Страна"] ?? "Китай")} = ${usd(row[key])}`, excel: "Китай/РФ: долг поставщику (адрес ячейки не указан)" },
    "Оплачено по кассе, сом": { formula: "Сумма платежей «Оплата поставщику» (расход) из кассы, привязанных к этой партии. Предоплата и постоплата в карточке — это план, на деньги не влияют", substitution: `${som(row[key])}`, excel: "Касса: платежи по партии" },
    "Осталось оплатить, сом": prepaid
      ? { formula: "Оплата поставщику по плану − оплачено по кассе − предоплата из сальдо поставщика", substitution: `${som(paid)} − ${som(row["Оплачено по кассе, сом"])} − ${som(prepaid)} = ${som(row[key])}`, excel: "—" }
      : { formula: "Оплата поставщику по плану − оплачено по кассе", substitution: `${som(paid)} − ${som(row["Оплачено по кассе, сом"])} = ${som(row[key])}`, excel: "—" },
    "Аванс поставщику (в пути), сом": prepaid
      ? { formula: "Пока партия в пути: оплачено по кассе + предоплата поставщику до начала учёта (его сальдо), распределённая по его партиям в пути с самой ранней. На сводку не влияет — эти деньги уже в балансе поставщика", substitution: `${row["Статус"] ?? "—"}: ${som(row["Оплачено по кассе, сом"])} + ${som(prepaid)} = ${som(row[key])}`, excel: "баланс денег!F5, Китай!T2 + РФ!K2" }
      : { formula: "Оплачено по кассе, пока партия в пути (Предоплата / В пути / На таможне); после приёмки на склад — 0", substitution: `${row["Статус"] ?? "—"}: ${som(row["Оплачено по кассе, сом"])} → ${som(row[key])}`, excel: "баланс денег!F5, Китай!T2 + РФ!K2" },
    "Себестоимость итого, сом": { formula: "Оплачено + комиссия + банковские расходы + пошлина + НДС и НсП + прочие по таможне + выгрузка/логистика", substitution: `${som(paid)} + ${som(row["Комиссия за перевод"])} + ${som(row["Банковские расходы"])} + ${som(row["Таможенная пошлина"])} + ${som(row["НДС и НсП"])} + ${som(row["Прочие по таможне"])} + ${som(row["Выгрузка / логистика"])} = ${som(row[key])}`, excel: "Китай/РФ!Z (для соответствующей партии)" },
    "Себестоимость 1 кг, сом": { formula: "Себестоимость итого ÷ кг", substitution: `${som(cost)} ÷ ${formatted(kg)} = ${som(row[key])}`, excel: "Китай/РФ!AA (для соответствующей партии)" },
    "Выручка, сом": { formula: "Кг × цена продажи, сом/кг", substitution: `${formatted(kg)} × ${som(row["Цена продажи сом/кг"])} = ${som(row[key])}`, excel: "Китай/РФ!AE (для соответствующей партии)" },
    "Прибыль, сом": { formula: "Выручка − себестоимость итого", substitution: `${som(revenue)} − ${som(cost)} = ${som(row[key])}`, excel: "Китай/РФ!AG (для соответствующей партии)" },
    "Прибыль, $": { formula: "Прибыль, сом ÷ курс $ для отчёта", substitution: `${som(profit)} ÷ ${formatted(rate)} = ${usd(row[key])}`, excel: "Китай/РФ!AH (для соответствующей партии)" },
    "Маржа, %": { formula: "Прибыль ÷ выручка × 100%", substitution: `${som(profit)} ÷ ${som(revenue)} × 100 = ${formatted(row[key])}%`, excel: "расчет прибыли: средняя маржа (адрес ячейки не указан)" },
  };
  return { ...info[key], source: `Партии: ${String(row["Номер партии"] ?? "новая партия")}` };
}

// recalculated from the form on every keystroke, the same formulas as the base (and the Excel sheet)
export function BatchCalculations({ form, paidByCash = 0, prepaid = 0 }: { form: Record<string, unknown>; paidByCash?: number; prepaid?: number }) {
  const value = (() => {
    const paid = supplierPaidSom(form), kg = amount(form["Кг"]), cost = paid + ["Комиссия за перевод", "Банковские расходы", "Таможенная пошлина", "НДС и НсП", "Прочие по таможне", "Выгрузка / логистика"].reduce((sum, key) => sum + amount(form[key]), 0);
    const revenue = kg * amount(form["Цена продажи сом/кг"]), profit = revenue - cost, rate = amount(form["Курс $ для отчёта"]);
    const value = { ...form, "Стоимость товара, $": kg * amount(form["Цена $/кг"]), "Оплачено поставщику, сом": paid, "Себестоимость итого, сом": cost, "Себестоимость 1 кг, сом": kg ? cost / kg : 0, "Выручка, сом": revenue, "Прибыль, сом": profit, "Прибыль, $": rate ? profit / rate : 0, "Маржа, %": revenue ? profit / revenue * 100 : 0 };
    return { ...value, "Долг поставщику, $": form["Страна"] === "РФ" ? 0 : amount(value["Стоимость товара, $"]) - amount(form["Предоплата $"]) - amount(form["Постоплата $"]), "Оплачено по кассе, сом": paidByCash, [PREPAID]: prepaid, "Осталось оплатить, сом": paid - paidByCash - prepaid, "Аванс поставщику (в пути), сом": ["Предоплата", "В пути", "На таможне"].includes(String(form["Статус"])) ? paidByCash + prepaid : 0 };
  })();
  return <aside className="h-fit rounded border border-[#dce7df] bg-[#f7faf7] p-4"><h3 className="mb-4 text-sm font-semibold">Расчёт партии</h3><div className="mb-3 text-xs text-[#718278]">Обновляется при вводе</div>{["Долг поставщику, $", "Оплачено по кассе, сом", "Осталось оплатить, сом", "Аванс поставщику (в пути), сом", ...keys].map((key) => {
    const missingInputs = ((["Долг поставщику, $", "Стоимость товара, $"].includes(key) && !amount(form["Цена $/кг"]) && form["Страна"] !== "РФ") || (["Себестоимость 1 кг, сом", "Выручка, сом", "Прибыль, сом", "Прибыль, $", "Маржа, %"].includes(key) && !amount(form["Кг"])) || (["Выручка, сом", "Прибыль, сом", "Прибыль, $", "Маржа, %"].includes(key) && !amount(form["Цена продажи сом/кг"])) || (key === "Прибыль, $" && !amount(form["Курс $ для отчёта"])));
    return <div key={key} className="flex items-start justify-between gap-2 border-b border-[#e5ece7] py-2 text-xs last:border-0"><span className="min-w-0 text-[#738378]">{key === "Оплачено поставщику, сом" ? "Оплата поставщику по плану, сом" : key}</span><span className="flex shrink-0 items-center gap-1 text-right font-semibold tabular-nums">{missingInputs ? "—" : key.includes("$") ? usd(value[key]) : key.includes("%") ? `${formatted(value[key])}%` : som(value[key])}<CalcInfo label={key} {...batchDetail(key, value)} /></span></div>;
  })}</aside>;
}
