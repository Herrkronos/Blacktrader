"use client";
// Live-Bilanz aller Chancen (ab dem ersten Erscheinen mitgeschrieben – auch nicht übernommene).
import { useState } from "react";
import { chanceStats } from "@/lib/client/chanceLog";
import { useAppData } from "@/lib/store/store";

export function ChanceRecord() {
  const log = useAppData((d) => d.chanceLog);
  const [open, setOpen] = useState(false);
  const s = chanceStats(log);
  if (!s.total) return null;
  const rate = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)} %`);
  return (
    <button className="card w-full p-3 text-left" onClick={() => setOpen(!open)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-stone-300">
          Live-Bilanz seit {s.since ? new Date(s.since * 1000).toLocaleDateString("de-DE") : "–"}
        </span>
        <span className="num text-[15px] font-semibold text-gold-light">Treffer {rate(s.hitRate)}</span>
      </div>
      <div className="num mt-0.5 text-[13px] text-stone-400">
        {s.total} Chancen · <span className="text-emerald-300">{s.ziel} Ziel</span> · <span className="text-red-300">{s.stop} Stop</span> · {s.verpasst} verpasst · {s.open} laufen
      </div>
      {open && (
        <div className="mt-2 space-y-0.5 text-[13px] text-stone-300">
          {(["gruen", "blau", "rot"] as const).map((c) => {
            const x = chanceStats(log, c);
            return x.total ? (
              <div key={c} className="num flex justify-between">
                <span>{c === "gruen" ? "Grün" : c === "blau" ? "Blau" : "Rot"}: {x.total} · {x.ziel} Ziel · {x.stop} Stop · {x.verpasst} verpasst · {x.open} laufen</span>
                <span>{rate(x.hitRate)}</span>
              </div>
            ) : null;
          })}
          <p className="pt-1 text-stone-500">Jede Chance wird ab dem ersten Erscheinen mitgeschrieben – auch wenn du sie nicht übernimmst. Treffer = Ziel erreicht nach dem Einstieg, gegen Stop (Blau: Schlusskurs unter der Ungültig-Grenze). Verpasst = Ziel ohne Einstieg. Ausgewertet wird bei jeder Suche, also wenn du die App öffnest.</p>
        </div>
      )}
    </button>
  );
}
