"use client";

// The portal's safety net. Without this, any render error leaves the screen
// BLANK with no menu: the client has no way back and nobody to tell. It
// happened to a test client on 8/8 (two blank tabs after a redeploy) and her
// read on it was the worst possible one: "I paid for something and it doesn't
// work."
//
// The most common case is a stale chunk after a deploy: the root layout's
// inline script catches that by reloading once. Everything else lands here,
// and the copy doesn't blame the client or ask them to read a console.

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Btn, Support } from "./lib/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Stays in the console for us; we don't show the client the stack trace.
    console.error("[portal] screen error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-c-amber">
        <AlertTriangle className="h-5 w-5 text-c-amber-ink" />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">Se nos rompió esta pantalla</p>
      <p className="mt-1 max-w-sm text-sm text-ink-soft">
        No es algo que hayas hecho vos, y tu agente sigue trabajando igual. Probá de nuevo;
        si vuelve a pasar, avisanos y lo miramos.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Btn size="sm" onClick={reset}>Probar de nuevo</Btn>
        {/* Hard navigation on purpose: if the client's own state got broken,
            a router push takes the problem along with it. */}
        <Btn kind="secondary" size="sm" onClick={() => { window.location.href = "/app/home"; }}>
          Ir al inicio
        </Btn>
      </div>
      <Support className="mt-4" />
    </div>
  );
}
