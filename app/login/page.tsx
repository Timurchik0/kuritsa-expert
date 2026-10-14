import { Package } from "lucide-react";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const users = Boolean(process.env.APP_USERS);
  const input = "h-10 w-full rounded border border-[#dbe2df] bg-white px-3 text-sm text-[#22332f] outline-none focus:border-[#178779] focus:ring-2 focus:ring-[#178779]/10";
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f9f8] px-4">
    <form action={login} className="w-full max-w-sm rounded-md border border-[#e1e7e4] bg-white p-6 shadow-[0_1px_3px_rgba(20,50,30,.05)]">
      <div className="mb-6 flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded bg-[#147d6e] text-white"><Package size={18} /></span><div><div className="font-semibold text-[#1b3029]">Курица — Эксперт</div><div className="text-xs text-[#77847e]">Вход в систему</div></div></div>
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="mb-3 flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">{users ? "Логин" : "Ваше имя"}<input name="login" required={users} autoComplete="username" className={input} placeholder={users ? "Например, Наргиза" : "Как подписывать ваши изменения"} /></label>
      <label className="mb-4 flex flex-col gap-1.5 text-xs font-medium text-[#65746e]">Пароль<input name="password" type="password" required autoComplete="current-password" className={input} /></label>
      {error && <div className="mb-4 rounded border border-[#efc9c2] bg-[#fdf3f1] px-3 py-2 text-xs text-[#a14b3d]">Неверный логин или пароль</div>}
      <button type="submit" className="h-10 w-full rounded bg-[#147d6e] text-sm font-medium text-white hover:bg-[#10675b]">Войти</button>
    </form>
  </main>;
}
