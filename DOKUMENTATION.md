# Black Ship Holding – Blacktrader · Dokumentation

> Keine Anlageberatung. Analysen können falsch sein. Handel auf eigenes Risiko.

Blacktrader ist der Analyst der App. Er rechnet für jeden Wert die Zeiträume **im Hintergrund** und zeigt **genau einen aktuellen Einstieg**:

| Farbe | Bedeutung |
|---|---|
| **Blau** | Langfristiger Einstieg: Bereich 61,8–88,6 % einer großen Aufwärtswelle, Kauf in 3 Teilen, kein fester Stop, ungültig bei Schlusskurs unter dem Wellenstart |
| **Grün** | Trade auf steigende Kurse mit Einstiegszone, Stop und Ziel |
| **Rot** | Short: Trade auf fallende Kurse mit Einstiegszone, Stop (darüber) und Ziel (darunter) – nur wenn der Gesamtmarkt (S&P 500) bärisch ist |
| **Gelb** | Gerade kein sauberer Einstieg – mit kurzem Hinweis, worauf Blacktrader wartet (nur in der Watchlist) |
| **Grau** | Alte Einstiege (erledigt, ungültig, abgelöst) im Chart und unter „Verlauf“ |

Shorts (rot) gibt es nur bei bärischem Gesamtmarkt (S&P 500 unter der 200-Tage-Linie und −5 % in 100 Tagen). In anderen Marktlagen bedeuten fallende Kurse „Gelb – abwarten“. Begründung: Im Turnier verloren Shorts ohne diese Regel −21,8 % pro Jahr (Blacktrader gesamt nur +9,4 %), mit der Regel ist Blacktrader gesamt bei +19,8 % – besser als ganz ohne Shorts (+18,9 %).

---

## 1. Aufbau der App

```
src/app/                Seiten (Next.js App Router) und API-Routen
  page.tsx              Übersicht: Performance, Top 3 Einstiege, offene Trades, News
  chancen/              Chancen: höchstens 20 (gern weniger) Einstiege mit der höchsten Chance aus dem Markt (rund 190 Werte:
                        S&P 100, DAX, ATX, 20 Krypto, 10 Rohstoffe – src/lib/client/marketList.ts);
                        Filter Alle · Blau · Grün · Rot, Aktien/Krypto/Rohstoffe; reine Watchlist-Werte nicht
  watchlist/            Watchlist: kompakte Kacheln mit Mini-Chart (auch Gelb); Antippen = Details + übernehmen
  depot/                Depot (früher Journal): Papier-Trades, Filter Alle · Blau · Grün; /journal leitet weiter
  trainer/              Trainer: Training + Turnier gegen 9 Bots, Rangliste und Auswertung
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
  tournament.ts         Turnier: 9 Gegner, Marktlage, Simulation, Rangliste, Auswertung in Worten
  tournamentRun.ts      Turnier rechnen (Daten laden, Blacktrader vor/nach dem Training)
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

**Chancen – Mindestanforderungen** (nur wer sie erfüllt, erscheint; höchstens 20): Grün/Rot – Kurs höchstens 8 % von der Zone, Chance bis zum Ziel mindestens 15 % (dieselbe Regel gilt im Turnier: +22,0 % statt +21,8 % pro Jahr; ein Stop-Limit von 25 % wurde getestet und schadete stark – +6,8 % –, weil die besten Trades große Wellen mit weitem Stop sind). Blau – Kurs im Bereich, Ungültig-Grenze höchstens 40 % entfernt, Chance mindestens 40 %.

**Gleiche Rechnung in App und Training:** Einstieg, Zone, Stop und Ziel kommen in Chancen, Training und Turnier aus derselben Analyse (Elliott-Wellen, Zonen, Volumen/RSI). Unterschied: In Training und Turnier fehlen Firmenzahlen und Nachrichten, weil es dafür keine historischen Daten gibt.

**Chancen – Potenzial (Reihenfolge):** Chance bis zum Ziel in % (höchstens 60 % angerechnet) × Chance/Risiko (höchstens 4) × Signalstärke × Nähe zur Zone × gemessene Stärke der Signalart im Turnier (Grün 1, Rot 0,6, Blau 0,35). So stehen nicht automatisch die Werte mit dem höchsten Ziel oben, sondern die mit dem besten Verhältnis aus Chance, Risiko und Verlässlichkeit. **In die Chancen kommt nur die obere Hälfte nach Potenzial** bei Grün und Rot (Grundwert aus Chance, Chance/Risiko und Signalart mindestens 26 – im Turnier gleich; Blau hat stattdessen die Blau-Regel, sonst fiele jeder blaue Einstieg heraus). Getestet auf 191 Werten 1963–2026: +5,6 % statt +4,9 % pro Jahr; die Grenze wurde nur aus 1963–2005 bestimmt und hielt auf den Jahren ab 2006 (+10,2 % statt +8,1 %). Die Übersicht zeigt davon die Top 3. Suche in zwei Schritten: zuerst Chart, Wellen und Volumen für alle Werte, dann Firmenzahlen und Nachrichten nur für die 40 aussichtsreichsten (Watchlist und offene Trades immer vollständig). Gelernt wird weiter mit den 65 Trainings-Werten; die gelernten Einstellungen gelten je Anlageklasse für alle Werte.

## 2. Design

| Element | Wert |
|---|---|
| Hintergrund | Wappen `public/background.webp/.jpg`, fixiert, Schwarz `#050505`, dunkelrote Panels |
| Gold | `#c9a24a` (hell `#e3c57a`, dunkel `#8f7232`) |
| Wein/Rot | `#7a1420`, `#a32234` |
| Schriften | Überschriften **Cinzel**, Text **Inter** (Google Fonts), Zahlen tabellarisch |
| Signal Blau | `#38bdf8` (Rand `edge-core`, Badge `badge-core`) |
| Signal Grün | `#34d399` (`edge-trade`, `badge-trade`) |
| Signal Rot (Short) | `#f87171` (`edge-short`, `badge-short`) |
| Signal Gelb | Amber `#fbbf24` (`edge-wait`, `badge-wait`) |
| Grau (alt) | Stein-Grau, gestrichelte Box im Mini-Chart, Liste „Verlauf“ |
| Stop/Verlust | `#f87171` |

