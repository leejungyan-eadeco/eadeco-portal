// A parking run's Excel file or step screenshot. Sign-in is checked by src/proxy.ts like every page.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PARKING_DIR } from "@/lib/parking";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = path.resolve(PARKING_DIR, ...(await params).path);
  if (!file.startsWith(PARKING_DIR + path.sep)) return new Response("Not found", { status: 404 });
  const body = await readFile(file).catch(() => null);
  if (!body) return new Response("This file is no longer kept (screenshots are kept for 30 days).", { status: 404 });
  const xlsx = file.endsWith(".xlsx");
  const type = xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".zip") ? "application/zip" : "image/png";
  return new Response(body, {
    headers: {
      "Content-Type": type,
      ...(xlsx ? { "Content-Disposition": `attachment; filename="${path.basename(file)}"` } : {}),
    },
  });
}
