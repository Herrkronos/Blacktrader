import type { ResolvedAsset } from "../types";

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

/** Bekannte, liquide Werte für den Chancen-Scanner. */
export const SCAN_PRESETS: ResolvedAsset[] = [
  crypto("BTC", "Bitcoin", "bitcoin"),
  crypto("ETH", "Ethereum", "ethereum"),
  crypto("SOL", "Solana", "solana"),
  crypto("XRP", "XRP", "ripple"),
  crypto("BNB", "BNB", "binancecoin"),
  crypto("ADA", "Cardano", "cardano"),
  crypto("DOGE", "Dogecoin", "dogecoin"),
  crypto("AVAX", "Avalanche", "avalanche-2"),
  crypto("LINK", "Chainlink", "chainlink"),
  crypto("DOT", "Polkadot", "polkadot"),
  stock("AAPL", "Apple", "USD"),
  stock("MSFT", "Microsoft", "USD"),
  stock("NVDA", "Nvidia", "USD"),
  stock("AMZN", "Amazon", "USD"),
  stock("GOOGL", "Alphabet (Google)", "USD"),
  stock("META", "Meta", "USD"),
  stock("TSLA", "Tesla", "USD"),
  stock("SAP.DE", "SAP", "EUR"),
  stock("SIE.DE", "Siemens", "EUR"),
  stock("ALV.DE", "Allianz", "EUR"),
  stock("DTE.DE", "Deutsche Telekom", "EUR"),
  stock("RHM.DE", "Rheinmetall", "EUR"),
  stock("MBG.DE", "Mercedes-Benz", "EUR"),
  stock("BAS.DE", "BASF", "EUR"),
];
