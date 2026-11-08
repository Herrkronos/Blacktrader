# Black Ship Holding – Trading Analyst

Web-App für Watchlist, Echtzeit-Überwachung und regelbasierte Analyse (Elliott-Wellen 60 %, Fundamental/News 20 %, Volumen/RSI 20 %) mit Papier-Trade-Journal und Backtest.
**Kein Login, keine Registrierung, keine Zahlungsmittel.** Alle Daten liegen lokal im Browser (localStorage) und lassen sich als JSON exportieren und importieren.

> Keine Anlageberatung. Analysen können falsch sein. Handel auf eigenes Risiko.

## Start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Unit-Tests (Vitest)
npm run build      # Produktions-Build
```

**Hintergrund:** Lege das Wappen als `public/background.jpg` ab. Es wird fixiert, zentriert und mit „contain“ dargestellt. Ohne Datei bleibt der Hintergrund schwarz.

**Vercel:** Repository importieren, Framework „Next.js“, keine Umgebungsvariablen nötig. `vercel.json` legt die Server-Region auf Frankfurt (`fra1`) fest, damit Binance und europäische Kursdaten erreichbar sind.

## Datenquellen (alle kostenlos, ohne Key)

| Zweck | Quelle | Hinweis |
|---|---|---|
| Aktien/ETF-Kerzen & Kurse | Yahoo Finance (inoffiziell) | Polling 15–60 s, je nach Börse ~15 min verzögert |
| Fundamentaldaten Aktien | Yahoo quoteSummary (Cookie/Crumb) | inoffiziell, kann sich ändern → optional Finnhub/Alpha Vantage |
| ISIN → Ticker | Yahoo-Suche, Fallback OpenFIGI | ISIN-Prüfziffer wird lokal validiert |
| Krypto-Kerzen & Live-Kurse | Binance REST + WebSocket | Fallback: Polling bzw. Yahoo `BTC-USD` |
| Krypto-Fundamentaldaten | CoinGecko | Marktkapitalisierung, Angebot, Entwicklungsaktivität |
| News (72 h) | Yahoo-Finance-RSS, Google-News-RSS | Sentiment per Lexikon (DE/EN) mit Quellenlink |

Optional in den Einstellungen (lokal gespeichert): Finnhub, Alpha Vantage, OpenFIGI und ein LLM-Key (Anthropic/OpenAI) zum Ausformulieren der Begründungen.

**Wichtig für Vercel:** Die Binance-REST-API blockiert US-Server-IPs (HTTP 451). Die Proxy-Route versucht zuerst `data-api.binance.vision` und fällt danach auf Yahoo (`BTC-USD`) zurück. Der Live-WebSocket läuft direkt im Browser des Nutzers und ist davon nicht betroffen.

## Architektur

```
src/lib/analysis/   reine, getestete Analyse-Module
  isin.ts           ISIN-Validierung (Luhn)
  indicators.ts     RSI (Wilder), ATR, OBV, rel. Volumen, Volume Profile, Divergenzen
  zigzag.ts         Swing-Erkennung mit ATR-Schwelle
  elliott/          Muster (Impuls, Diagonalen, Zigzag, Flats, Dreiecke, W-X-Y, W-X-Y-X-Z),
                    harte Regeln, Fibonacci-Passung, Ranking, Ziele und Invalidierung
  fundamental.ts    Kennzahlen-Score + News-Sentiment
  volume.ts         Volumen/RSI-Score
  score.ts          Gewichtung, Signalstufen, Trade-Plan, Veto („lieber kein Trade“)
  persona.ts        regelbasierte Begründungstexte im Analysten-Stil
  backtest.ts       EchoChart: Walk-Forward-Backtest ohne Blick in die Zukunft
src/lib/data/       Server: Provider, Cache, Drosselung, Rate-Limit
src/app/api/        Proxy-Routen (resolve, candles, quote, fundamentals, news, llm)
src/lib/client/     Live-Kurse (WebSocket/Polling), Alarme, Trade-Verfolgung
src/lib/store/      lokaler Speicher + Export/Import
```

### Score-Logik
`Gesamt = 0,6 × Elliott + 0,2 × Fundamental/News + 0,2 × Volumen/RSI` (in den Einstellungen änderbar).
Signalstufen: ≥ 72 Starker Kauf, ≥ 58 Kauf, ≤ 42 Verkauf, ≤ 28 Starker Verkauf, sonst Neutral.
Ein Signal wird auf **Neutral/kein Trade** gesetzt, wenn die Wellenzählung unsicher ist, die Alternativzählung fast gleich stark in die Gegenrichtung zeigt, das Chance-Risiko-Verhältnis unter 1,5 liegt oder Elliott der Gesamtrichtung widerspricht.

## Messung mit echten Kursdaten

`scripts/evaluate.ts` lässt den Analysten (EchoChart-Logik) über echte historische Kursreihen laufen und teilt jede Reihe in
Entwicklung (erste 60 %) und unabhängige Prüfung (letzte 40 %). Regeln werden nur anhand der Entwicklungsdaten gewählt.

```bash
DATA_DIR=<ordner mit SPY_D.csv, GOOG.csv, EURUSD.csv, xau2016_5m.csv> npx tsx scripts/evaluate.ts
DATA_DIR=... GRID=1 npx tsx scripts/evaluate.ts   # Filter-Kombinationen (nur Entwicklungsdaten)
```

Stand der Messung (Prüfdaten): ohne Filter 16 % Treffer / Gewinnfaktor 0,51; mit Trendfilter + Stop ≥ 2 ATR 35 % / 0,66.
Ein nachweisbarer Vorteil (Gewinnfaktor > 1 auf Prüfdaten) besteht noch nicht.
