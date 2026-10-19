// Browser side of server-api.ts: a failed outcome becomes an Error with the server's (Russian) message.
import * as server from "./server-api";
import type { Outcome } from "./server-api";

async function unwrap<T>(call: Promise<Outcome<T>>): Promise<T> {
  const outcome = await call;
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome.value;
}

/** After a new deployment an open tab calls server actions that no longer exist: the page has to be reloaded. */
export const isStaleVersion = (error: unknown) => /Server Action|Failed to find|was not found on the server|deployment/i.test(error instanceof Error ? error.message : String(error));

export const loadTables = (...a: Parameters<typeof server.loadTables>) => unwrap(server.loadTables(...a));
export const loadAffected = (...a: Parameters<typeof server.loadAffected>) => unwrap(server.loadAffected(...a));
export const loadAudit = (...a: Parameters<typeof server.loadAudit>) => unwrap(server.loadAudit(...a));
export const saveRecord = (...a: Parameters<typeof server.saveRecord>) => unwrap(server.saveRecord(...a));
export const saveBatch = (...a: Parameters<typeof server.saveBatch>) => unwrap(server.saveBatch(...a));
export const createMovement = (...a: Parameters<typeof server.createMovement>) => unwrap(server.createMovement(...a));
export const updateMovement = (...a: Parameters<typeof server.updateMovement>) => unwrap(server.updateMovement(...a));
export const deleteEntity = (...a: Parameters<typeof server.deleteEntity>) => unwrap(server.deleteEntity(...a));
export const receiveBatch = (...a: Parameters<typeof server.receiveBatch>) => unwrap(server.receiveBatch(...a));
export const payTax = (...a: Parameters<typeof server.payTax>) => unwrap(server.payTax(...a));
export const saveSnapshot = (...a: Parameters<typeof server.saveSnapshot>) => unwrap(server.saveSnapshot(...a));