Watchlist und „Top 3 Chancen“ nutzen dieselbe kompakte Kachel (Signalart, Abstand zur Zone, Einstieg/Stop/Ziel); in der Watchlist zusätzlich mit Mini-Chart (Elliott-Wellen, erwartete Richtung, Zone, alte Einstiege grau). Antippen öffnet den vollständigen Einstieg mit „übernehmen“ und darunter die Analyse.

**Kerzenchart (Detailansicht)** wie bei HKCM: die letzten Monate, rechts freier Platz; Einstiege als Kästen (blau = Langfrist-Einstieg, grün = Zielzone, grau = alte mit Status und Datum); bei Grün Stop (rot) und Ziel (grün) als beschriftete Linien, dazu der erwartete Weg als Pfeil (rot in die Zone, grün zum Ziel). Volumen, RSI, Fibonacci-Linien und Alternativzählung nur in der Expertenansicht.

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
Zone = 61,8–78,6 % Rücksetzer der letzten Welle; Stop knapp hinter dem Wellenstart (+0,25 ATR); Ziel 1 = Fibonacci-Erweiterung (+27,2 %); Chance/Risiko mindestens 1,5. Shorts genauso spiegelverkehrt (Stop darüber, Ziel darunter); Zonen mit einem Ziel unter 0 werden verworfen. Ab Ziel 1 läuft der Stop mit (4 × ATR).

### 3.6 Szenario-Entscheidung: EIN Einstieg pro Wert (`bestEntry.ts`)
1. **Blau im Bereich** (Kurs schon im Langfrist-Bereich) hat Vorrang.
2. Sonst **Grün** aus dem besten erlaubten Zeitraum – Rangfolge nach gemessener Zonen-Quote:
   Aktien lang → mittel · Krypto mittel → lang · Rohstoffe kurz → lang → mittel.
3. Sonst **Blau zulaufend**.
4. Sonst **Gelb** mit Hinweis (z. B. „Der Chart zeigt fallende Kurse – Blacktrader wartet …“).

