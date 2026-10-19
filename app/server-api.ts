"use server";

// Server actions called by the browser. In a production build Next.js hides the message of an error thrown in a
// server action, so each action returns its outcome instead and the browser shows our message (see client-api.ts).
import * as actions from "./actions";

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

function readable(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const api = /^Teable API Error \[(\d+)\]/.exec(text);
  if (api || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(text)) console.error("Ошибка обращения к базе:", text);
  if (!api) return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(text) ? "Нет связи с базой данных — повторите попытку через минуту" : text;
  if (api[1] === "401" || api[1] === "403") return "Нет доступа к базе данных (истёк или отозван токен Tablox) — сообщите администратору";
  if (api[1] === "429") return "База данных перегружена запросами — повторите через несколько секунд";
  if (api[1] === "404") return "Запись не найдена — возможно, её уже удалили. Обновите страницу";
  return `База данных ответила ошибкой (код ${api[1]}). Повторите попытку; если повторяется — сообщите администратору`;
}
async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try { return { ok: true, value: await run() }; }
  catch (error) { return { ok: false, error: readable(error) }; }
}

export async function loadTables(...a: Parameters<typeof actions.loadTables>) { return attempt(() => actions.loadTables(...a)); }
export async function loadAffected(...a: Parameters<typeof actions.loadAffected>) { return attempt(() => actions.loadAffected(...a)); }
export async function loadAudit(...a: Parameters<typeof actions.loadAudit>) { return attempt(() => actions.loadAudit(...a)); }
export async function saveRecord(...a: Parameters<typeof actions.saveRecord>) { return attempt(() => actions.saveRecord(...a)); }
export async function saveBatch(...a: Parameters<typeof actions.saveBatch>) { return attempt(() => actions.saveBatch(...a)); }
export async function createMovement(...a: Parameters<typeof actions.createMovement>) { return attempt(() => actions.createMovement(...a)); }
export async function updateMovement(...a: Parameters<typeof actions.updateMovement>) { return attempt(() => actions.updateMovement(...a)); }
export async function deleteEntity(...a: Parameters<typeof actions.deleteEntity>) { return attempt(() => actions.deleteEntity(...a)); }
export async function receiveBatch(...a: Parameters<typeof actions.receiveBatch>) { return attempt(() => actions.receiveBatch(...a)); }
export async function payTax(...a: Parameters<typeof actions.payTax>) { return attempt(() => actions.payTax(...a)); }
export async function saveSnapshot(...a: Parameters<typeof actions.saveSnapshot>) { return attempt(() => actions.saveSnapshot(...a)); }
