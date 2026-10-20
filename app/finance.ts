import type { Dataset, Row } from "./actions";

export const amount = (value: unknown) => Number(value) || 0;
export const REPORT_RATE = "Курс $ для отчётов";
export const BANK_FEE = "Комиссия банка за перевод, %";
export const INTERNAL_TAX = "Внутренний НДС + НсП при продаже, %";
export const RUSSIA_VAT = "НДС на импорт РФ, %";
export const RUSSIA_SALES_TAX = "НсП РФ, %";
export const RUSSIA_MARGIN = "Плановая маржа для НсП РФ, сом/кг";
export const RUSSIA_MARGIN_DEFAULT = 15;

export function setting(data: Dataset, parameter: string): number | null {
  const row = data.settings.find((item) => item["Параметр"] === parameter);
  return row && Number.isFinite(Number(row["Значение"])) ? Number(row["Значение"]) : null;
}

export function calculateSummary(data: Dataset) {
  const sumContacts = (type: string, test: (balance: number) => boolean = () => true) =>
    data.contacts.filter((row) => row["Тип"] === type && test(amount(row["Баланс"]))).reduce((sum, row) => sum + amount(row["Баланс"]), 0);
  const accounts = data.accounts.filter((row) => row["Учитывать в сводке"]).reduce((sum, row) => sum + amount(row["Остаток"]), 0);
  const clientsOwe = sumContacts("Клиент", (value) => value > 0);
  const clientAdvances = sumContacts("Клиент", (value) => value < 0);
  const partners = sumContacts("Партнёр");
  const borrowers = sumContacts("Заёмщик");
  const others = sumContacts("Прочее");
  // loans given (Заёмщик) belong to «Итого займов», like in the client's sheet; not to the counterparts
  const counterparts = clientsOwe + clientAdvances + partners + others;
  // goods paid but not received: the supplier's balance (opening prepayment + advances of its batches in transit)
  // plus advances of in-transit batches that have no supplier set
  const transitBatches = data.batches.filter((row) => ["Предоплата", "В пути", "На таможне"].includes(String(row["Статус"])));
  const unlinkedTransit = transitBatches.filter((row) => !row["ПоставщикId"]).reduce((sum, row) => sum + amount(row["Аванс поставщику (в пути), сом"]), 0);
  const suppliers = sumContacts("Поставщик");
  const inTransit = suppliers + unlinkedTransit;
  const stock = data.products.reduce((sum, row) => sum + amount(row["Стоимость остатка, сом"]), 0);
  const turnover = accounts + counterparts + inTransit + stock;
  const lenders = sumContacts("Займодавец");
  const loans = lenders + borrowers;
  const capital = turnover + loans;
  const taxes = data.taxes.reduce((sum, row) => sum + amount(row["Остаток к уплате, сом"]), 0);
  const rate = setting(data, REPORT_RATE);
  const sold = data.batches.filter((row) => row["Статус"] === "Продана");
  const soldProfitSom = sold.reduce((sum, row) => sum + amount(row["Прибыль, сом"]), 0);
  const soldProfitUsd = sold.reduce((sum, row) => sum + amount(row["Прибыль, $"]), 0);
  const soldRevenue = sold.reduce((sum, row) => sum + amount(row["Выручка, сом"]), 0);
  return {
    accounts, clientsOwe, clientAdvances, partners, borrowers, others, counterparts,
    inTransit, suppliers, unlinkedTransit, lenders, stock, turnover, loans, capital, taxes, rate,
    turnoverUsd: rate && rate > 0 ? turnover / rate : null,
    capitalUsd: rate && rate > 0 ? capital / rate : null,
    realUsd: rate && rate > 0 ? (capital - taxes) / rate : null,
    soldProfitSom, soldProfitUsd,
    soldMargin: soldRevenue > 0 ? soldProfitSom / soldRevenue * 100 : 0,
    soldCount: sold.length,
  };
}

/** Planned margin in the RF НсП base: the batch's own value, otherwise the default from the settings (15 сом/кг). */
export function russiaMargin(form: Record<string, unknown>, data: Dataset) {
  const own = form["Плановая маржа для НсП, сом/кг"];
  return own !== "" && own != null && Number.isFinite(Number(own)) ? Number(own) : setting(data, RUSSIA_MARGIN) ?? RUSSIA_MARGIN_DEFAULT;
}

export function supplierPaidSom(row: Record<string, unknown>) {
  return amount(row["Предоплата $"]) * amount(row["Курс предоплаты"]) + amount(row["Постоплата $"]) * amount(row["Курс постоплаты"]) + amount(row["Цена ₽/кг"]) * amount(row["Курс ₽→сом"]) * amount(row["Кг"]);
}