Regeln:
- **Shorts (rot) nur bei bärischem Gesamtmarkt** (S&P 500 unter der 200-Tage-Linie und −5 % in 100 Tagen). Die Sektor-Regel betrifft nur grüne Tech-Trades, nicht rote Shorts.
- **Aktien und Krypto ohne kurzfristige Signale.** Rohstoffe kurzfristig nur, wenn der S&P 500 bullisch ist (über der 200-Tage-Linie und +5 % in 100 Tagen).
- **Sektor-Regel:** Liegt der NASDAQ 100 unter seiner 200-Tage-Linie, gibt es keine grünen Tech-Trades. Blaue Einstiege, Dividendenwerte und Rohstoffe bleiben.

### 3.7 Verlauf (grau)
Ein blauer Bereich wird ab dem Hoch von Welle 1 geprüft – nicht erst ab dem Zeitpunkt, an dem die App ihn zum ersten Mal gezeigt hat. Ist der Kurs schon eingetaucht und oben wieder herausgelaufen, ist er sofort grau („erledigt“ mit Datum). Liegt der Schlusskurs gerade wieder im Bereich, bleibt er aktiv.

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

Der Trainer hat zwei Teile – beide laufen im Browser (Web Worker), die App bleibt bedienbar.

### 4.1 Lernen (unverändert streng)
**Lernt** (je Anlageklasse × Zeitraum, `params.ts`): Gewichtung in Grenzen, Mindeststärke (darf nur steigen), Elliott-Übereinstimmung, Welle-5-Filter, Bestätigung durch den höheren Zeitraum, Welle-5-Ausstieg. Trainiert werden immer **alle** Bereiche (Aktien, Krypto, Rohstoffe) – es gibt keinen Klassen-Umschalter mehr. Aktien- und Krypto-Kurzfrist werden nicht trainiert (Blacktrader nutzt sie nicht).

**Gesperrt** (`locked-config.ts`, eingefroren, durch Tests abgesichert): Methode, Elliott-Regeln, Gewichtungsgrenzen (Elliott ≥ 60 %), Risiko-Logik (Zone, Stop, CRV ≥ 1,5), Annahmeregeln (≥ 200 Signale, Signale/Monat höchstens −40 %, Gewinnfaktor und Drawdown nicht schlechter).

**Messung:** Zonen-Quote wie HKCM, Walk-Forward mit gesperrten Testdaten (letzte 12 Monate). Gespeichert wird nur, was dort besser ist – und **kein Zufall** ist: (1) die höhere Quote muss statistisch gesichert sein (einseitiger Test, 95 % Sicherheit), (2) sie muss in mindestens 3 von 4 Prüfzeiträumen auftreten, nicht nur in einem. Dazu wie bisher mindestens 200 Zonen, Gewinnfaktor nicht niedriger, Rückgang nicht größer, höchstens −40 % Signale pro Monat. Das gilt für das Training, das Lernen im Turnier und die Prüfung beim Server.

### 4.2 Turnier: Blacktrader gegen 9 Gegner (10 Teilnehmer)
Nach jedem Training (oder „Nur Turnier“) tritt Blacktrader gegen neun Analysten/Bots an:

| Gegner | Regel |
|---|---|
| Zufalls-Bot | kauft an zufälligen Tagen, hält 20 Tage |
| Kaufen & Halten | kauft jeden Monat, hält ein halbes Jahr |
| Trendfolger | kauft über der 200-Tage-Linie, verkauft darunter |
| RSI-Bot | kauft bei RSI < 30, verkauft bei Erholung (RSI > 55, 20 Tage oder −10 %) |
| MACD-Bot | kauft beim MACD-Kreuz nach oben, verkauft beim Kreuz nach unten |
| Ausbruchs-Bot | kauft beim 55-Tage-Hoch, verkauft beim 20-Tage-Tief (Turtle) |
| Bollinger-Bot | kauft unter dem unteren Bollinger-Band (20 Tage, 2 Standardabweichungen), verkauft an der Mittellinie (spätestens nach 20 Tagen oder bei −10 %) |
| Momentum-Bot | kauft am Monatsanfang Werte mit +10 % in 6 Monaten über der 50-Tage-Linie, hält einen Monat |
| KI-Bot | logistische Regression, lernt jedes Jahr nur mit bereits bekannten Ergebnissen |

