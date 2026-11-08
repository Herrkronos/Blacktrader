"use client";
import { useRef, useState } from "react";
import { playTone, requestNotificationPermission } from "@/lib/client/alerts";
import { DEFAULT_WEIGHTS, normalizeWeights } from "@/lib/analysis/score";
import { actions, DEFAULT_SETTINGS, useAppData } from "@/lib/store/store";
import { HORIZON_INTERVALS, HORIZON_LABEL, type Horizon, type Interval } from "@/lib/types";

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="panel space-y-3 p-4">
      <div>
        <h2 className="panel-title">{title}</h2>
        {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function KeyInput({ label, value, onChange, href, placeholder }: { label: string; value: string; onChange: (v: string) => void; href?: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-xs text-stone-400">
      <span className="flex justify-between">
        {label}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-gold/80 hover:underline">
            kostenlosen Key holen
          </a>
        )}
      </span>
      <div className="mt-1 flex gap-2">
        <input className="input" type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder ?? "optional"} autoComplete="off" spellCheck={false} />
        <button type="button" className="btn px-2 text-xs" onClick={() => setShow(!show)}>
          {show ? "verbergen" : "zeigen"}
        </button>
      </div>
    </label>
  );
}

export default function SettingsPage() {
  const s = useAppData((d) => d.settings);
  const counts = useAppData((d) => ({ w: d.watchlist.length, t: d.trades.length }));
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [withKeys, setWithKeys] = useState(false);
  const nw = normalizeWeights(s.weights);

  const exportFile = () => {
    const blob = new Blob([actions.exportJson(withKeys)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `black-ship-trading-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (f: File) => {
    try {
      actions.importJson(await f.text());
      setMsg("Import erfolgreich.");
    } catch (e) {
      setMsg(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-[22px] text-gold">Einstellungen</h1>

      <Section title="Ansicht" hint="Einfache Ansicht: kurze, verständliche Sätze ohne Fachbegriffe. Expertenansicht: zusätzlich Wellenzählung, Fibonacci-Linien, Volumen-/RSI-Details.">
        <label className="flex items-center gap-2 text-sm text-stone-200">
          <input type="checkbox" className="accent-[#C9A24A]" checked={s.expertMode} onChange={(e) => actions.setSettings({ expertMode: e.target.checked })} />
          Expertenansicht anzeigen
        </label>
        <label className="flex min-h-[44px] items-center gap-3 text-[15px] text-stone-200">
          <input type="checkbox" className="h-5 w-5 accent-[#C9A24A]" checked={s.haptics} onChange={(e) => actions.setSettings({ haptics: e.target.checked })} />
          Vibration bei Alarm und Trade-Übernahme (Android)
        </label>
      </Section>

      <Section title="Gewichtung des Gesamtscores" hint="Gesamtscore = Elliott × w₁ + Fundamental/News × w₂ + Volumen/RSI × w₃. Standard 60 / 20 / 20. Die Werte werden auf 100 % normiert.">
        {(["elliott", "fundamental", "volume"] as const).map((k) => (
          <label key={k} className="block text-sm">
            <div className="flex justify-between text-stone-300">
              <span>{k === "elliott" ? "Elliott-Wellen" : k === "fundamental" ? "Fundamental & News" : "Volumen & RSI"}</span>
              <span className="num text-gold-light">{Math.round(nw[k] * 100)} %</span>
            </div>
            <input type="range" min={0} max={100} step={5} value={s.weights[k]} onChange={(e) => actions.setSettings({ weights: { ...s.weights, [k]: Number(e.target.value) } })} className="w-full accent-[#C9A24A]" />
          </label>
        ))}
        <button className="btn text-xs" onClick={() => actions.setSettings({ weights: DEFAULT_WEIGHTS })}>
          Auf 60 / 20 / 20 zurücksetzen
        </button>
      </Section>

      <Section title="Zeithorizonte & Kerzen" hint="Die gesamte Analyse wird pro Horizont getrennt berechnet. Hier legst du die Standard-Kerzengröße je Horizont fest.">
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(HORIZON_INTERVALS) as Horizon[]).map((h) => (
            <div key={h} className="text-sm">
              <div className="mb-1 text-stone-300">{HORIZON_LABEL[h]}</div>
              <div className="flex gap-1">
                {HORIZON_INTERVALS[h].map((iv: Interval) => (
                  <button key={iv} onClick={() => actions.setSettings({ intervals: { ...s.intervals, [h]: iv } })} className={`chip ${s.intervals[h] === iv ? "border-gold bg-gold/20 text-gold-light" : "border-stone-700 text-stone-400"}`}>
                    {iv}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Echtzeit & Alarme">
        <label className="block text-sm">
          <div className="flex justify-between text-stone-300">
            <span>Polling-Intervall Aktien</span>
            <span className="num text-gold-light">{s.pollSeconds} s</span>
          </div>
          <input type="range" min={15} max={60} step={5} value={s.pollSeconds} onChange={(e) => actions.setSettings({ pollSeconds: Number(e.target.value) })} className="w-full accent-[#C9A24A]" />
        </label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-[#C9A24A]"
              checked={s.notifications}
              onChange={async (e) => {
                if (e.target.checked) {
                  const p = await requestNotificationPermission();
                  if (p !== "granted") {
                    setMsg(p === "unsupported" ? "Dieser Browser unterstützt keine Benachrichtigungen." : "Benachrichtigungen wurden im Browser abgelehnt.");
                    return;
                  }
                }
                actions.setSettings({ notifications: e.target.checked });
              }}
            />
            Benachrichtigungen bei neuen Signalen, Zielen und Stops
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-[#C9A24A]" checked={s.sound} onChange={(e) => actions.setSettings({ sound: e.target.checked })} />
            Signalton
          </label>
          <button className="btn text-xs" onClick={() => playTone("buy")}>
            Ton testen
          </button>
        </div>
        <label className="block text-sm text-stone-300">
          Trades automatisch schließen bei
          <select className="input mt-1 w-auto" value={s.closeAtTarget} onChange={(e) => actions.setSettings({ closeAtTarget: e.target.value as "first" | "last" })}>
            <option value="first">erstem Kursziel</option>
            <option value="last">letztem Kursziel</option>
          </select>
        </label>
        <p className="text-xs text-stone-500">Alarme und Trade-Verfolgung laufen, solange die App in einem Tab geöffnet ist.</p>
      </Section>

      <Section title="Optionale API-Keys" hint="Alles funktioniert ohne Keys. Keys werden ausschließlich lokal in deinem Browser gespeichert und nur an den jeweiligen Anbieter durchgereicht.">
        <div className="grid gap-3 sm:grid-cols-2">
          <KeyInput label="Finnhub (Fundamentaldaten, Company-News, US)" value={s.keys.finnhub} onChange={(v) => actions.setKeys({ finnhub: v })} href="https://finnhub.io/register" />
          <KeyInput label="Alpha Vantage (Fundamentaldaten, US)" value={s.keys.alphavantage} onChange={(v) => actions.setKeys({ alphavantage: v })} href="https://www.alphavantage.co/support/#api-key" />
          <KeyInput label="OpenFIGI (höheres Limit für ISIN-Auflösung)" value={s.keys.openfigi} onChange={(v) => actions.setKeys({ openfigi: v })} href="https://www.openfigi.com/api" />
        </div>
        <div className="grid gap-3 border-t border-gold/10 pt-3 sm:grid-cols-3">
          <label className="text-xs text-stone-400">
            LLM-Anbieter (optional)
            <select className="input mt-1" value={s.keys.llmProvider} onChange={(e) => actions.setKeys({ llmProvider: e.target.value as "anthropic" | "openai" })}>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <KeyInput label="LLM-API-Key" value={s.keys.llm} onChange={(v) => actions.setKeys({ llm: v })} />
          <label className="text-xs text-stone-400">
            Modell (leer = Standard)
            <input className="input mt-1" value={s.keys.llmModel} onChange={(e) => actions.setKeys({ llmModel: e.target.value.trim() })} placeholder={s.keys.llmProvider === "anthropic" ? "claude-sonnet-5-5" : "gpt-4o-mini"} />
          </label>
        </div>
        <p className="text-xs text-stone-500">Mit LLM-Key erscheint auf der Analyse-Seite „Mit LLM ausformulieren“. Ohne Key werden die Texte regelbasiert erzeugt.</p>
      </Section>

      <Section title="Daten: Export / Import" hint={`Lokal gespeichert: ${counts.w} Werte in der Watchlist, ${counts.t} Trades.`}>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={exportFile}>
            Als JSON exportieren
          </button>
          <label className="flex items-center gap-1 text-xs text-stone-400">
            <input type="checkbox" className="accent-[#C9A24A]" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} />
            inkl. API-Keys
          </label>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            JSON importieren
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button
            className="btn-danger"
            onClick={() => {
              if (window.confirm("Alle lokalen Daten (Watchlist, Trades, Einstellungen) löschen?")) actions.reset();
            }}
          >
            Alles zurücksetzen
          </button>
        </div>
        {msg && <p className="text-sm text-gold-light">{msg}</p>}
      </Section>
      <p className="text-center text-[13px] text-stone-600">Standardwerte: Polling {DEFAULT_SETTINGS.pollSeconds} s · Gewichtung 60/20/20</p>
    </div>
  );
}
