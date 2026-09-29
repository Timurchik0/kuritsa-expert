// Regenerates schema/*.json from the Tablox base. Run: node scripts/sync-schema.mjs
// Reads TEABLE_API_URL / TEABLE_APP_TOKEN / TEABLE_BASE_ID from .env.local.
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { TEABLE_API_URL: url, TEABLE_APP_TOKEN: token, TEABLE_BASE_ID: base } = env;

// table name in the base -> schema file key used by the app
const KEYS = {
  "Товары": "products", "Счета": "accounts", "Контрагенты": "contacts", "Партии": "batches",
  "Движения склада": "movements", "Платежи": "payments", "Налоги": "taxes", "Сверки": "reconciliations",
  "Настройки": "settings", "Юрлица": "entities", "Квоты": "quotas", "Лицензии": "licenses", "Заявки": "requests",
};

const api = async (path) => {
  const r = await fetch(`${url}/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return r.json();
};

for (const t of await api(`/base/${base}/table`)) {
  const key = KEYS[t.name];
  if (!key) { console.warn("skip table", t.name); continue; }
  const fields = (await api(`/table/${t.id}/field`)).map((f) => ({
    id: f.id, name: f.name, dbFieldName: f.dbFieldName, type: f.type, description: f.description ?? null,
    options: ["singleSelect", "multipleSelect"].includes(f.type) ? (f.options?.choices ?? []).map((c) => c.name) : (f.options ?? {}),
    cellValueType: f.cellValueType, isLookup: f.isLookup ?? null, isComputed: f.isComputed ?? null,
    isMultipleCellValue: Boolean(f.isMultipleCellValue),
  }));
  writeFileSync(`schema/${key}.json`, JSON.stringify({ id: t.id, name: t.name, description: t.description ?? null, dbTableName: t.dbTableName, fields }, null, 2));
  console.log(key, t.id, fields.length);
}
