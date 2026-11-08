"use client";
import Link from "next/link";

/** Schlanker Kopf (max. 56 px): Wappen + Markenname. */
export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-black/70 pt-[var(--safe-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-[var(--header-h)] max-w-3xl items-center gap-2.5 px-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Black Ship Holding – Übersicht">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <span className="font-display text-[17px] font-semibold text-gold">Black Ship Holding</span>
        </Link>
      </div>
    </header>
  );
}
