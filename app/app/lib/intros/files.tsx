"use client";

// Bienvenida de "Archivos".
// Composición: mesa de trabajo del agente a la izquierda (pila de archivos +
// visor abierto) y los tres puntos a la derecha. Ilustración en divs, sin
// imágenes externas; la animación de entrada respeta prefers-reduced-motion.
//
// "informe-mensual.md · 14 KB · hace 2 h" tiene la forma exacta de un archivo
// de verdad —nombre, peso, cuándo—, así que la pila va adentro de `Maqueta`:
// tres archivos inventados en la pantalla que promete mostrar los tuyos son
// tres archivos que alguien va a ir a buscar.
//
// ESTA BIENVENIDA DECÍA "SOLO LECTURA" Y DEJÓ DE SER CIERTO. La pestaña ahora
// tiene subida propia: botón en el encabezado, se puede soltar un archivo en
// cualquier parte de la pantalla y lo que cae queda en `entrada/`, el buzón,
// que subió al segundo lugar de la raíz. Salió de la misma prueba a ciegas que
// el resto: "falta una pantalla que no existe: dónde meto YO mis papeles; si
// quiero darle mi planilla tengo que encontrar el clipcito del chat".
//
// PERO NO TODOS LOS AGENTES LA TIENEN, y prometerla es peor que no nombrarla:
// el cliente busca un botón que no está y cree que se le rompió algo. La subida
// sale sólo si el manifiesto declara `modules.upload` — la MISMA condición que
// usa la pestaña (`sePuedeSubir`), así que lo que promete esta pantalla y lo
// que aparece en la siguiente no se pueden separar. Es la salida de la
// bienvenida de Conexiones aplicada al mismo problema: si el portal puede saber
// la verdad, la pregunta, y mientras no la sabe no afirma nada en ninguna de
// las dos direcciones.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Code2, Download, Eye, FileCode2, FileSpreadsheet, FileText, FolderOpen, Inbox,
  Lock, MessagesSquare, Upload, Wrench, type LucideIcon,
} from "lucide-react";
import { getManifest, loadConfig } from "../agent";
import { IntroPage, Eyebrow, Title, Lead, Maqueta, Paso, Point, type IntroProps } from "./shell";

const CSS = `
@keyframes tgf-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
.tgf-in { animation: tgf-in .5s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .tgf-in { animation: none; } }
`;

/* ── ¿Este agente acepta que le dejes algo? ──────────────────────────────── */

/** `null` mientras no se sabe: ahí no se dice ni que sí ni que no.
 *
 *  Si el manifiesto no contesta, la respuesta es NO: es la misma regla que la
 *  pestaña (ante la duda no se ofrece la subida), y tiene que ser la misma o la
 *  bienvenida termina prometiendo un botón que la pantalla no va a dibujar. */
function useSubidaDeclarada(): boolean | null {
  const [puede, setPuede] = useState<boolean | null>(null);

  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) { setPuede(false); return; }
    let vivo = true;
    getManifest(cfg)
      .then((m) => { if (vivo) setPuede(m?.modules?.upload === true); })
      .catch(() => { if (vivo) setPuede(false); });
    return () => { vivo = false; };
  }, []);

  return puede;
}

/* ── La ilustración ──────────────────────────────────────────────────────── */

type Row = { name: string; meta: string; icon: LucideIcon; tone: string; open?: boolean };

// Tres extensiones bien distintas, cada una con su ícono y su tonal.
const ROWS: Row[] = [
  {
    name: "informe-mensual.md",
    meta: "14 KB · hace 2 h",
    icon: FileText,
    tone: "bg-c-violet text-c-violet-ink",
    open: true,
  },
  {
    name: "listado-final.csv",
    meta: "86 KB · ayer",
    icon: FileSpreadsheet,
    tone: "bg-c-green text-c-green-ink",
  },
  {
    name: "procesar.py",
    meta: "4 KB · hace 3 días",
    icon: FileCode2,
    tone: "bg-c-amber text-c-amber-ink",
  },
];

/** Una línea de texto "renderizado" del visor. */
function Line({ w }: { w: string }) {
  return <div className={`h-1.5 rounded-full bg-black/[0.09] ${w}`} />;
}

