"use client";

// Bienvenida de "Archivos".
// Composición: mesa de trabajo del agente a la izquierda (pila de archivos +
// visor abierto) y los tres puntos a la derecha. Ilustración en divs, sin
// imágenes externas; la animación de entrada respeta prefers-reduced-motion.

import {
  Code2, Eye, FileCode2, FileSpreadsheet, FileText, FolderOpen, Lock, Wrench,
  type LucideIcon,
} from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Point, type IntroProps } from "./shell";

const CSS = `
@keyframes tgf-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
.tgf-in { animation: tgf-in .5s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .tgf-in { animation: none; } }
`;

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
function Workspace() {
  return (
    <div className="min-w-0 rounded-card border border-black/[0.07] bg-gradient-to-br from-c-violet/70 via-white to-c-green/25 p-3">
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
    </div>
  );
}

export default function FilesIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis archivos"
      note="Solo lectura: desde acá no se modifica nada."
    >
      <style>{CSS}</style>
      <Eyebrow icon={FolderOpen}>Archivos</Eyebrow>
      <Title>Todo lo que tu agente fue escribiendo</Title>
      <Lead>
        Informes, listados, borradores: lo que dejó armado mientras trabajaba. Acá los abrís y
        los leés, sin bajar nada ni salir del portal.
      </Lead>

      <div className="mt-7 grid gap-6 md:grid-cols-2 md:items-start">
        <Workspace />
        <div className="grid min-w-0 gap-5">
          <Point icon={Eye} title="Se leen como corresponde">
            Los .md se ven formateados y el código con resaltado. Si lo querés copiar tal cual,
            un botón te muestra el original crudo.
          </Point>
          <Point icon={Lock} title="Solo lectura">
            Es una ventana al workspace de tu agente: nada se edita ni se borra desde el portal.
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
