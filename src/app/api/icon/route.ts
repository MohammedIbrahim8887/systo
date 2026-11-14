import { bundleIcon } from "@/lib/server/bundle";
import { exeIcon } from "@/lib/server/win/apps";

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  let png: Buffer | null;
  if (process.platform === "win32") {
    if (!/^[A-Za-z]:\\.+\.exe$/i.test(path)) return new Response(null, { status: 400 });
    png = await exeIcon(path);
  } else {
    if (!path.startsWith("/") || !path.endsWith(".app")) return new Response(null, { status: 400 });
    png = await bundleIcon(path);
  }
  if (!png) return new Response(null, { status: 404, headers: { "cache-control": "max-age=300" } });
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=86400, immutable" },
  });
}
