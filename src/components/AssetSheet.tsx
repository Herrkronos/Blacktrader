"use client";
import { useState } from "react";
import type { Horizon, ResolvedAsset } from "@/lib/types";
import { AssetDetailView } from "./AssetDetail";
import { Sheet } from "./Sheet";

type Target = { asset: ResolvedAsset & { id?: string }; horizon?: Horizon } | null;

/** Detailansicht als Bottom-Sheet. */
export function useAssetSheet() {
  const [target, setTarget] = useState<Target>(null);
  const sheet = (
    <Sheet open={!!target} onClose={() => setTarget(null)} title={target?.asset.name}>
      {target && <AssetDetailView key={`${target.asset.kind}:${target.asset.symbol}:${target.horizon}`} asset={target.asset} initialHorizon={target.horizon} />}
    </Sheet>
  );
  return { open: (asset: ResolvedAsset & { id?: string }, horizon?: Horizon) => setTarget({ asset, horizon }), sheet };
}
