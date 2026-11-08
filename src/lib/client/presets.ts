import type { AssetKind, ResolvedAsset } from "../types";

const crypto = (symbol: string, name: string, coingeckoId: string): ResolvedAsset => ({
  kind: "crypto",
  symbol,
  name,
  binanceSymbol: `${symbol}USDT`,
  yahooSymbol: `${symbol}-USD`,
  coingeckoId,
  exchange: "Binance",
  currency: "USDT",
});
const stock = (symbol: string, name: string, currency: string): ResolvedAsset => ({ kind: "stock", symbol, name, yahooSymbol: symbol, currency });
/** Rohstoffe über die fortlaufenden Terminkontrakte bei Yahoo Finance (Preise in US-Dollar). */
const commodity = (symbol: string, name: string): ResolvedAsset => ({ kind: "commodity", symbol, name, yahooSymbol: symbol, currency: "USD", exchange: "Terminmarkt" });

/** Feste Werte für den Chancen-Scanner, in drei Gruppen. */
export const SCAN_GROUPS: { kind: AssetKind; title: string; assets: ResolvedAsset[] }[] = [
  {
    kind: "stock",
    title: "Aktien",
    assets: [
      stock("AAPL", "Apple", "USD"),
      stock("MSFT", "Microsoft", "USD"),
      stock("NVDA", "Nvidia", "USD"),
      stock("AMZN", "Amazon", "USD"),
      stock("GOOGL", "Alphabet (Google)", "USD"),
      stock("META", "Meta", "USD"),
      stock("TSLA", "Tesla", "USD"),
      stock("JPM", "JPMorgan Chase", "USD"),
      stock("SAP.DE", "SAP", "EUR"),
      stock("SIE.DE", "Siemens", "EUR"),
      stock("ALV.DE", "Allianz", "EUR"),
      stock("DTE.DE", "Deutsche Telekom", "EUR"),
      stock("RHM.DE", "Rheinmetall", "EUR"),
      stock("MBG.DE", "Mercedes-Benz", "EUR"),
      stock("BAS.DE", "BASF", "EUR"),
    ],
  },
  {
    kind: "crypto",
    title: "Krypto",
    assets: [
      crypto("BTC", "Bitcoin", "bitcoin"),
      crypto("ETH", "Ethereum", "ethereum"),
      crypto("SOL", "Solana", "solana"),
      crypto("XRP", "XRP", "ripple"),
      crypto("BNB", "BNB", "binancecoin"),
      crypto("DOGE", "Dogecoin", "dogecoin"),
      crypto("ADA", "Cardano", "cardano"),
      crypto("TRX", "Tron", "tron"),
    ],
  },
  {
    kind: "commodity",
    title: "Rohstoffe",
    assets: [
      commodity("GC=F", "Gold"),
      commodity("SI=F", "Silber"),
      commodity("CL=F", "Öl (WTI)"),
      commodity("BZ=F", "Öl (Brent)"),
      commodity("NG=F", "Erdgas"),
      commodity("HG=F", "Kupfer"),
      commodity("PL=F", "Platin"),
    ],
  },
];

export const SCAN_PRESETS: ResolvedAsset[] = SCAN_GROUPS.flatMap((g) => g.assets);
