// "Auf vorherige Version zurücksetzen"
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { loadState, saveState } from "@/lib/trainer/server";
import { rollback, rollbackTo } from "@/lib/trainer/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  try {
    const s = await loadState();
    const body = (await req.json().catch(() => ({}))) as { to?: number };
    const prev = typeof body.to === "number" ? rollbackTo(s, body.to) : rollback(s);
    if (!prev) return NextResponse.json({ ok: false, note: "Diese Version gibt es nicht oder sie ist schon aktiv." }, { status: 400 });
    await saveState(s);
    return NextResponse.json({ ok: true, note: `Zurückgesetzt auf Version ${prev.id}`, current: prev.id });
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
