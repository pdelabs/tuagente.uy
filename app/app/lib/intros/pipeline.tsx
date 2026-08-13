"use client";

// Bienvenida del módulo Pipeline.
// Idea visual: el tablero en miniatura arriba de todo —tres columnas con
// tarjetitas— y el texto abajo, alineado en tres puntos que hacen eco de las
// tres columnas.
//
// DOS COSAS QUE ESTE DIBUJO YA NO HACE. Pasaba por el tablero de verdad: una
// clienta de prueba leyó «Confirmar antes de seguir» y «Resumen de la semana»
// como tareas suyas. Ahora va adentro de `Maqueta`, que lo marca como ejemplo.
// Y tenía arriba a la derecha un «+ Nueva tarea» violeta, calcado del botón de
// verdad, que no hacía nada: un botón dibujado es una promesa de clic.

import type { ReactNode } from "react";
import { Check, Columns3, Hand, MessageCircle, PanelRightOpen, Plus, Search, UserRound } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Maqueta, Point, type IntroProps } from "./shell";

function MiniCard({ title, meta, destacada }: {
  title: string;
  meta: ReactNode;
  destacada?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-1.5 sm:p-2 ${
        destacada ? "border-primary/45" : "border-black/[0.07]"
      }`}
    >
      <p className="line-clamp-2 break-words text-[11px] font-medium leading-tight text-ink">
        {title}
      </p>
      <div className="mt-1.5 flex items-center gap-1 text-[10px] leading-none text-ink-soft">
        {meta}
      </div>
    </div>
  );
}

function Columna({ dot, label, children }: {
  dot: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-black/[0.03] p-1.5 sm:p-2">
      <div className="mb-1.5 flex items-start gap-1.5 px-0.5">
        <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <h3 className="break-words text-[10px] font-semibold leading-tight text-ink">{label}</h3>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** El tablero dibujado. Ejemplo declarado y sin un solo control adentro. */
function TableroDemo() {
  return (
    <Maqueta className="bg-white" nota="Tarjetas de ejemplo: no son tus tareas.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
          <Columns3 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Un tablero, tres estados</span>
        </span>
      </div>

      {/* En anchos ridículamente chicos el tablero scrollea dentro de su propia
          caja: la página nunca se corre para el costado. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[21rem] grid-cols-3 gap-1.5 sm:gap-2">
          <Columna dot="bg-primary" label="Esperando aprobación">
            <MiniCard
              destacada
              title="Confirmar antes de seguir"
              meta={
                <>
                  <Hand className="h-3 w-3 shrink-0" />
                  <span className="truncate">tu ok</span>
                </>
              }
            />
          </Columna>

          <Columna dot="bg-c-amber-ink" label="En curso">
            <MiniCard
              title="Armando lo que pediste"
              meta={
                <>
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-c-amber-ink motion-reduce:animate-none" />
                  <span className="truncate">ahora</span>
                </>
              }
            />
            <MiniCard
              title="Revisar la lista"
              meta={
                <>
                  <UserRound className="h-3 w-3 shrink-0" />
                  <span className="truncate">la creaste vos</span>
                </>
              }
            />
          </Columna>

          <Columna dot="bg-c-green-ink" label="Completadas">
            <MiniCard
              title="Resumen de la semana"
              meta={
                <>
                  <Check className="h-3 w-3 shrink-0" />
                  <span className="truncate">listo</span>
                </>
              }
            />
            <MiniCard
              title="Aviso a quien correspondía"
              meta={
                <>
                  <MessageCircle className="h-3 w-3 shrink-0" />
                  <span className="truncate">2</span>
                </>
              }
            />
          </Columna>
        </div>
      </div>
    </Maqueta>
  );
}

export default function PipelineIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Ver el tablero" note="Se actualiza solo cada 30 s.">
      <TableroDemo />

      <div className="mt-6 max-w-2xl">
        <Eyebrow icon={Columns3}>Tablero</Eyebrow>
        <Title>Todo lo que tu agente tiene entre manos</Title>
        <Lead>
          Cada tarjeta es una tarea. Las vas viendo pasar de esperando tu aprobación a en
          curso, y de ahí a completada.
        </Lead>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Point icon={PanelRightOpen} title="Abrí una tarjeta">
          Adentro está el detalle, los comentarios y el historial de lo que fue pasando.
        </Point>
        <Point icon={Plus} title="Creá las tuyas">
          Encargale algo desde el tablero y comentale en la tarjeta para darle contexto.
        </Point>
        <Point icon={Search} title="Buscá y filtrá">
          Por título o por etiqueta, para cuando haya muchas al mismo tiempo.
        </Point>
      </div>
    </IntroPage>
  );
}