**Fair, ohne Tricks:** gleiche Werte (alle Aktien, Krypto, Rohstoffe), gleiche Zeiträume, nur Kauf-Einstiege, Ein- und Ausstieg zum Eröffnungskurs der nächsten Kerze, jedes Signal kennt nur die Vergangenheit (Tests prüfen: abgeschnittene Zukunft ändert keine früheren Trades).

**Ein Versuch = 5 Jahre echte Zeit:** 8.000 € Startkapital, 500 € je Trade (nur wenn genug Geld da ist; je Wert höchstens eine Position, also höchstens 15 Trades gleichzeitig), **7,90 € Gebühr je Order** (flatex, Kauf und Verkauf je einmal; die KESt rechnet mit dem Kursgewinn ohne Abzug der Spesen, wie in Österreich), nur Signale aus der oberen Hälfte nach Potenzial, **27,5 % KESt sofort bei jedem Verkauf mit Gewinn** (100 € → 110 €: 2,75 € KESt). Ein Verlust im selben Kalenderjahr holt bereits bezahlte KESt anteilig zurück (automatischer Verlustausgleich der österreichischen Bank); ins nächste Jahr wird nichts übertragen. Offene Positionen werden am Ende zum Tageskurs bewertet und versteuert. **Wer kein Geld mehr für einen Trade hat und keine Position mehr hält, scheidet aus.** **Blau-Regel auch im Turnier** (wie in den Chancen): blaue Einstiege nur mit Ungültig-Grenze höchstens 40 % und Chance mindestens 40 %. Getestet neutral; eingebaut, damit Chancen und Turnier gleich handeln. **Sie ist wieder entfernbar** (`BLUE_RULE.enabled` in `src/lib/analysis/potential.ts`): Jedes Turnier rechnet zur Kontrolle auch ohne die Regel und schreibt in die Auswertung, wenn Blacktrader ohne sie besser wäre – dann soll sie wieder raus. Zum Vergleich (handelt nicht mit) steht unter der Rangliste ein echter S&P-500-ETF (iShares Core, SXR8, Euro, thesaurierend): alles kaufen, 5 Jahre liegen lassen.

**50 Versuche** mit gleichmäßig verteilten Startzeitpunkten in den letzten 15 Jahren – für alle Teilnehmer dieselben. Jeder Zeitraum wird nach der Marktlage des S&P 500 eingeordnet: **bärisch** (≥ 15 % Bärentage, also mit Crash/Bärenmarkt 2015/16, 2018, 2020 oder 2022), **bullisch** (≥ 55 % Bullentage), **neutral** (< 45 % Bullentage), sonst **gemischt**.

**Gewertet wird der Durchschnitt der 50 Versuche:** Rendite pro Jahr (danach die Rangliste), Anzahl Trades in 5 Jahren, Gewinn nach KESt, bezahlte KESt, Trefferquote, wie oft ausgeschieden – gesamt und je Szenario.

**Blacktrader lernt dabei:** Das Turnier läuft in 5 Runden zu je 10 Versuchen (jede Runde mit gemischten Zeiträumen). Vor jeder Runde lernt Blacktrader ein Fünftel der eingestellten Zeit (bei 15 Min also 3 Min) – mit denselben Strenge-Regeln wie im Training; Verbesserungen werden **sofort gespeichert** und die nächste Runde wird mit dem neuesten Stand gespielt. Die Auswertung zeigt Runde 1 → Runde 5 und Blacktrader getrennt nach Blau und Grün. „Nur Turnier ohne Lernen“ spielt alle Runden mit dem aktuellen Stand.

**Auswertung:** Rangliste, Blacktrader je Szenario, je Runde, nur Blau / nur Grün, im Lernen verbesserte Bereiche und Vergleich zur letzten Auswertung. Gespeichert auf dem Gerät und beim Server (`/api/trainer/report`, letzte 20), im JSON-Export enthalten.

**Ehrlicher Hinweis:** Auch „bärische“ Phasen der letzten 15 Jahre wurden meist schnell wieder aufgeholt; Kauf-Strategien schneiden dort deshalb oft gut ab. Ergebnisse der Vergangenheit sind keine Garantie.

**Speicher Lernstände:** je Zelle eigener Schlüssel (`trainer:aktien:mittel` …) mit Sperre auf dem Server (Upstash/Vercel KV) **und** sofort eine lokale Kopie; der jüngere Stand gewinnt.

