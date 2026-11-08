"use client";
import { useMemo, useState } from "react";
import { looksLikeIsin, validateIsin } from "@/lib/analysis/isin";
import { api } from "@/lib/client/api";
import { actions } from "@/lib/store/store";
import type { ResolvedAsset } from "@/lib/types";

export function AddAsset() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ResolvedAsset[]>([]);

  const isinState = useMemo(() => {
    const s = q.trim();
    if (!s) return null;
    if (looksLikeIsin(s)) return validateIsin(s);
    // 12 Zeichen mit Ländercode, aber falsche Zeichen → vermutlich ISIN-Tippfehler
    if (/^[A-Za-z]{2}\w{10}$/.test(s) && /\d/.test(s)) return validateIsin(s);
    return null;
  }, [q]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    if (!s || (isinState && !isinState.valid)) return;
    setBusy(true);
    setError(null);
    setCandidates([]);
    try {
      const r = await api.resolve(s);
      if (r.candidates.length === 0) setError("Nichts gefunden. Prüfe ISIN oder Symbol (z. B. AAPL, SAP.DE, BTC).");
      else if (r.candidates.length === 1) {
        actions.addWatch(r.candidates[0]);
        setQ("");
      } else setCandidates(r.candidates);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choose = (c: ResolvedAsset) => {
    actions.addWatch(c);
    setCandidates([]);
    setQ("");
  };

  return (
    <div className="panel p-3">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <input
            className={`input ${isinState && !isinState.valid ? "border-red-500/70 focus:border-red-500" : isinState?.valid ? "border-emerald-500/60" : ""}`}
            placeholder="ISIN (z. B. US0378331005) oder Symbol (AAPL, SAP.DE, BTC, ETH)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setError(null);
            }}
            autoCapitalize="characters"
            spellCheck={false}
          />
          {isinState && !isinState.valid && <p className="mt-1 text-xs text-red-400">Ungültige ISIN: {isinState.reason}</p>}
          {isinState?.valid && <p className="mt-1 text-xs text-emerald-400">Gültige ISIN – Prüfziffer korrekt.</p>}
        </div>
        <button className="btn-primary sm:w-40" disabled={busy || !q.trim() || (isinState ? !isinState.valid : false)}>
          {busy ? "Suche …" : "Hinzufügen"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {candidates.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-stone-400">Mehrere Treffer – bitte wählen:</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {candidates.map((c) => (
              <li key={`${c.kind}:${c.symbol}`}>
                <button onClick={() => choose(c)} className="flex w-full items-center justify-between rounded-lg border border-gold/15 bg-black/40 px-3 py-2 text-left text-sm hover:border-gold/60">
                  <span>
                    <span className="font-semibold text-gold-light">{c.symbol}</span> <span className="text-stone-300">{c.name}</span>
                  </span>
                  <span className="text-xs text-stone-500">{c.kind === "crypto" ? "Krypto" : c.kind === "commodity" ? "Rohstoff" : c.exchange ?? "Aktie/ETF"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
