// Login for the app: users come from APP_USERS («Имя=пароль,Имя2=пароль2»); without it APP_PASSWORD lets anyone in
// under the name they type (the demo). A session is a signed cookie, so the server knows who made each change.
// Runs in the proxy and in server code (Web Crypto only).

export const SESSION_COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

export const authEnabled = () => Boolean(process.env.APP_USERS || process.env.APP_PASSWORD);

function accounts(): { name: string; password: string }[] {
  return (process.env.APP_USERS ?? "").split(",").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const at = pair.indexOf("=");
    return { name: pair.slice(0, at).trim(), password: pair.slice(at + 1).trim() };
  }).filter((a) => a.name && a.password);
}

/** The user's display name if the login and password are right, otherwise null. */
export function checkLogin(login: string, password: string): string | null {
  const name = login.trim();
  const list = accounts();
  if (list.length) return list.find((a) => a.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru") && a.password === password)?.name ?? null;
  if (process.env.APP_PASSWORD && password === process.env.APP_PASSWORD) return name || "Гость";
  return null;
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function signature(payload: string) {
  const secret = process.env.AUTH_SECRET || process.env.TEABLE_APP_TOKEN || "";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function createSession(user: string) {
  const payload = `${toBase64Url(encoder.encode(user))}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return { value: `${payload}.${await signature(payload)}`, maxAge: MAX_AGE };
}

/** The user name from a session cookie, or null if it is missing, forged or expired. */
export async function readSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [user, expires, given] = parts;
  if (Number(expires) * 1000 < Date.now()) return null;
  if (given !== await signature(`${user}.${expires}`)) return null;
  try {
    const name = new TextDecoder().decode(fromBase64Url(user));
    // a user removed from APP_USERS loses access even with an old cookie
    const list = accounts();
    return !list.length || list.some((a) => a.name === name) ? name : null;
  } catch { return null; }
}
