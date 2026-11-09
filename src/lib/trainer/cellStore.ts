// Speicher der getrennten Zellen (je Klasse × Horizont ein Schlüssel, z. B. "trainer:krypto:kurz").
// Lesen → prüfen → schreiben unter einer Sperre NUR für diese Zelle. Ein einziger SET je Änderung (kein halber Zustand).
import { applyProposal, cellStorageKey, emptyRecord, rollbackRecord, type CellRecord, type Proposal } from "./cells";
import type { CellAccess } from "./job";
import { acquireLock, getJson, releaseLock, setJson } from "./storage";
import { CELL_KEYS, type CellKey } from "./universe";

export async function loadCell(cell: CellKey): Promise<CellRecord> {
  return (await getJson<CellRecord>(cellStorageKey(cell))) ?? emptyRecord(cell);
}

export async function loadAllCells(): Promise<CellRecord[]> {
  return Promise.all(CELL_KEYS.map(loadCell));
}

/** Lesen → prüfen → schreiben unter einer Sperre NUR für diese Zelle (ein Schreibvorgang, kein halber Zustand). */
export async function withCellLock<T>(cell: CellKey, fn: (rec: CellRecord) => { record: CellRecord | null; result: T }): Promise<T> {
  const lock = `${cellStorageKey(cell)}:lock`;
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await acquireLock(lock, 15);
    if (!ok) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ok) throw new Error("Speicher gerade belegt – bitte gleich noch einmal");
  try {
    const out = fn(await loadCell(cell));
    if (out.record) await setJson(cellStorageKey(cell), out.record);
    return out.result;
  } finally {
    await releaseLock(lock);
  }
}

export const serverCells: CellAccess = {
  get: loadCell,
  propose: (cell: CellKey, p: Proposal) =>
    withCellLock(cell, (rec) => {
      const out = applyProposal(rec, p);
      return { record: out.record, result: out };
    }),
};

export async function rollbackCell(cell: CellKey, to?: number): Promise<CellRecord | null> {
  return withCellLock(cell, (rec) => {
    const r = rollbackRecord(rec, to);
    return { record: r, result: r };
  });
}

