// Stand des Trainers für die Anzeige unter "Mehr → Trainer".
import { handle } from "@/lib/data/route-helpers";
import { LOCKED } from "@/lib/analysis/locked-config";
import { adminRequired } from "@/lib/trainer/auth";
import { MIN_SIGNALS_VALID, TARGET_HIT_RATE } from "@/lib/trainer/engine";
import { loadSignals, loadState } from "@/lib/trainer/server";
import { liveMetrics } from "@/lib/trainer/signals";
import { storageKind } from "@/lib/trainer/storage";
import { CELL_KEYS } from "@/lib/trainer/universe";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async () => {
    const [s, signals] = await Promise.all([loadState(), loadSignals()]);
    const job = s.job
      ? s.job.type === "train"
        ? { type: "train", cell: s.job.cell, phase: s.job.phase, done: s.job.results.flat().filter(Boolean).length, total: s.job.results.flat().length, startedAt: s.job.startedAt }
        : { type: "final", version: s.job.version, done: Object.values(s.job.results).flat().filter(Boolean).length, total: Object.values(s.job.results).flat().length, startedAt: s.job.startedAt }
      : null;
    return {
      storage: storageKind(),
      adminRequired: adminRequired(),
      target: TARGET_HIT_RATE,
      minSignals: MIN_SIGNALS_VALID,
      locked: { weights: LOCKED.weights, minRiskReward: LOCKED.minRiskReward },
      current: s.current,
      versions: s.versions.map((v) => ({ id: v.id, createdAt: v.createdAt, reason: v.reason, parent: v.parent, params: v.params })),
      cells: CELL_KEYS.map((c) => ({ cell: c, status: s.cells[c] ?? null })),
      live: liveMetrics(signals),
      signals: { total: signals.length, recent: signals.slice(-30).reverse() },
      log: s.log.slice(0, 150),
      history: s.history,
      finalTests: s.finalTests,
      job,
      lastRun: s.lastRun,
      lastRunNote: s.lastRunNote,
    };
  });
}