export function batchEstimates(form: Record<string, unknown>, data: Dataset) {
  const commissionRate = setting(data, BANK_FEE);
  const internalTax = setting(data, INTERNAL_TAX);
  const russiaVat = setting(data, RUSSIA_VAT);
  const russiaSalesTax = setting(data, RUSSIA_SALES_TAX);
  const commission = commissionRate == null ? null : amount(form["Постоплата $"]) * commissionRate / 100 * amount(form["Курс постоплаты"]);
  const kg = amount(form["Кг"]);
  const sale = amount(form["Цена продажи сом/кг"]);
  const rub = amount(form["Цена ₽/кг"]) * amount(form["Курс ₽→сом"]);
  const tax = form["Страна"] === "РФ"
    ? russiaVat == null || russiaSalesTax == null ? null : kg * (rub * russiaVat / 100 + (rub * (1 + russiaVat / 100) + amount(form["Логистика, сом/кг"]) + russiaMargin(form, data)) * russiaSalesTax / 100)
    : internalTax == null ? null : sale * internalTax / 100 * kg;
  const cents = (value: number | null) => value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
  return { commission: cents(commission), tax: cents(tax) };
}

export function kgPerBox(product: Row | undefined): number | null {
  const value = Number(product?.["Кг в коробке"]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ── balance at a date ──
const transitStatuses = ["Предоплата", "В пути", "На таможне"];
/** ГГГГ-ММ-ДД of a stored date in Bishkek time ("" if empty). */
export const localDay = (value: unknown) => value ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(value))) : "";

/**
 * The dataset as it stood at the end of `day` (ГГГГ-ММ-ДД): every balance is rebuilt from its opening value plus the
 * operations dated up to that day — accounts from payments, counterparties from shipments and payments, stock from
 * movements, the supplier advance from cash payments of batches that had not arrived yet. Taxes accrued after the day
 * are left out; operations without a date count as old history. Same field names as the live data, so the summary, drill-downs and snapshots work unchanged.
 */
export function datasetAsOf(data: Dataset, day: string): Dataset {
  // an operation without a date is old history (opening data): it belongs to every cut
  const upTo = (row: Row, key = "Дата") => { const d = localDay(row[key]); return !d || d <= day; };
  const moves = data.movements.filter((m) => upTo(m));
  const pays = data.payments.filter((p) => upTo(p));
  const sumBy = (rows: Row[], link: string, id: string, key: string) => rows.reduce((s, r) => r[link] === id ? s + amount(r[key]) : s, 0);
  const receipt = new Map<string, string>();
  for (const m of data.movements) if (m["Тип"] === "Приход" && m["ПартияId"]) {
    const d = localDay(m["Дата"]), id = String(m["ПартияId"]);
    if (d && (!receipt.has(id) || d < receipt.get(id)!)) receipt.set(id, d);
  }
  const batches = data.batches.map((b) => {
    const live = transitStatuses.includes(String(b["Статус"]));
    const arrived = receipt.get(b.id) ?? localDay(b["Дата прибытия"]);
    const inTransit = live || Boolean(arrived && arrived > day);
    return { ...b, "Статус": inTransit ? (live ? b["Статус"] : "В пути") : b["Статус"], "Аванс поставщику (в пути), сом": inTransit ? sumBy(pays, "ПартияId", b.id, "Оплата за партию, сом") : 0 };
  });
  const accounts = data.accounts.map((a) => {
    const turnover = sumBy(pays, "СчётId", a.id, "Движение по счёту");
    return { ...a, "Оборот по счёту": turnover, "Остаток": amount(a["Остаток на начало"]) + turnover };
  });
  const contacts = data.contacts.map((c) => {
    const shipped = sumBy(moves, "КонтрагентId", c.id, "Влияние на долг"), paid = sumBy(pays, "КонтрагентId", c.id, "Влияние на долг");
    const advances = batches.reduce((s, b) => b["ПоставщикId"] === c.id ? s + amount(b["Аванс поставщику (в пути), сом"]) : s, 0);
    const viaAccounts = sumBy(pays, "Держатель счётаId", c.id, "Влияние на долг держателя");
    return { ...c, "Отгрузки в долг": shipped, "Платежи в расчёт": paid, "Авансы за партии в пути": advances, "Через кассы (взаиморасчёт)": viaAccounts, "Баланс": amount(c["Сальдо на начало"]) + shipped + paid + advances + viaAccounts };
  });
  const products = data.products.map((p) => {
    const kg = sumBy(moves, "ТоварId", p.id, "Кг ±"), value = sumBy(moves, "ТоварId", p.id, "Склад ±, сом (по плановой цене)");
    return { ...p, "Остаток, кг": kg, "Остаток, коробок": sumBy(moves, "ТоварId", p.id, "Коробки ±"), "Склад по плановой цене, сом": value, "Стоимость остатка, сом": value, "Средняя плановая цена, сом/кг": kg > 0 ? value / kg : 0 };
  });
  const taxes = data.taxes.map((t) => upTo(t) ? t : { ...t, "Остаток к уплате, сом": 0 });
  return { ...data, accounts, contacts, products, batches, taxes, movements: moves, payments: pays };
}
