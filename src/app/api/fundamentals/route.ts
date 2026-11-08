import { coingeckoFundamentals } from "@/lib/data/coingecko";
import { UpstreamError } from "@/lib/data/http";
import { alphaVantageFundamentals, finnhubFundamentals, mergeFundamentals } from "@/lib/data/optional";
import { handle, param } from "@/lib/data/route-helpers";
import { yahooFundamentals } from "@/lib/data/yahoo";
import type { StockFundamentals } from "@/lib/types";

export async function GET(req: Request) {
  const kind = param(req, "kind");
  const symbol = param(req, "symbol");
  const id = param(req, "id");
  const finnhubKey = req.headers.get("x-finnhub-key") || undefined;
  const avKey = req.headers.get("x-alphavantage-key") || undefined;
  return handle(req, async () => {
    if (kind === "crypto") {
      if (!id) return { fundamentals: null, note: "Keine CoinGecko-ID – Fundamentaldaten nicht verfügbar." };
      return { fundamentals: await coingeckoFundamentals(id) };
    }
    if (!symbol) throw new UpstreamError("Symbol fehlt", 400);
    const errors: string[] = [];
    let f: StockFundamentals | null = null;
    try {
      f = await yahooFundamentals(symbol);
    } catch (e) {
      errors.push((e as Error).message);
    }
    // US-Kürzel ohne Börsensuffix für Finnhub/Alpha Vantage
    const plain = symbol.includes(".") ? undefined : symbol;
    if (finnhubKey && plain) {
      try {
        f = mergeFundamentals(f, await finnhubFundamentals(plain, finnhubKey));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (avKey && plain && (!f || f.pe == null)) {
      try {
        f = mergeFundamentals(f, await alphaVantageFundamentals(plain, avKey));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { fundamentals: f, note: f ? undefined : `Fundamentaldaten nicht verfügbar (${errors.join(" · ")})` };
  }, finnhubKey || avKey ? 0 : 3600);
}
