import { cookies } from "next/headers";
import { SESSION_COOKIE, authEnabled, readSession } from "./auth";

/** Who is making the current request: the signed-in user, «локально» without auth, «система» outside a request (scripts). */
export async function currentUser(): Promise<string> {
  if (!authEnabled()) return "локально";
  try { return await readSession((await cookies()).get(SESSION_COOKIE)?.value) ?? "неизвестно"; }
  catch { return "система"; }
}
