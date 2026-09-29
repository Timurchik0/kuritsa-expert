import type { Dataset, Row } from "./actions";

export const amount = (value: unknown) => Number(value) || 0;
export const REPORT_RATE = "Курс $ для отчётов";
export const BANK_FEE = "Комиссия банка за перевод, %";
export const INTERNAL_TAX = "Внутренний НДС + НсП при продаже, %";
export const RUSSIA_VAT = "НДС на импорт РФ, %";
export const RUSSIA_SALES_TAX = "НсП РФ, %";

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
  const counterparts = clientsOwe + clientAdvances + partners + borrowers + others;
  const inTransit = data.batches.filter((row) => ["Предоплата", "В пути", "На таможне"].includes(String(row["Статус"])))
    .reduce((sum, row) => sum + amount(row["Аванс поставщику (в пути), сом"]), 0);
  const stock = data.products.reduce((sum, row) => sum + amount(row["Стоимость остатка, сом"]), 0);
  const turnover = accounts + counterparts + inTransit + stock;
  const loans = sumContacts("Займодавец");
  const capital = turnover + loans;
  const taxes = data.taxes.reduce((sum, row) => sum + amount(row["Остаток к уплате, сом"]), 0);
  const rate = setting(data, REPORT_RATE);
  const sold = data.batches.filter((row) => row["Статус"] === "Продана");
  const soldProfitSom = sold.reduce((sum, row) => sum + amount(row["Прибыль, сом"]), 0);
  const soldProfitUsd = sold.reduce((sum, row) => sum + amount(row["Прибыль, $"]), 0);
  const soldRevenue = sold.reduce((sum, row) => sum + amount(row["Выручка, сом"]), 0);
  return {
    accounts, clientsOwe, clientAdvances, partners, borrowers, others, counterparts,
    inTransit, stock, turnover, loans, capital, taxes, rate,
    turnoverUsd: rate && rate > 0 ? turnover / rate : null,
    capitalUsd: rate && rate > 0 ? capital / rate : null,
    realUsd: rate && rate > 0 ? (capital - taxes) / rate : null,
    soldProfitSom, soldProfitUsd,
    soldMargin: soldRevenue > 0 ? soldProfitSom / soldRevenue * 100 : 0,
    soldCount: sold.length,
  };
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
    ? russiaVat == null || russiaSalesTax == null ? null : kg * (rub * russiaVat / 100 + (rub * (1 + russiaVat / 100) + 2) * russiaSalesTax / 100)
    : internalTax == null ? null : sale * internalTax / 100 * kg;
  const cents = (value: number | null) => value == null ? null : Math.round((value + Number.EPSILON) * 100) / 100;
  return { commission: cents(commission), tax: cents(tax) };
}

export function kgPerBox(product: Row | undefined): number | null {
  const value = Number(product?.["Кг в коробке"]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
