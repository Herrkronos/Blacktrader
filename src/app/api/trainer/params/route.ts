// Aktuell gültige gelernte Werte (für alle Nutzer gleich). Klein und vom CDN zwischengespeichert.
import { handle } from "@/lib/data/route-helpers";
import { loadState } from "@/lib/trainer/server";
import { currentVersion } from "@/lib/trainer/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(
    req,
    async () => {
      const v = currentVersion(await loadState());
      return { version: v.id, params: v.params };
    },
    300,
  );
}
