"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Watchlist" },
  { href: "/journal", label: "Journal" },
  { href: "/backtest", label: "Backtest" },
  { href: "/einstellungen", label: "Einstellungen" },
];

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-gold/20 bg-black/70 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div className="leading-tight">
            <div className="font-display text-sm font-bold tracking-[0.2em] text-gold sm:text-base">BLACK SHIP HOLDING</div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-stone-400">Trading Analyst</div>
          </div>
        </Link>
        <nav className="flex gap-1 overflow-x-auto text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/analyse") : path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 transition ${active ? "bg-gold/15 text-gold-light" : "text-stone-300 hover:text-gold-light"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
