"use client";

// /app: manda al primer módulo habilitado por el manifest.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadConfig, getManifest } from "./lib/agent";
import { MODULES } from "./layout";
import { Spinner } from "./lib/ui";

export default function AppIndex() {
  const router = useRouter();
  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) return; // el layout muestra el login
    getManifest(cfg).then((m) => {
      const first = MODULES.find((mod) => m.modules[mod.key]);
      if (first) router.replace(first.path);
    }).catch(() => { /* el layout muestra el error */ });
  }, [router]);
  return <Spinner />;
}
