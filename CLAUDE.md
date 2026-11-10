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
