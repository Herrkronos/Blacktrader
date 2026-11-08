export function Disclaimer() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <p className="pointer-events-auto rounded-full border border-gold/20 bg-black/80 px-4 py-1.5 text-center text-[11px] text-stone-400 backdrop-blur">
        Keine Anlageberatung. Analysen können falsch sein. Handel auf eigenes Risiko.
      </p>
    </div>
  );
}