## 4.3 Alles in Euro

- **Anzeige:** Kurse, Zonen, Stops, Ziele, Begründungen, Nachrichten und die Preisachse im Chart werden für Werte in Dollar (bzw. GBP/CHF) zum aktuellen Wechselkurs in Euro umgerechnet (`src/lib/fx.ts`, Kurse EUR/USD, EUR/GBP, EUR/CHF von Yahoo, alle 30 Minuten, auf dem Gerät zwischengespeichert).
- **Depot:** Beim Kauf wird der Wechselkurs gemerkt (`fxEntry`), beim Verkauf ebenso (`fxExit`). Die Rendite ist die Rendite in Euro: Kursrendite × Wechselkursänderung. Ältere Trades ohne gemerkten Kurs zeigen die Kursrendite. Manuelles Schließen: Ausstiegskurs in Euro.
- **Turnier:** jeder Trade mit dem Euro/Dollar-Kurs am Kauf- und Verkaufstag; offene Positionen am Ende ebenso.
- **Die Wellenzählung** läuft weiter auf dem Originalkurs der Börse (z. B. Apple in $) – wie bei HKCM und allen Elliott-Analysten; ein umgerechneter Chart würde die Wellen durch Wechselkurs-Schwankungen verfälschen.

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

Alle Daten liegen im Browser (`black-ship-trading-analyst:v1`). Das Journal heißt jetzt **Depot** (Adresse `/depot`, `/journal` leitet weiter); die Daten sind dieselben. Beim ersten Start nach dem Blacktrader-Update wird ein **JSON-Backup** angelegt (`…:backup:<Datum>-vor-blacktrader`); Trades, Watchlist und Einstellungen bleiben unverändert. Offene Trades behalten ihren alten Zeitraum als Info-Label. Export/Import als JSON unter Einstellungen.

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

Chronologischer Test Sep 2022 – Nov 2026, 5.000 € Startkapital, nach 27,5 % KESt (Österreich): Blacktrader mit Sektor-Regel 9.859 € (+97,2 %), ohne Sektor-Regel 9.155 € (+83,1 %), Zufall 8.483 € (+69,7 %), S&P 500 Kaufen-und-Halten 8.103 € (+62,1 %), KI 7.725 € (+54,5 %), RSI 7.359 € (+47,2 %), Trendfolger 6.631 € (+32,6 %).

Turnier in Euro (10 Teilnehmer, 50 Versuche à 5 Jahre, KESt sofort je Gewinn, Standard-Einstellung, Ø pro Jahr): **1. Blacktrader +21,8 %** (Ø 176 Trades, Ø Gewinn nach KESt 9.293 €) · 2. MACD-Bot +20,9 % · 3. Kaufen & Halten +19,4 % · 4. Trendfolger +16,8 % · 5. Ausbruchs-Bot +16,7 % · 6. Momentum-Bot +16,1 % · 7. Zufalls-Bot +10,6 % · 8. KI-Bot +8,4 % · 9. RSI-Bot +4,0 % · 10. Bollinger-Bot −0,3 %. Niemand ist ausgeschieden. Hinweis: Der Euro fiel im Zeitraum von 1,38 auf 1,12 Dollar – Dollar-Werte bekamen dadurch Rückenwind, am meisten bei langen Haltedauern.
**Ehrlicher Hinweis:** überwiegend steigende Märkte; der Vorsprung vor Zufall ist im chronologischen Test klein. Bei Krypto ist der Gewinnfaktor trotz höherer Quote schwach.


## Depot

**Blacktrader-Konto:** 8.000 € Startkapital, 500 € je Trade, 7,90 € Gebühr je Order (Langfrist: je ausgeführter Teil-Order), 27,5 % KESt sofort auf Gewinne mit Verlusttopf im selben Kalenderjahr (Verluste holen bezahlte KESt zurück oder werden mit späteren Gewinnen desselben Jahres verrechnet). Angezeigt werden Kontostand, Gewinn in € und % vom Start, freies und gebundenes Geld, Gebühren, KESt, Trefferquote. Reicht das freie Geld nicht für 500 € + Gebühr, kann kein neuer Trade übernommen werden (Hinweis in der App; „Alle übernehmen“ in den Chancen nimmt nur so viele, wie das Geld reicht). Ohne Geld und ohne offene Position ist das Konto leer: Neustart mit 8.000 €, die alten Trades bleiben als frühere Runde sichtbar. Das Turnier rechnet ebenfalls mit 8.000 € Startkapital.

