import { aiReport } from "@/lib/server/ai";
import { changeAccounts, saveAccount, validateAccount } from "@/lib/server/ai/accounts";

export async function GET(request: Request) {
  const days = Number(new URL(request.url).searchParams.get("days") || 30);
  if (![1, 7, 30, 90].includes(days))
    return Response.json({ error: "Choose 1, 7, 30 or 90 days." }, { status: 400 });
  try {
    return Response.json(await aiReport(days, new URL(request.url).searchParams.get("scope") === "limits"), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Could not load AI accounts. Check ai-accounts.json in Systo's data folder." },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return new Response("Forbidden", { status: 403 });
  if (Number(request.headers.get("content-length")) > 16000)
    return new Response("Too large", { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 16000) return new Response("Too large", { status: 413 });
    const body = JSON.parse(text);
    if (body.action === "remove" && typeof body.id === "string")
      await changeAccounts((accounts) => accounts.filter((a) => a.id !== body.id));
    else if (body.action === "save") {
      const account = validateAccount(body.account);
      await changeAccounts((accounts) => saveAccount(accounts, account));
    } else return Response.json({ error: "Invalid action." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save account." },
      { status: 400 },
    );
  }
}
