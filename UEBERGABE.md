# Übergabe an das Team – Blacktrader

Stand: 11.11.2026. Live-Version: https://blacktrader.vercel.app

## Wo der Code liegt

- **GitHub:** `herrkronos/blacktrader`
  - Branch **`claude/black-ship-trading-app-a74mmo`** ist die Live-Version (Vercel Production).
  - `blacktrader-update` hat denselben Stand. `main` ist älter.
- Ein ZIP-Archiv mit demselben Stand liegt bei, ohne `node_modules` und ohne Build-Ordner.

## Mit Claude Code (Cloud) weiterarbeiten

1. Das Repository `herrkronos/blacktrader` in Claude Code (claude.ai/code) auswählen.
   - Dafür braucht das Team Zugriff auf das GitHub-Repository: als Mitarbeiter einladen oder Repository übertragen bzw. forken.
2. **`CLAUDE.md` zuerst lesen.** Dort stehen alle festen Regeln und Wünsche des Nutzers. Claude Code lädt die Datei automatisch.
3. Wichtigste Regeln:
   - Neue Regeln erst testen, dann den Nutzer fragen.
   - Nur auf den Production-Branch pushen.
   - Vercel hat ein Tageslimit für Builds.

## Lokal starten

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # Vitest
npx next build  # Produktions-Build
```

Es gibt weder Login noch Datenbank. Alle Nutzerdaten liegen im Browser (localStorage) und lassen sich unter Mehr → Backups exportieren und importieren.

## Aufbau (kurz)

| Ordner | Inhalt |
|---|---|
| `src/app` | Seiten: Übersicht, Chancen, Watchlist, Depot, Mehr, Regelwerk; API-Routen für Kurse, Trainer und Push |
| `src/lib/analysis` | Elliott-Wellen, Blau/Grün/Rot-Zonen, Punkte, KESt |
| `src/lib/client` | Scanner, Depot-Konto, Order-Zettel, Langfrist-Positionen, Nachkauf |
| `src/lib/trainer` | Turnier, 15 Gegner, Lernen, Regelwerk |
| `src/lib/store` | Datenspeicher im Browser |
| `src/components` | Oberfläche |
| `tests` | Unit-Tests |

Ausführliche Beschreibung: `DOKUMENTATION.md`.

Die Härtetest-Skripte lagen nur im temporären Arbeitsordner und sind **nicht** im Repository. Die Ergebnisse stehen in `CLAUDE.md`.

## Vercel

Projekt mit dem GitHub-Repository verbinden. Framework: Next.js. Server-Region: `fra1` (siehe `vercel.json`).

Für Push-Meldungen braucht das Projekt Schlüssel als Umgebungsvariablen. Die Namen stehen im Vercel-Projekt bzw. unter `src/app/api/push`. Die Werte selbst gehören nicht in den Code.
