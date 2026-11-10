// Blacktrader-Konto im Depot: echtes Geld-Modell statt „jeder Trade mit dem ganzen Geld“.
// 8.000 € Start, 500 € je Trade (echter Betrag aus Stück × Kurs, bis 50 € darüber), 7,90 € Gebühr je Order (flatex), 27,5 % KESt sofort bei Gewinn mit Verlustausgleich
// im selben Kalenderjahr. Langfrist-Trades (blau): 500 € gesamt, jede ausgeführte Teil-Order kostet eine Gebühr.
// Reicht das Geld nicht für einen neuen Trade (500 € + Gebühr), wird nichts übernommen. Ohne Geld UND ohne offene
// Position ist das Konto leer (pleite) – Neustart mit 8.000 €; alte Trades bleiben als frühere Runde sichtbar.
import type { Trade } from "../store/store";

export const ACCOUNT = { start: 8000, stake: 500, fee: 7.9, tax: 0.275 } as const;

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
/** Eingesetzter Betrag eines Trades (Stück × Kurs beim Übernehmen; ältere Trades: 500 €) */
export const stakeOf = (t: Pick<Trade, "stakeEur">) => (t.stakeEur && t.stakeEur > 0 ? t.stakeEur : ACCOUNT.stake);

/** Gehört der Trade zum Konto? (übernommen; verfallene Orders ohne Ausführung zählen nicht) */
export function countsForAccount(t: Trade): boolean {
  if (t.strategy === "core") return false;
  if (t.status === "closed" && t.closeReason === "cancelled" && t.returnPct == null) return false;
  return true;
}

/** Anzahl Kauf-Orders (Langfrist: ausgeführte Teile, mindestens 1) */
const buyOrders = (t: Trade) => (t.strategy === "longterm" ? Math.max(1, (t.tranches ?? []).filter((x) => x.filledAt).length) : 1);
/** Anzahl Verkaufs-Orders (Teilausstiege + Schlussverkauf) */
const sellOrders = (t: Trade) => (t.partials?.length ?? 0) + 1;

export interface RoundSummary {
  round: number;
  from: number;
  to?: number;
  start: number;
  /** Kontostand (frei + offene Positionen zum aktuellen Kurs) */
  equity: number;
  cash: number;
  /** In offenen Positionen bzw. wartenden Orders gebunden (Einsatz) */
  invested: number;
  profit: number;
  profitPct: number;
  fees: number;
  tax: number;
  closed: number;
  wins: number;
  open: number;
  /** Kein Geld für einen neuen Trade (500 € + Gebühr) */
  blocked: boolean;
  /** Kein Geld und keine offene Position mehr */
  broke: boolean;
  /** Verlauf nach jedem geschlossenen Trade: Gewinn in % vom Start */
  curve: { time: number; equity: number; cumulative: number }[];
}

/**
 * Rechnet eine Runde des Kontos durch. `openReturnEur(t)` liefert die aktuelle Rendite offener Trades in Euro (oder null).
 */
export function computeRound(trades: Trade[], from: number, to: number | undefined, round: number, openReturnEur: (t: Trade) => number | null): RoundSummary {
  const inRound = trades.filter((t) => countsForAccount(t) && t.openedAt >= from && (to == null || t.openedAt < to));
  type Ev = { at: number; kind: 0 | 1; t: Trade };
  const ev: Ev[] = [];
  for (const t of inRound) {
    ev.push({ at: t.openedAt, kind: 1, t });
    if (t.status === "closed" && t.closedAt != null) ev.push({ at: t.closedAt, kind: 0, t });
  }
  ev.sort((a, b) => a.at - b.at || a.kind - b.kind);
  let cash: number = ACCOUNT.start;
  let fees = 0;
  let tax = 0;
  let paid = 0;
  let year = yearOf(from);
  let closed = 0;
  let wins = 0;
  const open = new Set<Trade>();
  const curve: RoundSummary["curve"] = [];
  for (const e of ev) {
    const t = e.t;
    if (e.kind === 1) {
      // Wartende Orders reservieren das Geld schon (wie bei der Bank); Gebühr erst bei Ausführung
      const executed = t.status !== "pending";
      const f = executed ? buyOrders(t) * ACCOUNT.fee : 0;
      cash -= stakeOf(t) + f;
      fees += f;
      open.add(t);
      continue;
    }
    if (!open.has(t)) continue;
    open.delete(t);
    if (yearOf(e.at) !== year) {
      year = yearOf(e.at);
      paid = 0;
    }
    const r = t.returnPct ?? 0;
    const st = stakeOf(t);
    const g = (st * r) / 100;
    const f = sellOrders(t) * ACCOUNT.fee;
    cash += st + g - f;
    fees += f;
    // KESt auf den Kursgewinn (Spesen in Österreich nicht abzugsfähig), Verlustausgleich im selben Jahr
    if (g > 0) {
      const k = g * ACCOUNT.tax;
      cash -= k;
      tax += k;
      paid += k;
    } else if (g < 0 && paid > 0) {
      const back = Math.min(paid, -g * ACCOUNT.tax);
      cash += back;
      tax -= back;
      paid -= back;
    }
    closed++;
    if (g - (buyOrders(t) + sellOrders(t)) * ACCOUNT.fee > 0) wins++;
    curve.push({ time: e.at, equity: cash, cumulative: ((cash + [...open].reduce((a, x) => a + stakeOf(x), 0) - ACCOUNT.start) / ACCOUNT.start) * 100 });
  }
  let openValue = 0;
  for (const t of open) {
    const r = t.status === "open" ? openReturnEur(t) : null;
    openValue += stakeOf(t) * (1 + (r ?? 0) / 100);
  }
  const equity = cash + openValue;
  const invested = [...open].reduce((a, x) => a + stakeOf(x), 0);
  const blocked = cash < ACCOUNT.stake + ACCOUNT.fee;
  return {
    round,
    from,
    to,
    start: ACCOUNT.start,
    equity,
    cash,
    invested,
    profit: equity - ACCOUNT.start,
    profitPct: ((equity - ACCOUNT.start) / ACCOUNT.start) * 100,
    fees,
    tax,
    closed,
    wins,
    open: open.size,
    blocked,
    broke: blocked && open.size === 0,
    curve,
  };
}

