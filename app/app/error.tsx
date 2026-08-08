"use client";

// Red de contención del portal. Sin esto, cualquier error de render deja la
// pantalla BLANCA y sin menú: el cliente no tiene ni cómo volver ni a quién
// avisarle. Le pasó a un cliente de prueba el 8/8 (dos pestañas en blanco tras
// un redeploy) y su lectura fue la peor posible: "compré algo y no anda".
//
// El caso más común es el chunk viejo después de un deploy: eso lo ataja el
// script inline del layout raíz recargando una vez. Acá cae todo lo demás, y
// el copy no acusa al cliente ni le pide leer una consola.

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Btn, Soporte } from "./lib/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Queda en la consola para nosotros; al cliente no le mostramos el stack.
    console.error("[portal] error de pantalla:", error);
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
        {/* Navegación dura a propósito: si el estado del cliente quedó roto,
            un push del router se lleva el problema puesto. */}
        <Btn kind="secondary" size="sm" onClick={() => { window.location.href = "/app/inicio"; }}>
          Ir al inicio
        </Btn>
      </div>
      <Soporte className="mt-4" />
    </div>
  );
}
