// Ergebnis einer Trainingssitzung im Browser: nur speichern, wenn auf unbekannten Daten besser
// UND alle Strenge-Regeln erfüllt sind. Der Server prüft Grenzen, Version und Regeln erneut.
import { NextResponse } from "next/server";
import { resolveParams, strictnessErrors, validateParams, DEFAULT_PARAMS, type LearnableParams } from "@/lib/analysis/params";
import { isAdmin } from "@/lib/trainer/auth";
import { decide, type Metrics } from "@/lib/trainer/engine";
import { applyResult } from "@/lib/trainer/job";
import { loadState, saveState } from "@/lib/trainer/server";
import { currentVersion } from "@/lib/trainer/state";
import { CELL_KEYS, type CellKey } from "@/lib/trainer/universe";
import { describeChanges } from "@/lib/trainer/walkforward";
import type { AssetKind, Horizon } from "@/lib/types";

export const dynamic = "force-dynamic";

const isMetrics = (m: unknown): m is Metrics =>
  !!m && typeof m === "object" && ["trades", "hitRate", "avgWin", "avgLoss", "profitFactor", "maxDrawdown", "perMonth"].every((k) => typeof (m as Record<string, unknown>)[k] === "number");

export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ ok: false, note: "Zugangscode fehlt oder falsch – Ergebnis nicht gespeichert" }, { status: 401 });
  try {
    const b = (await req.json()) as { cell?: string; baseParams?: Partial<LearnableParams>; base?: unknown; cand?: unknown; deployed?: Partial<LearnableParams> | null; series?: number };
    if (!CELL_KEYS.includes(b.cell as CellKey) || !isMetrics(b.base) || !isMetrics(b.cand)) return NextResponse.json({ ok: false, note: "Ungültige Daten" }, { status: 400 });
    const cell = b.cell as CellKey;
    const s = await loadState();
    const [kind, horizon] = cell.split(":") as [AssetKind, Horizon];
    const cur = resolveParams(currentVersion(s).params, kind, horizon);
    // Verglichen wurde gegen genau diesen Stand – hat er sich inzwischen geändert, gilt das Ergebnis nicht mehr
    if (JSON.stringify({ ...DEFAULT_PARAMS, ...(b.baseParams ?? {}) }) !== JSON.stringify(cur))
      return NextResponse.json({ ok: false, note: `Inzwischen gilt ein anderer Stand (Version ${s.current}) – Ergebnis verworfen, bitte neu trainieren` }, { status: 409 });
    const deployed: LearnableParams = b.deployed ? { ...DEFAULT_PARAMS, ...b.deployed } : cur;
    const d = decide(b.base, b.cand);
    const errs = [...validateParams(deployed), ...strictnessErrors(cur, deployed)];
    if (JSON.stringify(deployed) === JSON.stringify(cur)) errs.push("keine geänderten Werte");
    d.reasons.push(...errs);
    d.accept = d.reasons.length === 0;
    const msg = applyResult(s, cell, { base: b.base, cand: b.cand, decision: d, deployed, changes: describeChanges(cur, deployed), improved: d.accept }, "Browser-Training", Number(b.series) || 0);
    await saveState(s);
    return NextResponse.json({ ok: true, saved: d.accept, note: msg, current: s.current });
  } catch (e) {
    return NextResponse.json({ ok: false, note: (e as Error).message }, { status: 500 });
  }
}
