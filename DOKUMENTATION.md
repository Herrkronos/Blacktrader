# Black Ship Holding – Blacktrader · Dokumentation

> Keine Anlageberatung. Analysen können falsch sein. Handel auf eigenes Risiko.

Blacktrader ist der Analyst der App. Er rechnet für jeden Wert die Zeiträume **im Hintergrund** und zeigt **genau einen aktuellen Einstieg**:

| Farbe | Bedeutung |
|---|---|
| **Blau** | Langfristiger Einstieg: Bereich 61,8–88,6 % einer großen Aufwärtswelle, Kauf in 3 Teilen, kein fester Stop, ungültig bei Schlusskurs unter dem Wellenstart |
| **Grün** | Trade auf steigende Kurse mit Einstiegszone, Stop und Ziel |
| **Gelb** | Gerade kein sauberer Einstieg – mit kurzem Hinweis, worauf Blacktrader wartet (nur in der Watchlist) |
| **Grau** | Alte Einstiege (erledigt, ungültig, abgelöst) im Chart und unter „Verlauf“ |

Es gibt **keine Shorts**. Fallende Kurse bedeuten „Gelb – abwarten“.

---

## 1. Aufbau der App

```
src/app/                Seiten (Next.js App Router) und API-Routen
  page.tsx              Übersicht: Performance, Top 3 Einstiege, offene Trades, News
  chancen/              Chancen: Filter Alle · Blau · Grün, Gruppen Aktien/Krypto/Rohstoffe
  watchlist/            Watchlist: je Wert der aktuelle Einstieg (auch Gelb)
  journal/              Papier-Trades: Filter Alle · Blau · Grün, Zeitraum nur als Info
  trainer/              Trainer: Zonen-Quote je Signalart, Training starten
  echochart/            Rückblick: Wie hätten die Zonen früher gehalten?
  einstellungen/        Gewichtung (in festen Grenzen), Kerzengrößen, Push, Keys
  api/                  candles, quote, fundamentals, news, resolve, llm, history,
                        trainer/* (Lernstände, Cron, Protokolle), push/* (Web Push)
src/lib/analysis/       BLACKTRADER-KERN (reine Funktionen, ohne React/Browser)
  analyze.ts            Gesamtanalyse eines Werts für einen Zeitraum
  elliott/              Wellenmuster, harte Regeln, Fibonacci, Ranking, Ziele
  fundamental.ts        Firmenzahlen + News-Sentiment
  volume.ts, indicators.ts  Volumen, RSI, ATR, Divergenzen
  score.ts              Gewichtung, Signalstufen, Trade-Plan, Vetos
  longterm.ts           Blauer Langfrist-Bereich
  bestEntry.ts          EIN Einstieg pro Wert, Marktlage, Sektor-Regel, Verlauf (grau)
  promotion.ts          Hochstufung Grün → Blau, Stop nur nachziehen
  zoneOutcome.ts        Zonen-Quote wie HKCM
  locked-config.ts      feste Werte (vom Trainer nie veränderbar)
  params.ts             lernbare Parameter mit Grenzen
src/lib/trainer/        Trainer (Walk-Forward, Zellen je Klasse × Zeitraum, Speicher)
src/lib/client/         Browser: Scanner (Blacktrader im Hintergrund), Verlauf, Live-Kurse, Push
src/lib/store/          lokaler Speicher (localStorage), Migrationen mit Backup, Export/Import
src/components/         Karten, Charts, Sheets
tests/                  Vitest (über 170 Tests)
```

**Ablauf beim Öffnen von Chancen/Watchlist/Übersicht** (`src/lib/client/scanner.ts`):
1. Marktlage laden: S&P 500 (`^GSPC`) und NASDAQ 100 (`^NDX`), Tageskerzen.
2. Je Wert die erlaubten Zeiträume rechnen (Aktien & Krypto: mittel + lang; Rohstoffe: zusätzlich kurz, wenn der Gesamtmarkt bullisch ist).
3. `pickBestEntry` wählt genau einen Einstieg (Blau/Grün/Gelb).
4. `recordEntry` aktualisiert den Verlauf: der alte Einstieg wird grau (mit Datum und Grund).
5. `applyPromotions` prüft offene grüne Trades auf Hochstufung zu Blau.

