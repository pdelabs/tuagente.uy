"use client";

// Piezas compartidas de las pantallas de bienvenida por módulo.
// A propósito son MÍNIMAS: cada módulo arma su propia composición y su propia
// ilustración — no queremos ocho pantallas iguales con distinto texto.
// Marca tuagente: violeta #5B4BE8, tonales, Jakarta (global), radios generosos.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Btn } from "../ui";

export type IntroProps = { onOk: () => void };

/** Contenedor de la pantalla: centra, limita el ancho y pone el CTA al final. */
export function IntroPage({ children, onOk, cta = "Empezar", note }: {
  children: ReactNode;
  onOk: () => void;
  cta?: string;
  note?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-3xl">
        {children}
        {/* flex-wrap: en pantallas muy angostas la nota baja en vez de
            aplastar el botón (el Btn tiene ancho mínimo propio). */}
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Btn onClick={onOk}>{cta}</Btn>
          {note && <span className="text-[12px] text-ink-soft">{note}</span>}
        </div>
      </div>
    </div>
  );
}

/** EL MARCO DE LAS ILUSTRACIONES. Toda maqueta va acá adentro.
 *
 *  POR QUÉ EXISTE. Una clienta de prueba entró a Conexiones, vio los tildes
 *  verdes que dibujaba la bienvenida al lado de Telegram, del correo de su
 *  empresa y de sus planillas, y entró convencida de que ya tenía todo
 *  enchufado. No tenía nada. La ilustración usaba el mismo hairline, el mismo
 *  blanco y los mismos tonales que la pantalla de verdad: no había forma de que
 *  se diera cuenta. «Es obvio que es un ejemplo» no es una defensa — no lo fue.
 *
 *  Este marco lo dice de tres maneras a la vez, porque una sola se pasa por
 *  alto: el borde PUNTEADO (el portal de verdad no usa ninguno), el rótulo
 *  «Ejemplo», y una línea corta que aclara qué es lo que no es suyo («no son
 *  tus tareas»). La aclaración no es opcional cuando el dibujo muestra algo que
 *  el cliente podría leer como propio: tareas, archivos, números, movimientos.
 *
 *  Y LA REGLA QUE NO SE VE: adentro de una maqueta no va nada que parezca un
 *  control. Ni un campo de texto, ni un botón, ni un chip que invite a tocarlo.
 *  La misma clienta escribió «hola» en el compositor dibujado de la bienvenida
 *  del chat y se quedó esperando una respuesta que no iba a llegar. Lo que se
 *  dibuja se mira; lo único que se toca en estas pantallas es el botón del pie,
 *  que es de verdad.
 *
 *  La otra salida —cuando el portal YA SABE el estado real— es no dibujar nada
 *  y mostrar el dato (ver la bienvenida de Conexiones). Un dibujo nunca puede
 *  afirmar un estado del cliente. */
export function Maqueta({ nota, className = "", children }: {
  nota?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className={`rounded-card border border-dashed border-black/[0.18] p-3 sm:p-4 ${className}`}>
      <figcaption className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
          Ejemplo
        </span>
        {nota && <span className="text-[11px] leading-snug text-ink-soft">{nota}</span>}
      </figcaption>
      {/* Para un lector de pantalla el dibujo es ruido: lo que cuenta qué hay
          acá adentro es el texto que lo acompaña. */}
      <div aria-hidden>{children}</div>
    </figure>
  );
}

/** Un paso de un "cómo funciona": ícono + texto, SIN cápsula ni borde.
 *
 *  Antes eran pastillas blancas con borde — o sea, botones. «Pedís la conexión»
 *  y «Correr ahora» son además los nombres de controles que existen de verdad
 *  en esas pantallas: dibujarlos con forma de botón es prometer un clic que
 *  acá no pasa nada. */
export function Paso({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
      {children}
    </span>
  );
}

export function Eyebrow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-c-violet px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
      <Icon className="h-3 w-3" />
      {children}
    </p>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink">
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-soft">{children}</p>;
}

/** Fila de "qué podés hacer acá": ícono + texto, sin viñetas genéricas. */
export function Point({ icon: Icon, title, children }: {
  icon: LucideIcon; title: string; children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.04]">
        <Icon className="h-3.5 w-3.5 text-ink-soft" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{children}</p>}
      </div>
    </div>
  );
}
