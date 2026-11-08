// "Auf vorherige Version zurücksetzen"
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/trainer/auth";
import { loadState, saveState } from "@/lib/trainer/server";
import { rollback } from "@/lib/trainer/state";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch" }, { status: 401 });
  try {
    const s = await loadState();
    const prev = rollback(s);
    if (!prev) return NextResponse.json({ ok: false, note: "Es gibt keine ältere Version." }, { status: 400 });
    await saveState(s);
    return NextResponse.json({ ok: true, note: `Zurückgesetzt auf Version ${prev.id}`, current: prev.id });
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
