import type { Metadata, Viewport } from "next";
import { Disclaimer } from "@/components/Disclaimer";
import { Header } from "@/components/Header";
import { ServiceWorker } from "@/components/ServiceWorker";
import { MarketProvider } from "@/lib/client/market";
import "./globals.css";

export const metadata: Metadata = {
  title: "Black Ship Holding – Trading Analyst",
  description: "Elliott-Wellen-, Fundamental- und Volumenanalyse mit Watchlist, Echtzeit-Signalen und Trade-Journal.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  appleWebApp: { capable: true, title: "Black Ship", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh antialiased">
        <MarketProvider>
          <Header />
          <main className="mx-auto w-full max-w-7xl px-3 pb-24 pt-4 sm:px-6">{children}</main>
          <Disclaimer />
        </MarketProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