## 2. Design

| Element | Wert |
|---|---|
| Hintergrund | Wappen `public/background.webp/.jpg`, fixiert, Schwarz `#050505`, dunkelrote Panels |
| Gold | `#c9a24a` (hell `#e3c57a`, dunkel `#8f7232`) |
| Wein/Rot | `#7a1420`, `#a32234` |
| Schriften | Überschriften **Cinzel**, Text **Inter** (Google Fonts), Zahlen tabellarisch |
| Signal Blau | `#38bdf8` (Rand `edge-core`, Badge `badge-core`) |
| Signal Grün | `#34d399` (`edge-trade`, `badge-trade`) |
| Signal Gelb | Amber `#fbbf24` (`edge-wait`, `badge-wait`) |
| Grau (alt) | Stein-Grau, gestrichelte Box im Mini-Chart, Liste „Verlauf“ |
| Stop/Verlust | `#f87171` |

Mobil zuerst: große Touch-Flächen (≥ 44 px), Bottom-Navigation, Bottom-Sheets. Als PWA installierbar (`manifest.webmanifest`, `sw.js`).

## 3. Methode von Blacktrader

### 3.1 Elliott-Wellen (60–100 % Gewicht, nie unter 60 %)
- Swings über ZigZag mit ATR-Schwelle; Muster: Impuls, Diagonalen, Zigzag (auch doppelt/dreifach), Flats, Dreiecke, Kombinationen.
- Harte Regeln: Welle 2 nie unter den Start von Welle 1; Welle 3 nie die kürzeste; Welle 4 überlappt Welle 1 nicht (außer Diagonale).
- Ranking nach Fibonacci-Passung; Alternativzählung wird mitgeführt. Ist sie fast gleich stark in die Gegenrichtung → kein Trade.

### 3.2 Fundamental & News (≥ 10 %)
Kennzahlen (Bewertung, Wachstum, Verschuldung; bei Krypto Marktkapitalisierung, Angebot, Entwicklung) und Nachrichten der letzten 72 h mit Sentiment (DE/EN).

### 3.3 Volumen & RSI (≥ 10 %)
Relatives Volumen, OBV, Volume Profile, RSI (Wilder) und Divergenzen.

### 3.4 Gewichtung
`Gesamt = 0,6 × Elliott + 0,2 × Fundamental/News + 0,2 × Volumen/RSI` (Standard). Der Trainer darf innerhalb fester Grenzen lernen (Elliott ≥ 60 %, die anderen je ≥ 10 %, Summe 100 %).

### 3.5 Einstieg, Stop, Ziel (grün)
Zone = 61,8–78,6 % Rücksetzer der letzten Welle; Stop knapp hinter dem Wellenstart (+0,25 ATR); Ziel 1 = Fibonacci-Erweiterung (+27,2 %); Chance/Risiko mindestens 1,5. Ab Ziel 1 läuft der Stop mit (4 × ATR).

### 3.6 Szenario-Entscheidung: EIN Einstieg pro Wert (`bestEntry.ts`)
1. **Blau im Bereich** (Kurs schon im Langfrist-Bereich) hat Vorrang.
2. Sonst **Grün** aus dem besten erlaubten Zeitraum – Rangfolge nach gemessener Zonen-Quote:
   Aktien lang → mittel · Krypto mittel → lang · Rohstoffe kurz → lang → mittel.
3. Sonst **Blau zulaufend**.
4. Sonst **Gelb** mit Hinweis (z. B. „Der Chart zeigt fallende Kurse – Blacktrader wartet …“).

