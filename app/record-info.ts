import type { Row } from "./actions";
import { amount } from "./finance";

const formatted = (value: unknown) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount(value));
const money = (value: unknown) => `${formatted(value)} сом`;
const total = (rows: Row[], key: string) => rows.reduce((sum, row) => sum + amount(row[key]), 0);

export function productInfo(row: Row, key: string, movements: Row[]) {
  const entries = movements.filter((movement) => movement["ТоварId"] === row.id);
  const receipts = entries.filter((entry) => entry["Тип"] === "Приход");
  const outgoings = entries.filter((entry) => entry["Тип"] !== "Приход");
  const kg = amount(row["Остаток, кг"]), cost = amount(row["Стоимость остатка, сом"]);
  const source = `Движения склада товара «${String(row["Название"])}», ${entries.length} записей`;
  const excel = "Складские листы Excel: D2 = Σ «итого» (кг × цена), колонка «цена» = плановая цена продажи";
  const details: Record<string, { formula: string; substitution: string }> = {
    "Остаток, кг": { formula: "Σ кг приходов − Σ кг отгрузок и списаний", substitution: `${formatted(total(receipts, "Кг"))} − ${formatted(total(outgoings, "Кг"))} = ${formatted(kg)} кг` },
    "Остаток, коробок": { formula: "Σ коробок приходов − Σ коробок отгрузок и списаний", substitution: `${formatted(total(receipts, "Коробки"))} − ${formatted(total(outgoings, "Коробки"))} = ${formatted(row[key])}` },
    "Стоимость остатка, сом": { formula: "Σ (±кг × плановая цена продажи строки)", substitution: `${money(total(entries, "Склад ±, сом (по плановой цене)"))} = ${money(cost)}` },
    "Средняя плановая цена, сом/кг": { formula: "Стоимость остатка по плановой цене ÷ кг (при кг > 0; иначе 0)", substitution: `${money(cost)} ÷ ${formatted(kg)} = ${money(row[key])}`, },
  };
  return { ...details[key], source, excel };
}

export function contactInfo(row: Row) {
  const initial = amount(row["Сальдо на начало"]), shipments = amount(row["Отгрузки в долг"]), payments = amount(row["Платежи в расчёт"]), advances = amount(row["Авансы за партии в пути"]);
  return { formula: "Сальдо на начало + отгрузки в долг − оплаты + выданные ему деньги + авансы за партии в пути", substitution: `${money(initial)} + ${money(shipments)} + (${money(payments)} — платежи с учётом знака) + ${money(advances)} = ${money(row["Баланс"])}`, source: `Контрагенты: ${String(row["Название"])}; движения, платежи и связанные партии`, excel: "Лист контрагента!H2" };
}

export function accountInfo(row: Row, payments: Row[]) {
  const entries = payments.filter((payment) => payment["СчётId"] === row.id);
  const receipts = entries.filter((payment) => payment["Направление"] === "Приход");
  const outgoings = entries.filter((payment) => payment["Направление"] !== "Приход");
  return { formula: "Остаток на начало + приходы − расходы", substitution: `${money(row["Остаток на начало"])} + ${money(total(receipts, "Сумма, сом"))} − ${money(total(outgoings, "Сумма, сом"))} = ${money(row["Остаток"])}`, source: `Счета: ${String(row["Название"])} и ${entries.length} платежей`, excel: "баланс денег!E5 (РС Эксперт), РС ФУДторг!H2; для других счетов адрес не указан" };
}

export function movementInfo(row: Row) {
  return { formula: "Кг × цена, сом/кг (или сумма вручную)", substitution: `${formatted(row["Кг"])} × ${money(row["Цена сом/кг"])} = ${money(row["Сумма, сом"])}`, source: `Движения склада: ${String(row["Тип"])} ${String(row["Дата"] ?? "")}`, excel: "Складские листы Excel: строка операции (адрес ячейки не указан)" };
}

export function deviationInfo(row: Row) {
  const kg = amount(row["Кг"]), fact = amount(row["Цена сом/кг"]), plan = amount(row["Цена плановая продажная, сом/кг"]);
  return { formula: "(фактическая цена продажи − плановая цена продажи) × кг", substitution: `(${money(fact)} − ${money(plan)}) × ${formatted(kg)} = ${money((fact - plan) * kg)}`, source: `Движения склада: отгрузка ${String(row["Дата"] ?? "")}`, excel: "Складской лист: колонка «разница» = (цена − реализация) × кг, с обратным знаком" };
}

export function paymentInfo(row: Row) {
  return { formula: "Сумма × курс валюты (для сом: курс 1)", substitution: `${formatted(row["Сумма"])} ${String(row["Валюта"] ?? "")} × ${formatted(row["Валюта"] === "сом" ? 1 : row["Курс"])} = ${money(row["Сумма, сом"])}`, source: `Платежи: ${String(row["Описание"] ?? row["Категория"] ?? "")}`, excel: "баланс денег / счёт: строка платежа (адрес ячейки не указан)" };
}