**Buy & Hold:** eigene Käufe von Aktien und ETFs, unabhängig von Blacktrader. Eingabe je Kauf/Verkauf: Datum, Preis je Stück in €, Stückzahl, Gebühr (Standard 7,90 €). Verkauft wird nur, wenn du es einträgst. Kurs jetzt: Börsenkurs in Euro (jede Minute). KESt geschätzt wie in Österreich: gleitender Durchschnittspreis, Gebühren nicht abziehbar, Gewinne und Verluste eines Jahres verrechnet.

## Order-Zettel, Stop-Erinnerung, Live-Bilanz, Sicherung

**Order-Zettel für flatex:** Beim Übernehmen zeigt die App die Stückzahl für 500 € (Aktien/Rohstoffe ganze Stück so nah wie möglich an 500 €, bis zu 50 € darüber erlaubt; das Konto rechnet mit dem echten Betrag Stück × Kurs; Krypto Bruchteile; Blau: drei Teile à ca. 166,67 €) und alle Preise in Euro – mit „Kopieren“.

**Stop bei flatex anpassen:** Bei Dollar-Werten verschiebt sich der richtige Euro-Stop mit dem Wechselkurs, außerdem zieht Blacktrader Stops nach. Weicht der richtige Euro-Stop um mehr als 0,5 % vom eingetragenen ab, zeigt das Depot „Stop bei flatex anpassen: alt → neu“ (und meldet es einmal). „Erledigt“ antippen, sobald er bei flatex geändert ist.

**Live-Bilanz der Chancen:** Jede Chance aus der Liste wird ab dem ersten Erscheinen mitgeschrieben – auch nicht übernommene. Bei jeder Suche wird geprüft: Ziel nach dem Einstieg (Treffer), Stop (Blau: Schlusskurs unter der Ungültig-Grenze), verpasst (Ziel ohne Einstieg) oder läuft noch. Anzeige oben in den Chancen.

**Sicherung:** Die App fragt beim Browser dauerhaften Speicher an und speichert bei jedem neuen, geschlossenen oder geänderten Trade, beim Neustart des Kontos und bei Buy & Hold automatisch eine Sicherungsdatei in den Ordner „Downloads“ (abschaltbar unter Mehr → Backups). Dort auch „Jetzt sichern“ und „Aus Datei wiederherstellen“. Die Datei enthält Watchlist, Trades, Konto, Buy & Hold, Live-Bilanz und Einstiegs-Verlauf (ohne API-Schlüssel).

## Buy & Hold: Blacktrader schaut mit, Dividenden, Steuer, Wochenbericht, Kurs in Deutschland

- **Blacktrader schaut auf Buy & Hold:** Für jeden gehaltenen Wert zeigt die Karte den großen Trend (Wochenchart, Elliott) und den aktuellen Einstieg. Kippt der Trend nach unten, kommt einmal eine Nachricht – verkauft wird nichts.
- **Dividenden:** im Wert „Dividende eintragen“ (Datum, Betrag brutto in €). Zählen zum Gewinn und zur KESt.
- **Steuer-Jahresübersicht** (Depot, unten): Blacktrader-Trades, Buy-&-Hold-Verkäufe und Dividenden je Jahr verrechnet, 27,5 % KESt geschätzt.
- **Wochenbericht** (Übersicht, alle 7 Tage): Konto-Veränderung, neue Ergebnisse der Live-Bilanz, Chancen, Stops zum Anpassen, Buy-&-Hold-Warnungen; „Gelesen“ setzt die neue Vergleichsbasis.
- **Kurs in Deutschland:** bei US-Aktien zusätzlich der Euro-Kurs an Xetra (zum Vergleich mit gettex/Tradegate); die Analyse bleibt auf der US-Börse.
- **Prüfung der Szenario-Prozente** (84.034 Fälle, 191 Werte, Tag und Woche): Das Hauptszenario erreicht sein Ziel vor der Ungültig-Grenze in rund 46 % der Fälle – unabhängig vom angezeigten Anteil (50–55 %: 46,4 %; 60–70 %: 45,2 %; 80–90 %: 40,4 %). Die Prozente sind Regel-Passung, keine Eintrittswahrscheinlichkeit; die Leiste sagt das jetzt dazu.