/** Alle Runden (nach jedem Neustart eine neue); die letzte ist die aktuelle. */
export function computeAccount(trades: Trade[], resets: number[], openReturnEur: (t: Trade) => number | null): RoundSummary[] {
  const bounds = [0, ...[...resets].sort((a, b) => a - b)];
  return bounds.map((from, i) => computeRound(trades, from, bounds[i + 1], i + 1, openReturnEur));
}

/** Freies Geld der aktuellen Runde (für die Prüfung vor dem Übernehmen) */
export function freeCash(trades: Trade[], resets: number[]): number {
  const rounds = computeAccount(trades, resets, () => null);
  return rounds[rounds.length - 1].cash;
}

/** Reicht das Geld für einen neuen Trade (Betrag, Standard 500 €, + 7,90 € Gebühr)? */
export const canAfford = (trades: Trade[], resets: number[], amount: number = ACCOUNT.stake) => freeCash(trades, resets) >= amount + ACCOUNT.fee;

/** Hinweis, wenn das Geld für einen neuen Trade nicht reicht (direkt in der App sichtbar) */
export function noMoney(free?: number) {
  const f = free == null ? "" : ` Frei sind ${free.toFixed(2).replace(".", ",")} €.`;
  const text = `Nicht genug Geld: Für einen neuen Trade brauchst du ${ACCOUNT.stake} € + ${ACCOUNT.fee.toFixed(2).replace(".", ",")} € Gebühr.${f} Erst muss ein offener Trade schließen – oder im Depot neu starten, wenn das Konto leer ist.`;
  if (typeof window !== "undefined" && typeof window.alert === "function") window.alert(text);
}

export interface SimTrade {
  sym: string;
  /** Einstieg und Ausstieg (Millisekunden) */
  entry: number;
  exit: number;
  /** Rendite in % */
  r: number;
}

export interface SimResult {
  start: number;
  end: number;
  profit: number;
  profitPct: number;
  fees: number;
  tax: number;
  taken: number;
  /** ausgelassen, weil das Geld nicht reichte oder der Wert schon im Depot lag */
  skipped: number;
  broke: boolean;
}

/**
 * Spielt Trades mit dem Konto durch (für das EchoChart): 8.000 € Start, 500 € je Trade nur wenn genug Geld da ist
 * (je Wert höchstens eine Position), 7,90 € je Order, 27,5 % KESt sofort auf Gewinne mit Verlustausgleich im Jahr.
 */
export function simulateAccount(trades: SimTrade[]): SimResult {
  type Ev = { at: number; kind: 0 | 1; i: number };
  const ev: Ev[] = [];
  trades.forEach((t, i) => {
    ev.push({ at: t.entry, kind: 1, i });
    ev.push({ at: t.exit, kind: 0, i });
  });
  ev.sort((a, b) => a.at - b.at || a.kind - b.kind);
  let cash: number = ACCOUNT.start;
  let fees = 0;
  let tax = 0;
  let paid = 0;
  let year = ev.length ? yearOf(ev[0].at) : 0;
  let taken = 0;
  let skipped = 0;
  let broke = false;
  const open = new Set<number>();
  const syms = new Set<string>();
  for (const e of ev) {
    const t = trades[e.i];
    if (e.kind === 1) {
      if (broke || syms.has(t.sym) || cash < ACCOUNT.stake + ACCOUNT.fee) {
        if (!broke && cash < ACCOUNT.stake + ACCOUNT.fee && open.size === 0) broke = true;
        skipped++;
        continue;
      }
      cash -= ACCOUNT.stake + ACCOUNT.fee;
      fees += ACCOUNT.fee;
      open.add(e.i);
      syms.add(t.sym);
      taken++;
      continue;
    }
    if (!open.has(e.i)) continue;
    open.delete(e.i);
    syms.delete(t.sym);
    if (yearOf(e.at) !== year) {
      year = yearOf(e.at);
      paid = 0;
    }
    const g = (ACCOUNT.stake * t.r) / 100;
    cash += ACCOUNT.stake + g - ACCOUNT.fee;
    fees += ACCOUNT.fee;
    if (g > 0) {
      const k = g * ACCOUNT.tax;
      cash -= k;
      tax += k;
      paid += k;
    } else if (g < 0 && paid > 0) {
      const back = Math.min(paid, -g * ACCOUNT.tax);
      cash += back;
      tax -= back;
      paid -= back;
    }
  }
  return { start: ACCOUNT.start, end: cash, profit: cash - ACCOUNT.start, profitPct: ((cash - ACCOUNT.start) / ACCOUNT.start) * 100, fees, tax, taken, skipped, broke };
}
