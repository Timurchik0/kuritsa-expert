"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkLogin, createSession } from "@/lib/auth";

export async function login(formData: FormData) {
  const user = checkLogin(String(formData.get("login") ?? ""), String(formData.get("password") ?? ""));
  const next = String(formData.get("next") ?? "/");
  if (!user) redirect(`/login?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  const session = await createSession(user);
  (await cookies()).set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