**Zonen-Alarm (nur Watchlist):** Läuft der Kurs eines Watchlist-Werts in seinen Einstiegsbereich (blau, grün oder rot), kommt einmal eine Nachricht – nicht für Chancen (die ändern sich täglich) und nicht, wenn der Wert schon im Depot liegt. Beim allerersten Einschalten werden Werte, die schon in der Zone sind, still gemerkt.

## Update: ein Signal, neue grüne Box, Nachkauf nur Blau, Finanz-Prüfung

Getestet (Härtetest, 191 Werte, 1963–2026, 10 Mio. Durchgänge à 5 Jahre, 8.000 €, 500 € je Trade, 7,90 € je Order, KESt mit Verlusttopf, zweimal gerechnet – identisch): **+7,4 % statt +5,5 % pro Jahr netto**, schlechtester Durchgang −7,3 % statt −8,8 %, nie pleite; in Corona-Crash und Zinsschock 2022 Platz 1 von 15. ETF S&P 500 (Modell mit Dividenden): +7,9 %.

1. **Ein Signal wie in den Chancen** – auch im Turnier und im EchoChart: Läuft beim selben Wert ein wichtigeres Signal (Blau im Bereich, dann Woche vor Tag; Krypto Tag vor Woche), wird ein schwächeres nicht gehandelt. Das EchoChart rechnet Tages- und Wochenkerzen plus Blau im Hintergrund (keine Auswahl Kurz/Mittel/Lang mehr).
2. **Neue grüne Box:** von 61,8 % Rücksetzer bis 1 % über den Stop (Stop am Wellenstart). Gekauft wird an der Oberkante; tiefer in der Box günstiger.
3. **Nachkauf nur bei Blau:** Liegt ein Wert im Depot, gibt es keinen zweiten grünen/roten Trade. Bei einem weiteren blauen Bereich höchstens 4 Nachkäufe zu je 250 € (eine Order an der Oberkante).
4. **Finanz-Prüfung (Filter):** Aktien mit Schulden über dem Doppelten des Eigenkapitals UND (Geld verbrennen ODER Gewinnmarge schlechter als −20 % ODER Umsatz −30 % und mehr) kommen nicht in Chancen/Top 3 und bekommen keinen Einstieg; in Watchlist und Depot steht „Finanzen schwach“. Nur live – im Turnier/EchoChart nicht, weil es keine alten Firmenzahlen gibt (sonst Blick in die Zukunft).
5. **„Nachkauf möglich“ im Depot:** blaues Abzeichen bei der Position, mit neuem Bereich, „noch X von 4“ und Order-Zettel für 250 €.

## Live-Kontrolle

- **Stufe 1 (ab 100 Ergebnissen):** Die echte Trefferquote der Live-Bilanz wird mit der Erwartung aus der Vergangenheit verglichen – gleiche Definition (nach dem Einstieg zuerst Ziel gegen Stop), neue Regeln, 1963–2026: Grün 50,3 % (2.104 Fälle), Blau 59,7 % (129), Rot 19,1 % (152). Gewarnt wird nur bei sehr deutlicher Abweichung nach unten (z ≤ −2,5; ab 50 Ergebnissen je Farbe): rote Zeile in der Live-Bilanz und auf der Trainer-Seite, einmal eine Nachricht. Blacktrader ändert dabei nichts selbst.
- **Stufe 2 (ab 500 Ergebnissen):** Beim Lernen muss ein neuer Stand zusätzlich im Zeitraum seit Beginn der Live-Bilanz bestehen (Zonen-Quote nicht schlechter als der bisherige Stand, mindestens 30 Zonen). Vorher schläft die Prüfung; der Stand steht auf der Trainer-Seite.
- **Sicherung:** Die Live-Bilanz liegt lokal auf dem Gerät. Neue Ergebnisse werden höchstens einmal am Tag automatisch in eine Sicherungsdatei geschrieben (zusätzlich zu jeder Depot-Änderung).