Regeln:
- **Keine Shorts.**
- **Aktien und Krypto ohne kurzfristige Signale.** Rohstoffe kurzfristig nur, wenn der S&P 500 bullisch ist (über der 200-Tage-Linie und +5 % in 100 Tagen).
- **Sektor-Regel:** Liegt der NASDAQ 100 unter seiner 200-Tage-Linie, gibt es keine grünen Tech-Trades. Blaue Einstiege, Dividendenwerte und Rohstoffe bleiben.

### 3.7 Verlauf (grau)
- **erledigt:** Kurs ist in die Zone eingetaucht und oben wieder herausgelaufen → Zone hat gehalten, wird nicht erneut gezeigt.
- **ungültig:** Schlusskurs unter Stop bzw. Invalidierung.
- **abgelöst:** Blacktrader hat einen anderen Einstieg gewählt.

Gespeichert auf dem Gerät (`bt-entry-history-v1`), höchstens 10 alte Einträge je Wert.

### 3.8 Nachziehen und Hochstufung Grün → Blau (`promotion.ts`)
Ein offener grüner Long-Trade im Gewinn wird **blau**, wenn die übergeordnete Zählung (Wochenchart) den Aufwärtstrend bestätigt (unfertiger Aufwärtsimpuls oder abgeschlossene Abwärtskorrektur, nicht umstritten).
- Stop → unter das Tief der letzten bestätigten Korrekturwelle, **nur anheben, nie zurücksetzen**, nie über den Kurs.
- Ziele → nächste Wochen-Ziele über dem Kurs.
- Datum und Grund stehen auf der Karte und im Journal; Push-Nachricht.

### 3.9 Blauer Langfrist-Bereich (`longterm.ts`, unverändert)
ZigZag 6 × ATR, Welle ≥ 8 ATR; Bereich 61,8–88,6 % Rücksetzer; Kauf in 3 Teilen; kein fester Stop; Teilausstieg/Stop nur, wenn sich die Zählung ändert; ungültig bei Schlusskurs unter dem Wellenstart.

## 4. Trainer

**Lernt** (je Anlageklasse × Zeitraum, `params.ts`): Gewichtung in Grenzen, Mindeststärke (darf nur steigen), Elliott-Übereinstimmung, Welle-5-Filter, Bestätigung durch den höheren Zeitraum, Welle-5-Ausstieg.

**Gesperrt** (`locked-config.ts`, eingefroren, durch Tests abgesichert): Methode, Elliott-Regeln, Mindest-Gewichtungsgrenzen (Elliott ≥ 60 %), Risiko-Logik (Zone, Stop, CRV ≥ 1,5), Annahmeregeln (≥ 200 Signale, Signale/Monat höchstens −40 %, Gewinnfaktor und Drawdown nicht schlechter).

**Messung:** Zonen-Quote wie HKCM – Kurs taucht in die Zone ein, dreht vor der Unterkante und läuft oben heraus. Walk-Forward mit gesperrten Testdaten (letzte 12 Monate). Gespeichert wird nur, wenn das Ergebnis besser ist.

**Anzeige:** Quote je Signalart – **Grün** (Testdaten der Zeiträume, die Blacktrader nutzt) und **Blau** (erledigte gegen ungültige blaue Einstiege im Verlauf). Gelb zählt nicht. Aktien- und Krypto-Kurzfrist werden nicht mehr trainiert; alte Stände bleiben gespeichert.

**Speicher:** Je Zelle eigener Schlüssel (`trainer:aktien:mittel` …) mit Sperre auf dem Server (Upstash/Vercel KV) **und** sofort eine lokale Kopie im Browser; der jüngere Stand gewinnt. Ohne KV bleibt nur die lokale Kopie.

## 5. Datenquellen

| Zweck | Quelle |
|---|---|
| Aktien, Indizes, Rohstoffe | Yahoo Finance (inoffiziell), Tageskerzen bis 5 Jahre |
| Krypto | Binance REST + WebSocket, Fallback Yahoo `XXX-USD` |
| Krypto-Fundamentaldaten | CoinGecko |
| Fundamentaldaten Aktien | Yahoo quoteSummary, optional Finnhub/Alpha Vantage |
| News | Yahoo-Finance-RSS, Google-News-RSS |
| ISIN | Yahoo-Suche, Fallback OpenFIGI |

