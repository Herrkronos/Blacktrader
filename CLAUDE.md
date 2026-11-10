# Hinweise für Claude (Blacktrader)

- Oberfläche auf Deutsch, einsteigerfreundlich. Feste Regeln nicht ändern: Elliott ≥ 60 %, Risiko-Logik, 500 € je Trade. Start: Depot-Konto 8.000 € (Wunsch des Nutzers), Turnier jetzt ebenfalls 8.000 € (Wunsch des Nutzers; ältere Tests liefen mit 5.000 €).
- Der Nutzer handelt bei flatex Österreich (Euro, Tradegate/gettex): 7,90 € je Order, 27,5 % KESt.
- Neue Regeln erst ausgiebig testen und den Nutzer fragen, bevor sie eingebaut werden.
- **Blau-Regel** (`BLUE_RULE` in `src/lib/analysis/potential.ts`): auf Wunsch des Nutzers in Chancen UND Turnier aktiv, obwohl
  im Test neutral. Sie soll **wieder entfernt werden, wenn sie schlechter wird** – das Turnier meldet das automatisch
  („Achtung Blau-Regel …“ in der Auswertung). Dann dem Nutzer vorschlagen, `enabled: false` zu setzen.
- Kein ETF im System – der S&P-500-ETF (SXR8) dient nur als Vergleich im Turnier.
- Haupt-/Alternativszenario-Leiste ist nur Anzeige. Die Idee „45–55 % = neutral, kein Einstieg“ hat der Nutzer verworfen.
- Depot hat zwei Reiter: „Blacktrader“ (Konto 8.000 €, 500 € je Trade, Gebühren, KESt, Sperre ohne Geld, Neustart nach Pleite als neue Runde) und „Buy & Hold“ (eigene Käufe: Datum, Preis je Stück in €, Stückzahl, Gebühr; verkauft nur auf Eingabe).
- Order-Zettel (Stück so nah wie möglich an 500 €, bis 50 € darüber erlaubt – Wunsch des Nutzers; Konto rechnet mit dem echten Betrag Stück × Kurs; Preise in €), Stop-Erinnerung flatex (>0,5 %), Live-Bilanz aller Chancen (chanceLog), automatische Sicherungsdatei bei jeder Trade-/Depot-Änderung (abschaltbar, Mehr → Backups).
- Szenario-Prozente sind NICHT kalibriert (Ziel vor Ungültig ~46 % unabhängig vom Anteil, 84.034 Fälle) – nicht als Wahrscheinlichkeit verkaufen.
- Zonen-Alarm nur für Watchlist-Werte (nicht für Chancen – Wunsch des Nutzers, zu viele Meldungen).
- KESt-Rechnung überall über analysis/kest.ts (KestYear: sofort auf Gewinne, Verlusttopf im Kalenderjahr, kein Vortrag).
- Update (getestet, Nutzer-OK): ein Signal wie in den Chancen auch in Turnier/EchoChart (tradeRules.suppressedBy); grüne Box bis 1 % über dem Stop (LOCKED.zone.bottomAboveStop); Nachkauf NUR bei Blau, max. 4 × 250 € (ADD / RULES.addMax/addStake, nachkauf.ts); eine Position je Wert sonst.
- Finanz-Filter (analysis/finance.ts) nur live, nicht im Turnier/EchoChart (keine historischen Firmenzahlen → kein Look-ahead).
- Härtetest-Skripte liegen nur im Scratchpad; Ergebnis: +7,4 %/J netto vs. bisher +5,5 %, ETF-Modell +7,9 %.
- Live-Kontrolle: Stufe 1 Warnung ab 100 Ergebnissen (liveCheck.ts, Erwartung Grün 50,3 / Blau 59,7 / Rot 19,1 %), Stufe 2 Live-Veto beim Lernen ab 500 (session.ts LIVE_LEARN_MIN, Worker liveVeto). Blacktrader lernt NICHT aus Nutzer-Handlungen.
- Turnier: 15 Gegner (opponents.ts: 5 Bots, 5 Bank-Analysten aus Yahoo-Einstufungen ab 2012/nur US, 5 Strategien), alle mit fairen Parameter-Bereichen; Champion + neue Varianten, Auswahl auf eigenen 3-Jahres-Zeiträumen, nie gegen Blacktrader abgestimmt; Champions in der Auswertung (opponents) → nächstes Turnier.
- Regelwerk (/regelwerk, rulebook.ts): A nie selbst ändern, B1–B7 (B7 = Turnier-Prüfung b7Check/tournamentVeto), C1 kleine Schritte (stepLimitErrors), C2 Versions-Hinweis, C3 Rückweg-Vorschlag bei Live-Warnung, C4 Live-Prüfung.
- Lernzeit ab 30 Min (15 Min entfernt, Wunsch des Nutzers); immer 5 Runden; Prüfen/Speichern (Live-Veto, B7) zählt NICHT zur Lernzeit, läuft obendrauf.
- Depot: Wert übernommen → aus der Watchlist entfernt (addTrade, pruneWatchHeld); Karte im Depot antippen → dieselbe Ansicht wie in der Watchlist (useAssetSheet, Einstieg oben + Chart/Analyse); blaue Teile immer sichtbar; Datum/Begründung/Aktionen über „Details & Aktionen“. Blaue Teile mit Stück, Betrag, Gesamt und „gekauft“ (TrancheList; tranches.qty/eur ab jetzt gespeichert). Turnier-Auswertung als Liste (reportItems), Rangliste „Ø p. a.“; Gegner-Beschreibungstext im Trainer entfernt (Wunsch des Nutzers).
- Detailansicht: „Langfristiger Einstieg“-Karte (LongTermCard) nicht zeigen, wenn schon eine offene Langfrist-Position besteht (Wunsch des Nutzers).
