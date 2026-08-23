"use client";

// Utility page (not linked): the agent's agentito, alone, at 640×640.
// Exists to photograph it with headless Chrome and generate the bot's avatar
// PNG when the naming happened before automatic capture existed.
//
// RIVE, not the static SVG: the static one is a simplified version (no
// glasses or accessories) and the photo came out "similar but not him" —
// verified 8/7 with Selastian. The cost is waiting for the canvas to load;
// headless uses a generous virtual-time-budget for that.
// Entered via the normal magic link (#key=...): with no key it shows nothing.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getManifest, loadConfig } from "../lib/agent";
import {
  AgentitoLoading, LOOK_DEFAULT, hasSavedLook, loadAgentLook,
  lookFromAgent, type AgentitoLook,
} from "../lib/agentito";

const AgentitoRive = dynamic(() => import("../lib/AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoLoading />,
});

// CANONICAL order of the axes for the #look= parameter (comma-separated).
const AXES_ORDER = ["tone", "antenna", "accessory", "pupil", "mouth", "skin", "suit", "brows"] as const;

export default function AvatarPage() {
  const [look, setLook] = useState<AgentitoLook | null>(null);

  useEffect(() => {
    // Deterministic path (headless): #look=4,1,1,0,2,0,0,1 — no network, no
    // adapter. This was the fix for the 8/7 bug: the manifest fetch failed
    // in headless and the photo came out with the default look (violet, no
    // glasses).
    const m = window.location.hash.match(/look=([\d,]+)/);
    if (m) {
      const vals = m[1].split(",").map(Number);
      const parsed = { ...LOOK_DEFAULT } as AgentitoLook;
      AXES_ORDER.forEach((axis, i) => {
        if (Number.isInteger(vals[i])) (parsed as Record<string, number>)[axis] = vals[i];
      });
      setLook(parsed);
      return;
    }
    const cfg = loadConfig();
    if (!cfg) return;
    getManifest(cfg)
      .then((mf) => setLook(lookFromAgent(mf.look) ?? (hasSavedLook() ? loadAgentLook() : LOOK_DEFAULT)))
      .catch(() => setLook(hasSavedLook() ? loadAgentLook() : LOOK_DEFAULT));
  }, []);

  if (!look) return null;
  return (
    <div
      id="avatar-ready"
      // OPAQUE BACKGROUND, mandatory: without this the PNG comes out
      // transparent and Telegram crushes it against BLACK — the face ends up
      // cropped over a black square. It's the same #FBFAFF that composes the
      // naming capture, so both paths give the same photo.
      style={{
        width: 640, height: 640, display: "grid", placeItems: "center",
        background: "#FBFAFF",
      }}
    >
      <div style={{ width: 560, height: 560 }}>
        <AgentitoRive celebrations={0} look={look} state="normal" className="h-full w-full" />
      </div>
    </div>
  );
}
