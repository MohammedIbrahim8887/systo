/**
 * A second path for shell commands (see lib/client/shell.ts). The desktop shell and this server
 * share one process, so the command is handed straight to the handler desktop.ts registers.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { command?: unknown; nonce?: unknown };
  const deliver = (globalThis as { __systoShellCommand?: (url: string) => void }).__systoShellCommand;
  if (!deliver || typeof body.nonce !== "string" || !body.command || typeof body.command !== "object") {
    return Response.json({ ok: false });
  }
  deliver(`#systo=${encodeURIComponent(JSON.stringify(body.command))}&n=${encodeURIComponent(body.nonce)}`);
  return Response.json({ ok: true });
}
