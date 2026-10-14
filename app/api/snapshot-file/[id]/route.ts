import { snapshotAttachment } from "@/app/actions";

// Downloads a snapshot's source file with its real (Cyrillic) name; the storage link alone gives a percent-encoded one.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await snapshotAttachment(id).catch(() => null);
  if (!file) return new Response("Файл не найден", { status: 404 });
  const upstream = await fetch(file.url);
  if (!upstream.ok || !upstream.body) return new Response("Не удалось получить файл", { status: 502 });
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(upstream.body, { headers: {
    "Content-Type": file.mimetype,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "Cache-Control": "private, no-store",
  } });
}
