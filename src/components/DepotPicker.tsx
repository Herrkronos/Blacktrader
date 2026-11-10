"use client";
// flatex-Depot wählen (der Nutzer hat mehrere getrennte Depots). Die Wahl wird als Vorauswahl gemerkt.
import { actions, useAppData } from "@/lib/store/store";

export function DepotPicker({ value, onChange, label = "In welchem flatex-Depot kaufst du?" }: { value?: number; onChange?: (d: number) => void; label?: string }) {
  const names = useAppData((d) => d.settings.depotNames);
  const last = useAppData((d) => d.settings.lastDepot);
  const cur = value ?? last;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n, i) => (
          <button
            key={i}
            type="button"
            className={`chip min-h-[38px] ${cur === i + 1 ? "border-gold bg-gold font-semibold text-stone-950" : "border-white/15 text-stone-300"}`}
            onClick={() => {
              if (onChange) onChange(i + 1);
              else actions.setSettings({ lastDepot: i + 1 });
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kleines Depot-Schild */
export function DepotBadge({ depot }: { depot?: number }) {
  const names = useAppData((d) => d.settings.depotNames);
  if (!depot) return null;
  return <span className="ml-1.5 inline-block rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold-light">{names[depot - 1] ?? `Depot ${depot}`}</span>;
}