## 6. Nutzerdaten & Migration

Alle Daten liegen im Browser (`black-ship-trading-analyst:v1`). Beim ersten Start nach dem Blacktrader-Update wird ein **JSON-Backup** angelegt (`…:backup:<Datum>-vor-blacktrader`); Trades, Watchlist und Einstellungen bleiben unverändert. Offene Trades behalten ihren alten Zeitraum als Info-Label. Export/Import als JSON unter Einstellungen.

## 7. Lokal starten

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # Tests
npm run build        # Produktions-Build
```

Optionale Umgebungsvariablen (`.env.local`, **nie committen**):

| Variable | Zweck |
|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (oder `UPSTASH_REDIS_REST_URL/TOKEN`) | Server-Speicher für Trainer und Push |
| `TRAINER_ADMIN_TOKEN` | Zugangscode für das Training |
| `CRON_SECRET` | Schutz der Cron-Routen |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (sonst automatisch erzeugt und in KV gespeichert) |

## 8. Deploy (Vercel)

1. Repository bei Vercel importieren (Framework Next.js). `vercel.json`: Region Frankfurt, 2 Cron-Jobs (Trainer täglich, Push-Prüfung täglich).
2. **Settings → Git → Production Branch = `main`.**
3. **Storage → Upstash for Redis** verbinden (setzt die KV-Variablen) → Redeploy. Ohne das gehen Trainer-Stände auf dem Server verloren.
4. Optional `TRAINER_ADMIN_TOKEN` und `CRON_SECRET` unter Environment Variables.

## 9. Blacktrader in einem anderen Projekt nutzen

Das Paket `blacktrader-core` (separate ZIP) enthält `src/lib/analysis`, `src/lib/types.ts` und die nötigen Hilfsdateien – reine TypeScript-Funktionen ohne React:

```ts
import { analyze } from "./blacktrader/analysis/analyze";
import { findLongTermZone } from "./blacktrader/analysis/longterm";
import { marketContext, pickBestEntry } from "./blacktrader/analysis/bestEntry";

const views = {
  medium: analyze({ symbol: "AAPL", name: "Apple", candles: daily, horizon: "medium", interval: "1d", kind: "stock" }),
  long: analyze({ symbol: "AAPL", name: "Apple", candles: weekly, horizon: "long", interval: "1w", kind: "stock" }),
};
const entry = pickBestEntry({ symbol: "AAPL", kind: "stock", views, lt: findLongTermZone(weekly), ctx: marketContext(spxDaily, ndxDaily) });
// entry.color: "blau" | "gruen" | "gelb", entry.zoneTop/zoneBottom/stop/targets/reason
```

## 10. Vergleich alt gegen neu (gesperrte Testdaten, letzte 12 Monate, 65 Werte)

| Klasse | Zonen-Quote alt | neu | Gewinnfaktor alt | neu |
|---|---|---|---|---|
| Aktien | 65,5 % | **72,8 %** | 0,90 | **1,11** |
| Rohstoffe | 69,1 % | 68,7 % | 1,18 | **1,31** (max. Rückgang −14 % → −8,2 %) |
| Krypto (ohne Short) | 62,3 % | **76,9 %** | 0,93 | 0,42 |

Chronologischer Test Sep 2022 – Nov 2026, 5.000 € Startkapital, nach 26,5 % KESt: Blacktrader mit Sektor-Regel 9.728 € (+94,6 %), ohne Sektor-Regel 9.252 € (+85 %), Zufall 8.837 € (+76,7 %), S&P 500 Kaufen-und-Halten 8.145 € (+62,9 %).
**Ehrlicher Hinweis:** überwiegend steigende Märkte; der Vorsprung vor Zufall ist im chronologischen Test klein. Bei Krypto ist der Gewinnfaktor trotz höherer Quote schwach.
