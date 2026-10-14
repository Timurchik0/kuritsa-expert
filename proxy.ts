import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, readSession } from "./lib/auth";

// Every page needs a signed-in user (see lib/auth.ts); without APP_USERS / APP_PASSWORD (local dev) the app stays open.
export async function proxy(request: NextRequest) {
  if (!authEnabled() || request.nextUrl.pathname === "/login") return NextResponse.next();
  if (await readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
