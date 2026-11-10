"use client";
// Depot: eine Karte je Wert für alle blauen Käufe (Erstkauf + Nachkäufe) – mit Verkaufen, Stop und Orders.
import { useState, type ReactNode } from "react";
import { money } from "@/lib/analysis/persona";
import { tradeCurrency } from "@/lib/client/eur";
import { heldShares, trancheRows } from "@/lib/client/longterm";
import { clearPositionStop, positionSummary, sellPosition, setPositionStop, updateWaitingOrder } from "@/lib/client/position";
import { eurPerUnit } from "@/lib/fx";
import type { Trade } from "@/lib/store/store";
import { ProposalBox } from "./ProposalBox";
import { Sheet } from "./Sheet";

const eur = (x: number, sign = false) => `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const qtyStr = (q: number) => q.toLocaleString("de-DE", { maximumFractionDigits: 4 });
const num = (s: string) => Number(s.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
const inputVal = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const KEST = 0.275;
const FEE = 7.9;

export function PositionCard({ group, price, onOpen, onAction, nachkauf }: { group: Trade[]; price?: number; onOpen: () => void; onAction: (t: Trade) => void; nachkauf?: ReactNode }) {
  const first = group[0];
  const fx = eurPerUnit(tradeCurrency(first)) ?? 1;
  const cur = tradeCurrency(first);
  const priceNow = price ?? first.lastPrice ?? null;
  const priceEur = priceNow != null ? priceNow * fx : null;
  const s = positionSummary(group, priceNow);
  const unit = first.kind === "crypto" ? first.symbol.replace(/-USD$/, "") : "Stück";
  const [showBuys, setShowBuys] = useState(true);
  const [sheet, setSheet] = useState<null | "sell" | "stop" | "orders">(null);
  const pending = group.every((t) => t.status === "pending");
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <article className="card edge-core relative p-4" onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-stone-50">
            {first.name} <span className="text-[14px] font-normal text-gold">›</span>
          </div>
          <div className="text-[13px] text-stone-400">{first.symbol} · Langfristig</div>
        </div>
        <div className="text-right">
          <div className={`num text-[19px] font-semibold ${s.pct == null ? "text-amber-300" : s.pct >= 0 ? "text-up" : "text-down"}`}>{s.pct == null ? "–" : `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(2).replace(".", ",")} %`}</div>
          <div className="text-[13px] text-stone-400">Stand gesamt</div>
        </div>
      </div>

      {group.map((t) => t.proposal && <ProposalBox key={`p${t.id}`} t={t} price={price} />)}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="badge-core">Langfristig</span>
        <span className={pending ? "badge-wait" : "badge-muted"}>{pending ? "wartend" : "offen"}</span>
        {group.length > 1 && <span className="badge-muted">{group.length} Käufe</span>}
      </div>

      <div className="num mt-2 grid grid-cols-3 gap-2 text-[14px]">
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <span className="label block">Gekauft</span>
          <span className="font-semibold text-stone-50">
            {qtyStr(group.reduce((a, t) => a + heldShares(t), 0))} {unit}
          </span>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <span className="label block">Investiert</span>
          <span className="font-semibold text-stone-50">{eur(s.invested)}</span>
        </div>
        <div className="rounded-xl bg-white/5 px-2 py-1.5">
          <span className="label block">Ø Einstieg</span>
          <span className="font-semibold text-stone-50">{s.avgEur != null ? eur(s.avgEur) : "–"}</span>
        </div>
      </div>
      <div className="num mt-2 flex flex-wrap justify-between gap-x-3 text-[14px]">
        <span>Kurs {priceEur != null ? <b>{eur(priceEur)}</b> : "–"}</span>
        {s.profit != null && <span className={s.profit >= 0 ? "text-up" : "text-down"}>{s.profit >= 0 ? "Gewinn" : "Verlust"} {eur(s.profit, true)}</span>}
        <span className="text-stone-400">{s.stop > 0 ? `Stop ${money(s.stop, cur)}` : s.invalidation && s.invalidation > 0 ? `Ungültig ${money(s.invalidation, cur)}` : "kein Stop"}</span>
      </div>

      {showBuys &&
        group.map((t, k) => {
          const rows = trancheRows(t);
          return (
            <div key={t.id} className="num mt-2 rounded-xl bg-sky-500/10 p-2.5 text-[13px] text-sky-100">
              <div className="mb-1 flex items-center justify-between font-semibold text-sky-300">
                <span>
                  {k === 0 && !t.nachkauf ? "Erstkauf" : `Nachkauf ${t.nachkauf ? group.slice(0, k + 1).filter((x) => x.nachkauf).length : k}`} · {eur(rows.reduce((a, x) => a + x.eur, 0))}
                </span>
                <span className="flex items-center gap-2 font-normal text-stone-400">
                  {new Date(t.openedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  <button
                    className="px-1 text-[16px] leading-none text-stone-300"
                    aria-label="Aktionen für diesen Kauf"
                    onClick={(e) => {
                      stop(e);
                      onAction(t);
                    }}
                  >
                    ⋯
                  </button>
                </span>
              </div>
              {rows.map((x, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2 py-0.5">
                  <span className="text-sky-300">Teil {i + 1}</span>
                  <span>
                    {money(x.price, cur)} · {qtyStr(x.qty)} {unit} · {eur(x.eur)}
                  </span>
                  <span className={x.filledAt ? "text-up" : "text-stone-400"}>{x.filledAt ? "✓ gekauft" : "wartet"}</span>
                </div>
              ))}
              {(t.partials ?? []).map((p, i) => (
                <p key={`v${i}`} className="text-stone-300">
                  Verkauft {Math.round(p.fraction * 100)} % bei {money(p.price, cur)} ({new Date(p.at).toLocaleDateString("de-DE")})
                </p>
              ))}
              {t.lastActionText && <p className="mt-1 text-sky-200">Letzte Meldung: {t.lastActionText}</p>}
            </div>
          );
        })}
      {s.reserved > 0 && (
        <div className="num mt-2 flex justify-between rounded-xl bg-white/5 px-2.5 py-2 text-[14px] text-stone-300">
          <span>Wartende Order (reserviert)</span>
          <span>{eur(s.reserved)}</span>
        </div>
      )}
      {nachkauf}

      <div className="mt-3 grid grid-cols-3 gap-2" onClick={stop}>
        <button className="btn min-h-[44px] border-gold/50 text-gold-light" disabled={s.shares <= 0} onClick={() => setSheet("sell")}>
          Verkaufen
        </button>
        <button className="btn min-h-[44px] border-gold/50 text-gold-light" disabled={s.shares <= 0} onClick={() => setSheet("stop")}>
          Stop
        </button>
        <button className="btn min-h-[44px] border-gold/50 text-gold-light" disabled={s.reserved <= 0} onClick={() => setSheet("orders")}>
          Orders
        </button>
      </div>
      <button
        className="mt-2 flex min-h-[40px] w-full items-center justify-between border-t border-white/10 pt-2 text-[14px] text-stone-400"
        onClick={(e) => {
          stop(e);
          setShowBuys(!showBuys);
        }}
      >
        <span>{showBuys ? "Käufe ausblenden" : "Käufe anzeigen"}</span>
        <span>{showBuys ? "▲" : "▼"}</span>
      </button>

      <div onClick={stop}>
        <Sheet open={sheet === "sell"} onClose={() => setSheet(null)} title={`${first.name} verkaufen`}>
          {sheet === "sell" && <SellForm group={group} priceEur={priceEur} avgEur={s.avgEur} shares={s.shares} reserved={s.reserved} unit={unit} crypto={first.kind === "crypto"} onDone={() => setSheet(null)} />}
        </Sheet>
        <Sheet open={sheet === "stop"} onClose={() => setSheet(null)} title={`Stop für ${qtyStr(group.reduce((a, t) => a + heldShares(t), 0))} ${unit}`}>
          {sheet === "stop" && <StopForm group={group} priceEur={priceEur} current={s.stop > 0 ? s.stop * fx : null} invalidationEur={s.invalidation && s.invalidation > 0 ? s.invalidation * fx : null} onDone={() => setSheet(null)} />}
        </Sheet>
        <Sheet open={sheet === "orders"} onClose={() => setSheet(null)} title="Wartende Kauf-Orders">
          {sheet === "orders" && <OrdersForm group={group} unit={unit} onDone={() => setSheet(null)} />}
        </Sheet>
      </div>
    </article>
  );
}

function SellForm({ group, priceEur, avgEur, shares, reserved, unit, crypto, onDone }: { group: Trade[]; priceEur: number | null; avgEur: number | null; shares: number; reserved: number; unit: string; crypto: boolean; onDone: () => void }) {
  const round = (q: number) => (crypto ? Math.floor(q * 1e4 + 1e-6) / 1e4 : Math.round(q));
  const [mode, setMode] = useState<"all" | "half" | "custom">("all");
  const [qty, setQty] = useState(inputVal(round(shares), crypto ? 4 : 0));
  const [px, setPx] = useState(priceEur != null ? inputVal(priceEur) : "");
  const [drop, setDrop] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const q = mode === "all" ? shares : num(qty);
  const p = num(px);
  const gain = avgEur != null && q > 0 && p > 0 ? q * (p - avgEur) : null;
  const kest = gain != null ? Math.max(0, gain) * KEST : null;
  const pick = (m: "all" | "half" | "custom") => {
    setMode(m);
    if (m === "all") setQty(inputVal(round(shares), crypto ? 4 : 0));
    if (m === "half") setQty(inputVal(round(shares / 2), crypto ? 4 : 0));
    setDrop(m === "all");
  };
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">
        Du hältst {qtyStr(round(shares))} {unit}
        {avgEur != null ? ` · Ø Einstieg ${eur(avgEur)}` : ""}
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["all", "Alles"],
            ["half", "Hälfte"],
            ["custom", "Stück wählen"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`min-h-[40px] rounded-lg text-[14px] ${mode === k ? "bg-gold font-semibold text-stone-950" : "bg-white/5 text-stone-300"}`} onClick={() => pick(k)}>
            {l}
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2">
        <span>Stück</span>
        <input className="input num w-32 text-right" inputMode="decimal" value={qty} disabled={mode === "all"} onChange={(e) => (setQty(e.target.value), setMode("custom"))} />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span>Verkauft zu (€ je Stück, von flatex)</span>
        <input className="input num w-32 text-right" inputMode="decimal" value={px} onChange={(e) => setPx(e.target.value)} />
      </label>
      {reserved > 0 && (
        <label className="flex items-center justify-between gap-2">
          <span>Wartende Kauf-Orders löschen ({eur(reserved)})</span>
          <input type="checkbox" className="h-6 w-6 accent-[#C9A24A]" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
        </label>
      )}
      {gain != null && (
        <div className="num space-y-0.5 rounded-xl bg-emerald-500/10 p-3 text-[14px] text-emerald-50">
          <div className="flex justify-between">
            <span>Erlös</span>
            <span>{eur(q * p)}</span>
          </div>
          <div className="flex justify-between">
            <span>Gewinn (zum Ø Einstieg)</span>
            <span>{eur(gain, true)}</span>
          </div>
          <div className="flex justify-between">
            <span>Gebühr</span>
            <span>{eur(-FEE)}</span>
          </div>
          <div className="flex justify-between">
            <span>KESt 27,5 %</span>
            <span>{eur(-(kest ?? 0))}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Netto</span>
            <span>{eur(gain - FEE - (kest ?? 0), true)}</span>
          </div>
          <p className="pt-1 text-[12px] text-stone-400">KESt geschätzt – Verluste im selben Jahr werden im Depot-Konto verrechnet.</p>
        </div>
      )}
      {msg && <p className="text-amber-300">{msg}</p>}
      <button
        className="btn-primary min-h-[48px] w-full"
        onClick={() => {
          const r = sellPosition(group, q, p, drop);
          if (/^(Verkauft|\d)/.test(r) || r.includes("verkauft")) onDone();
          else setMsg(r);
        }}
      >
        Bei flatex verkauft – buchen
      </button>
    </div>
  );
}

function StopForm({ group, priceEur, current, invalidationEur, onDone }: { group: Trade[]; priceEur: number | null; current: number | null; invalidationEur: number | null; onDone: () => void }) {
  const [v, setV] = useState(current != null ? inputVal(current) : "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">Bei flatex ein Stop-Loss für die ganze Position.</p>
      <label className="flex items-center justify-between gap-2">
        <span>Stop-Kurs (€)</span>
        <input className="input num w-32 text-right" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <p className="text-[13px] text-stone-400">
        Muss mindestens 0,5 % unter dem Kurs liegen{priceEur != null ? ` (jetzt ${eur(priceEur)})` : ""}.{invalidationEur != null ? ` Blacktraders Ungültig-Grenze: ${eur(invalidationEur)}.` : ""}
      </p>
      {msg && <p className="text-amber-300">{msg}</p>}
      <button
        className="btn-primary min-h-[48px] w-full"
        onClick={() => {
          const r = setPositionStop(group, num(v), priceEur);
          if (r) setMsg(r);
          else onDone();
        }}
      >
        Bei flatex gesetzt – speichern
      </button>
      {current != null && (
        <button
          className="btn min-h-[44px] w-full"
          onClick={() => {
            clearPositionStop(group);
            onDone();
          }}
        >
          Stop bei flatex gelöscht
        </button>
      )}
    </div>
  );
}

function OrdersForm({ group, unit, onDone }: { group: Trade[]; unit: string; onDone: () => void }) {
  const rows = group.flatMap((t) => {
    const fx = eurPerUnit(tradeCurrency(t)) ?? 1;
    return trancheRows(t)
      .map((x, i) => ({ t, i, x, fx }))
      .filter((r) => !r.x.filledAt);
  });
  return (
    <div className="space-y-3 text-[15px]">
      <p className="text-stone-400">Preis oder Stück ändern oder löschen – das reservierte Geld passt sich an. Erst bei flatex ändern, dann hier speichern.</p>
      {rows.map((r) => (
        <OrderRow key={`${r.t.id}:${r.i}`} t={r.t} index={r.i} priceEur={r.x.price * r.fx} qty={r.x.qty} unit={unit} onSaved={() => rows.length <= 1 && onDone()} />
      ))}
      {!rows.length && <p className="text-stone-400">Keine wartenden Orders.</p>}
    </div>
  );
}

function OrderRow({ t, index, priceEur, qty, unit, onSaved }: { t: Trade; index: number; priceEur: number; qty: number; unit: string; onSaved: () => void }) {
  const [p, setP] = useState(inputVal(priceEur));
  const [q, setQ] = useState(inputVal(qty, t.kind === "crypto" ? 4 : 0));
  const [msg, setMsg] = useState<string | null>(null);
  const save = (del = false) => {
    const r = updateWaitingOrder(t, index, num(p), del ? 0 : num(q));
    setMsg(r ?? (del ? "Gelöscht." : "Gespeichert."));
    if (!r) onSaved();
  };
  return (
    <div className="space-y-2 rounded-xl bg-white/5 p-3">
      <div className="text-[14px] text-sky-300">
        {t.nachkauf ? "Nachkauf" : "Erstkauf"} · Teil {index + 1}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[13px] text-stone-400">
          Limit (€)
          <input className="input num mt-1 w-full text-right" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} />
        </label>
        <label className="text-[13px] text-stone-400">
          {unit}
          <input className="input num mt-1 w-full text-right" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="num text-[13px] text-stone-400">= {eur(num(p) * num(q) || 0)} reserviert</div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary min-h-[44px]" onClick={() => save(false)}>
          Bei flatex geändert
        </button>
        <button className="btn min-h-[44px]" onClick={() => save(true)}>
          Bei flatex gelöscht
        </button>
      </div>
      {msg && <p className="text-[13px] text-stone-300">{msg}</p>}
    </div>
  );
}
