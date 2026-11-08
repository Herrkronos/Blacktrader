"use client";
import { useState } from "react";
import { IconInfo } from "./Icons";

/** Legende als Info-Symbol: je Badge eine Zeile. */
export function Legend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex h-11 w-11 items-center justify-center rounded-full text-stone-300 active:bg-white/10" aria-label="Legende anzeigen" aria-expanded={open}>
        <IconInfo className="h-6 w-6" />
      </button>
      {open && (
        <div className="card absolute right-0 top-full z-30 mt-1 w-72 space-y-2.5 p-4 text-[14px] text-stone-300">
          <div className="flex items-center gap-2">
            <span className="badge-trade">Trade</span> steigende Kurse, mit Stop und Ziel
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-short">Short</span> fallende Kurse, mit Stop und Ziel
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-core">Kernposition</span> langfristig halten
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-wait">wartet</span> Einstieg erst in der Zone
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-risk">Hohes Risiko</span> Stop sehr weit entfernt
          </div>
        </div>
      )}
    </div>
  );
}
