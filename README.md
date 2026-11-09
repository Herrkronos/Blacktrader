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

Stand der Messung auf Prüfdaten (letzte 40 %, vom Analysten nie gesehen):

| Methode | Trades | Treffer | Gewinnfaktor |
|---|---|---|---|
| Elliott-Sofort-Einstieg (alt) | 145 | 16 % | 0,51 |
| + Trendfilter + Stop ≥ 2 ATR | 138 | 35 % | 0,66 |
| Zielzonen-Einstieg, Ausstieg bei Ziel 1 | 383 | 36 % | 1,18 |
| **Zielzonen + Gewinne laufen lassen (aktuell)** | **283** | **34 %** | **1,67** |

Zielzonen (`src/lib/analysis/zones.ts`): im Trend die letzte Welle A→B, Limit-Einstieg bei 61,8 % Korrektur
(Zone bis 78,6 %), Stop jenseits von A, Ziel 1 = B + 27,2 %. Ab Ziel 1 Stop auf Einstieg und mit 4 × ATR nachziehen. `ZONE='{...}'` bzw. `ZONEGRID=1` für Messungen.

### Kernposition (Welle 5 / Boden)

`src/lib/analysis/core.ts`: im Aufwärtstrend (EMA 50/200) halten, nach erkannter abgeschlossener 5. Welle (großer Wellengrad,
Qualität ≥ 0,55) Gewinne mitnehmen, nach einem Boden (abgeschlossene Korrektur oder neue Welle 1-2) bzw. neuem Hoch wieder
einsteigen. Messung: `CORE=0.55 npx tsx scripts/evaluate.ts`.

| Daten | Einfach halten | Kernposition | größter Rückgang Kern / Halten |
|---|---|---|---|
| S&P 500 täglich 2010–2021 (Prüfung) | +489 % | +223 % | −23 % / −34 % |
| S&P 500 wöchentlich (Prüfung) | +372 % | +284 % | −29 % / −53 % |
| Gold 2013 1h (frisch) | −28 % | −8 % | −12 % / −30 % |
| Gold 2017 1h (frisch) | +9 % | +11 % | −4 % / −9 % |

## Oberfläche (v2)

Bottom-Navigation: Übersicht · Chancen · Watchlist · Journal · Mehr (EchoChart, Einstellungen, Backups).
Signalfarben: Grün = Trade, Rot = Short, Blau = Kernposition, Orange = wartende Order.
Journal enthält nur selbst übernommene Papier-Trades; beim Update auf v2 wird vorher ein Backup im Browser angelegt
(Mehr → Backups). Zurück zum alten Stand: Branch `backup/vor-ui-umbau`.

## Trainer (Mehr → Trainer)

Der Trainer verbessert nur die **Anwendung** der Methode – die Strenge wird nie aufgeweicht.

- **Fest** (`src/lib/analysis/locked-config.ts`, eingefroren, `tests/locked.test.ts` schlägt bei Änderung fehl): Elliott-Grundregeln und Muster, Stop-/Ziel-Logik, Chance-Risiko ≥ 1,5, Nachziehen, Wartezeit, Horizonte, Farben, **Grenzen der Gewichtung** (Elliott ≥ 60 %, Fundamental/News ≥ 10 %, Volumen/RSI ≥ 10 %, Summe 100 %) und die **Annahmeregeln** (≥ 200 Signale, Signale/Monat höchstens −40 %, Profit-Faktor und max. Rückgang nicht schlechter).
- **Lernbar** (`src/lib/analysis/params.ts`, je Anlageklasse × Horizont): ZigZag-/Pivot-Empfindlichkeit (`elliottDegrees`, `zoneAtrMult`), Ranking alternativer Zählungen, Fibonacci-Toleranz, RSI-/Volumen-Schwellen, Divergenz-Frische, Gewichtung (in den festen Grenzen), Kennzahl-/News-Gewichte. **Nur strenger** (nie zurück): Mindest-Signalstärke, Wellen-Bestätigung (`elliottAgreement`), Welle-5-Filter, Bestätigung durch die übergeordnete Zeitebene, Gewinnsicherung bei Wellen-5-Ende (`wave5Exit`). Standardwerte = bisheriges Verhalten (`tests/golden.test.ts`).
- **Walk-Forward** (`src/lib/trainer/walkforward.ts`): Je Parametersatz ein Backtest über die Lernzeit (jedes Signal sieht nur Kerzen bis zu seinem Zeitpunkt). Für Fold k wird NUR mit Trades gewählt, die vor dem Prüfbeginn abgeschlossen sind; gemessen wird auf dem folgenden, unbekannten Bereich. Die letzten 12 Monate bleiben gesperrt (einmaliger Abschlusstest je Version).
- **Speichern nur, wenn besser:** Nach jeder Sitzung/jedem Bereich alt gegen neu auf unbekannten Daten. Meldung „Verbessert: 61,2 % → 63,8 % – gespeichert“ oder „Keine Verbesserung (60,9 %) – alter Stand bleibt“. Jede Version ist gespeichert und kann wiederhergestellt werden.
- **Trainer-Ansicht:** Ziel 70 % und aktueller Stand je Anlageklasse (Aktien · Krypto · Rohstoffe), Trainingsdauer (15 Min bis 8 Std) mit Start/Stopp, Ladebalken mit Restzeit und eine kurze Ergebnis-Meldung. Versionen, Verlauf und Details bleiben im Hintergrund (`/api/trainer`). Das Training läuft im Web Worker für die gewählte Klasse. Der Bildschirm bleibt an (Wake Lock), der Fortschritt bleibt nach dem Neuladen erhalten. Ergebnisse gehen an `/api/trainer/propose`. Der Server prüft Grenzen, Strenge-Regeln und Ausgangsstand erneut. Die Messwerte selbst kommen aus dem Browser – deshalb `TRAINER_ADMIN_TOKEN` setzen, damit nur du Ergebnisse speichern kannst.
- **Nachtlauf:** Vercel Cron (`vercel.json`, täglich 02:17 UTC) → `/api/trainer/cron`, je Lauf ~48 s, setzt die Arbeit fort. Zusätzlich wird das Signal-Protokoll ausgewertet.
- **Gewichtung in den Einstellungen:** „Automatisch (Trainer)“ oder „Manuell“ – drei Regler, dieselben festen Grenzen, Anzeige der zuletzt gelernten Gewichtung.
- **Wissensbasis:** `knowledge/elliott.md` (Regeln, Richtlinien, Muster → prüfbare Regeln im Code), `knowledge/analyst-principles.md` (Wie/Warum/Wann).
- **Speicher:** In Vercel unter Storage „Upstash for Redis“ verbinden (`KV_REST_API_URL`/`KV_REST_API_TOKEN`). Optional `CRON_SECRET`, `TRAINER_ADMIN_TOKEN`.
- Offline-Messung: `DATA_DIR=<ordner> BUDGET_S=120 npx tsx scripts/train.ts`.