/** Un token del bloque de código (fondo oscuro, resaltado tonal). */
function Tok({ w, tone }: { w: string; tone: string }) {
  return <div className={`h-1.5 rounded-full ${tone} ${w}`} />;
}

// min-w-0 en la raíz: sin eso la celda del grid se agranda hasta el nombre de
// archivo más largo (el truncate solo no alcanza) y el portal queda con scroll
// lateral. Por lo mismo, los anchos de adentro van en % y no en píxeles.
//
// `conBuzon` dibuja arriba de la pila la carpeta `entrada/`, que es donde caen
// los archivos del cliente. No se dibuja cuando el agente no declara la subida:
// sería una carpeta que en su pantalla no existe.
function Workspace({ conBuzon }: { conBuzon: boolean }) {
  return (
    <Maqueta
      className="min-w-0 bg-gradient-to-br from-c-violet/70 via-white to-c-green/25"
      nota={conBuzon
        ? "Carpetas y archivos inventados: no son los tuyos."
        : "Archivos inventados: no son los tuyos."}
    >
      {conBuzon && (
        <div className="tgf-in mb-1.5 flex items-center gap-2.5 rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-c-green text-c-green-ink">
            <Inbox className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-ink">entrada</span>
            <span className="block truncate text-[10px] text-ink-soft">lo que le dejás vos</span>
          </span>
        </div>
      )}

      {/* La pila: se distingue el .md del .csv y del .py por ícono y color. */}
      <div className="space-y-1.5">
        {ROWS.map((r, i) => (
          <div
            key={r.name}
            style={{ animationDelay: `${i * 90}ms` }}
            className={`tgf-in flex items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 ${
              r.open ? "border-primary/30 ring-1 ring-primary/15" : "border-black/[0.06]"
            }`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${r.tone}`}>
              <r.icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-ink">{r.name}</span>
              <span className="block truncate text-[10px] tabular-nums text-ink-soft">{r.meta}</span>
            </span>
            {r.open && <Eye className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </div>
        ))}
      </div>

      {/* El visor: título, texto formateado y el bloque de código resaltado. */}
      <div
        style={{ animationDelay: "300ms" }}
        className="tgf-in mt-2.5 overflow-hidden rounded-xl border border-black/[0.07] bg-white"
      >
        <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-semibold text-ink">informe-mensual.md</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
            <Code2 className="h-2.5 w-2.5" />
            original
          </span>
        </div>
        <div className="space-y-2.5 px-3 py-3">
          <div className="h-2 w-2/5 rounded-full bg-ink/80" />
          <div className="space-y-1.5">
            <Line w="w-full" />
            <Line w="w-[88%]" />
          </div>
          <div className="space-y-1.5 pl-2">
            {["w-[70%]", "w-[78%]"].map((w) => (
              <div key={w} className="flex items-center gap-1.5">
                <span className="h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                <Line w={w} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5 rounded-lg bg-ink px-2.5 py-2">
            <div className="flex gap-1.5">
              <Tok w="w-[8%]" tone="bg-c-violet/80" />
              <Tok w="w-[17%]" tone="bg-c-green" />
              <Tok w="w-[6%]" tone="bg-white/25" />
            </div>
            <div className="flex gap-1.5 pl-[8%]">
              <Tok w="w-[12%]" tone="bg-c-amber" />
              <Tok w="w-[19%]" tone="bg-white/25" />
            </div>
            <div className="flex gap-1.5">
              <Tok w="w-[7%]" tone="bg-c-coral" />
              <Tok w="w-[11%]" tone="bg-white/20" />
            </div>
          </div>
        </div>
      </div>
    </Maqueta>
  );
}

/* ── Lo que cambia según el agente ───────────────────────────────────────── */

function Caja({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded-card border border-black/[0.07] bg-white px-4 py-3">
      {children}
    </div>
  );
}

function Encabezado({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
      {children}
    </p>
  );
}

/** Con subida: dónde van los papeles del cliente y qué pasa después.
 *
 *  Los tres pasos van con `Paso` —ícono y texto— y no con pastillas: "Lo
 *  soltás acá" y "Se lo pedís por el chat" son cosas que se hacen en OTRAS
 *  pantallas, y dibujarlas con forma de botón es prometer un clic que en esta
 *  no pasa nada. */
function ConBuzon() {
  return (
    <Caja>
      <Encabezado icon={Inbox}>Y acá le dejás lo tuyo</Encabezado>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Una planilla, un listado, un PDF: soltalo en cualquier parte de esta pantalla —o usá el
        botón de arriba— y queda en <span className="font-semibold text-ink">Entrada</span>, el
        buzón de tu agente. No hace falta ir a buscar el clip del chat.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Paso icon={Upload}>Lo soltás acá</Paso>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Paso icon={Inbox}>Queda en Entrada</Paso>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Paso icon={MessagesSquare}>Se lo pedís por el chat</Paso>
      </div>
      {/* SUBIRLO NO ES PEDIRLE NADA: el archivo queda en su buzón y él lo va a
          encontrar ahí, pero nadie le avisó. Lo dice igual la pestaña arriba del
          acuse; que lo diga también acá evita el "se lo dejé y no hizo nada". */}
      <p className="mt-2 text-[12px] leading-snug text-ink-soft">
        Dejárselo no lo pone a trabajar: el archivo lo espera ahí hasta que se lo pidas.
      </p>
    </Caja>
  );
}

/** Sin subida declarada: la pantalla es de lectura, y así se dice. */
function SoloLectura() {
  return (
    <Caja>
      <Encabezado icon={Lock}>Solo lectura</Encabezado>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Es una ventana al workspace de tu agente: los archivos se miran y se bajan, pero desde el
        portal no se modifica nada. Si le querés pasar algo tuyo, mandáselo por el chat.
      </p>
    </Caja>
  );
}

/** Mientras se pregunta. No afirma nada en ninguna de las dos direcciones. */
function Averiguando() {
  return (
    <Caja>
      <p className="text-[12px] text-ink-soft">Viendo si a este agente le podés dejar archivos…</p>
      <div className="mt-2 space-y-1.5" aria-hidden>
        <div className="h-2 w-2/3 rounded-pill bg-black/[0.06]" />
        <div className="h-2 w-1/3 rounded-pill bg-black/[0.05]" />
      </div>
    </Caja>
  );
}

/* ── La pantalla ─────────────────────────────────────────────────────────── */

export default function FilesIntro({ onOk }: IntroProps) {
  const puedeSubir = useSubidaDeclarada();

  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis archivos"
      // Sin saberlo todavía no se promete nada: la nota aparece cuando el
      // manifiesto contestó.
      note={puedeSubir === null
        ? undefined
        : puedeSubir
          ? "Le podés dejar archivos; editar o borrar los suyos, no."
          : "Solo lectura: desde acá no se modifica nada."}
    >
      <style>{CSS}</style>
      <Eyebrow icon={FolderOpen}>Archivos</Eyebrow>
      <Title>Los papeles de tu agente</Title>
      <Lead>
        Informes, listados, borradores: lo que fue dejando armado mientras trabajaba. Acá los abrís
        y los leés, sin bajar nada ni salir del portal.
      </Lead>

      {puedeSubir === null ? <Averiguando /> : puedeSubir ? <ConBuzon /> : <SoloLectura />}

      <div className="mt-6 grid gap-6 md:grid-cols-2 md:items-start">
        <Workspace conBuzon={puedeSubir === true} />
        <div className="grid min-w-0 gap-5">
          <Point icon={Eye} title="Se leen como corresponde">
            Los .md se ven formateados, las planillas como planilla y el código con resaltado. Si lo
            querés copiar tal cual, un botón te muestra el original crudo.
          </Point>
          <Point icon={Download} title="Y te los llevás">
            Cualquier archivo se baja tal cual está, incluso los que no se pueden mostrar acá
            adentro.
          </Point>
          <Point icon={Wrench} title="Sin el andamiaje">
            Lo que tu agente usa por dentro para trabajar —pruebas, archivos temporales— queda
            aparte, así acá ves solo lo que te sirve.
          </Point>
        </div>
      </div>
    </IntroPage>
  );
}
