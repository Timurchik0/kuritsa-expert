import { NextResponse, type NextRequest } from "next/server";

// Password gate for the whole app (HTTP Basic Auth). Any username, password = APP_PASSWORD.
// If APP_PASSWORD is not set (local dev), the app stays open.
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given === password) return NextResponse.next();
  }
  return new NextResponse("Требуется вход", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Kuritsa Expert", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
