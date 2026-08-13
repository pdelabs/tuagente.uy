"use client";

// Modal que abre un chip de entidad: el ticket con sus comentarios, o el
// archivo del workspace. Renderiza markdown (los agentes escriben markdown en
// descripciones, comentarios y reportes) y código con highlight.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, File as FileIcon, X } from "lucide-react";
import {
  esPedidoDelCliente, getTicketDetail, getFileBytes, getFileText, getArtifact, rotuloAutor,
  type ArtifactMeta, type PortalConfig, type TicketDetail,
} from "./agent";
import { EntityContext, esImagen, type Entity } from "./entities";
import { estadoDeTarea, fechaHora, rotuloArtefacto } from "./palabras";
import Spreadsheet, { CsvPreview } from "./Spreadsheet";
import { Btn } from "./ui";
import { loadAgentName } from "./onboarding";
import { Chip, IconBtn, Modal, Spinner } from "./ui";
import { CopiarUrl, PARAM, urlDe } from "./rutas";
import Markdown from "./Markdown";
import CodeBlock from "./CodeBlock";

// La tercera copia de "quién escribió esto" vivía acá, y era la que más se
// desviaba: `portal` —el asiento de auditoría de una acción del cliente— salía
// como "Portal", una cuarta persona que el cliente no conoce, y
// "auto-decomposer" salía crudo. Ahora es el mismo rótulo del Tablero y de
// Aprobaciones: `rotuloAutor` de `lib/agent.ts`.
const rotuloAutorViewer = (author: string) =>
  rotuloAutor(author, loadAgentName() || "Tu agente");

/** El mismo cartel que el Tablero le pone a esta tarea, en una línea, para que
 *  las dos pantallas no puedan decir cosas distintas del mismo ticket. */
const estadoDeTicket = (t: { status: string; body?: string | null }) =>
  estadoDeTarea(t.status, esPedidoDelCliente(t.body));
import Artifact from "./Artifact";

export function EntityProvider({ cfg, children }: { cfg: PortalConfig; children: ReactNode }) {
  const [open, setOpen] = useState<Entity | null>(null);
  return (
    <EntityContext.Provider value={setOpen}>
      {children}
      {open && <EntityViewer cfg={cfg} entity={open} onClose={() => setOpen(null)} />}
    </EntityContext.Provider>
  );
}

// LA MISMA HORA, CON TRES HORAS DE DIFERENCIA, A UN CLICK. La fila de Actividad
// decía «11:50» y este modal —que abre esa misma fila— «13 ago., 08:50», porque
// acá los `created_at` (epoch pelado, sin huso) se formateaban con el reloj de
// quien mira. Ahora los lee el reloj del negocio, como el resto del portal.
const fmtDate = (value: number | string) => fechaHora(value);

const CODE_EXT: Record<string, string> = {
  py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  sh: "bash", json: "json", yaml: "yaml", yml: "yaml", sql: "sql",
  html: "html", css: "css", diff: "diff",
};

/** Lo que NO es texto: se baja, no se lee. `csv`/`tsv` quedan afuera a
 *  propósito — son texto y se dibujan como tabla. */
const NO_TEXTO =
  /\.(xlsx|xls|ods|docx|doc|odt|pptx|ppt|odp|pdf|rtf|zip|gz|tar|7z|rar|mp3|wav|ogg|m4a|mp4|mov|webm|ics)$/i;
const ES_PLANILLA = /\.(xlsx|xls)$/i;
const ES_TABLA_TEXTO = /\.(csv|tsv)$/i;

/** Bajar un archivo del workspace tal cual está, byte por byte.
 *
 *  Va por `getFileBytes` y NO por el texto ya cargado: `res.text()` decodifica
 *  como UTF-8 y sobre un binario cada byte inválido se vuelve U+FFFD — el
 *  archivo baja roto aunque el adapter lo haya mandado intacto. */
async function bajarArchivo(cfg: PortalConfig, path: string) {
  const bytes = await getFileBytes(cfg, path);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || "archivo";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** La imagen que el agente acaba de hacer, mostrada acá.
 *
 *  Los bytes vienen con bearer, así que no se puede apuntar el `src` al
 *  adapter: se piden y se arma un blob. Antes esto decía "sin vista previa" y
 *  el cliente tenía que bajar su propio cartel para verlo. */
export function ImagenDelAgente({ cfg, path }: { cfg: PortalConfig; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let vivo = true;
    let creada = "";
    getFileBytes(cfg, path)
      .then((b) => {
        if (!vivo) return;
        creada = URL.createObjectURL(new Blob([b]));
        setUrl(creada);
      })
      .catch(() => { if (vivo) setErr(true); });
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
  }, [cfg, path]);

  if (err) return <p className="py-6 text-center text-sm text-ink-soft">No pude mostrar la imagen.</p>;
  if (!url) return <div className="h-48 w-full animate-pulse rounded-lg bg-black/[0.04]" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={path.split("/").pop() || ""}
      className="mx-auto block h-auto max-w-full rounded-lg border border-black/[0.07]"
    />
  );
}

/** Contenido de un archivo: markdown se dibuja, código se resalta. */
export function FileBody({ path, text }: { path: string; text: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return <Markdown>{text}</Markdown>;
  if (CODE_EXT[ext]) return <CodeBlock code={text} lang={CODE_EXT[ext]} />;
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
      {text}
    </pre>
  );
}

/** Dónde vive de verdad cada entidad. Es el link que se comparte y el que el
 *  agente cita (ver `docs/rutas-portal.md`). */
function urlCanonicaDe(entity: Entity): string {
  if (entity.kind === "ticket") return urlDe("/app/pipeline", { [PARAM.tarea]: entity.id });
  if (entity.kind === "artifact") {
    return urlDe("/app/artefactos", { [PARAM.visualizacion]: entity.id });
  }
  if (entity.kind === "file") return urlDe("/app/archivos", { [PARAM.archivo]: entity.path });
  return urlDe("/app/conexiones", { [PARAM.conexion]: entity.id });
}

function EntityViewer({ cfg, entity, onClose }: {
  cfg: PortalConfig; entity: Entity; onClose: () => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<(ArtifactMeta & { html: string }) | null>(null);
  const [hoja, setHoja] = useState<ArrayBuffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [errBajada, setErrBajada] = useState<string | null>(null);

  const esArchivo = entity.kind === "file";
  const ruta = esArchivo ? entity.path : "";
  const esFoto = esArchivo && esImagen(ruta);
  const esPlanillaBinaria = esArchivo && ES_PLANILLA.test(ruta);
  // Ni texto ni imagen ni planilla: solo se baja.
  const soloBaja = esArchivo && NO_TEXTO.test(ruta) && !esPlanillaBinaria;

  useEffect(() => {
    let alive = true;
    setErr(null);
    // "conexion" nunca llega acá: su chip ES la tarjeta y no abre modal.
    if (entity.kind === "conexion" || entity.kind === "permisos"
        || entity.kind === "capacidad") return;
    // Una foto o un PDF no se piden como texto: se muestran o se bajan.
    if (esFoto || soloBaja) return;
    const p =
      entity.kind === "ticket"
        ? getTicketDetail(cfg, entity.id).then((d) => { if (alive) setTicket(d); })
        : entity.kind === "artifact"
          ? getArtifact(cfg, entity.id).then((a) => { if (alive) setArtifact(a); })
          : esPlanillaBinaria
            ? getFileBytes(cfg, entity.path).then((b) => { if (alive) setHoja(b); })
            : getFileText(cfg, entity.path).then((t) => { if (alive) setText(t); });
    p.catch((e) => {
      if (!alive) return;
      const msg = e instanceof Error ? e.message : "error";
      const faltante = {
        ticket: "Esa tarea ya no existe.",
        artifact: "Esa visualización ya no está disponible.",
        file: "No encontré ese archivo.",
        conexion: "",
        permisos: "",
        capacidad: "",
      }[entity.kind];
      setErr(msg.startsWith("404") ? faltante : msg);
    });
    return () => { alive = false; };
  }, [cfg, entity, esFoto, soloBaja, esPlanillaBinaria]);

  const bajar = useCallback(async () => {
    if (!esArchivo) return;
    setBajando(true);
    setErrBajada(null);
    try {
      await bajarArchivo(cfg, ruta);
    } catch (e) {
      setErrBajada(e instanceof Error ? e.message : String(e));
    } finally {
      setBajando(false);
    }
  }, [cfg, esArchivo, ruta]);

  if (entity.kind === "conexion" || entity.kind === "permisos"
      || entity.kind === "capacidad") return null; // su chip ES la tarjeta

  const title =
    entity.kind === "ticket" ? ticket?.ticket.title ?? entity.id
      : entity.kind === "artifact" ? artifact?.title ?? entity.id
        : entity.path;
  const loading = !err && (
    entity.kind === "ticket" ? !ticket
      : entity.kind === "artifact" ? !artifact
        : esFoto || soloBaja ? false
          : esPlanillaBinaria ? hoja === null
            : text === null
  );

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start gap-3 border-b border-black/[0.07] px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {entity.kind === "ticket" ? (
              <>
                {/* EL CHIP DECÍA `done`. En inglés y crudo, a un click de
                    Actividad. Ahora dice lo mismo que el Tablero —"Completado",
                    "Esperando aprobación"— porque sale del mismo diccionario.
                    Y CON EL CUERPO: sin él, el pedido que hizo el propio cliente
                    (bloqueado, como nace) salía acá "Esperando aprobación" —la
                    de él— mientras el Tablero, sobre ese mismo ticket, decía "Lo
                    estamos viendo". El discriminante es `esPedidoDelCliente`. */}
                {ticket && (
                  <Chip tone={estadoDeTicket(ticket.ticket).tono}>
                    {estadoDeTicket(ticket.ticket).label}
                  </Chip>
                )}
                {/* El tenant es el tablero donde vive la tarea, y ese nombre lo
                    puso el cliente ("ventas", "cobranzas"): va tal cual. */}
                {ticket?.ticket.tenant && <Chip>{ticket.ticket.tenant}</Chip>}
                {ticket && (
                  <span className="text-[11px] text-ink-soft">
                    {fmtDate(ticket.ticket.created_at)}
                  </span>
                )}
              </>
            ) : entity.kind === "artifact" ? (
              <>
                {artifact && (
                  <>
                    <Chip tone={rotuloArtefacto(artifact.kind).tono}>
                      {rotuloArtefacto(artifact.kind).label}
                    </Chip>
                    <span className="text-[11px] text-ink-soft">
                      {fmtDate(artifact.created_at)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <Chip>Archivo</Chip>
            )}
          </div>
        </div>
        {/* DESCARGAR, ACÁ. El agente dice "se abre directamente con Excel" y te
            manda el archivo por el chat: si el único botón para bajarlo está
            tres pantallas más allá (Más → Archivos → entregables), el trabajo
            está bien hecho y el cliente no se lo puede llevar. */}
        {esArchivo && (
          <IconBtn label={bajando ? "Bajando…" : "Descargar"} disabled={bajando} onClick={bajar}>
            <Download className="h-4 w-4" />
          </IconBtn>
        )}
        {/* Este modal es una MIRADA desde donde estabas (el chat, un flujo),
            así que el link no es el de esta pantalla: es el de la cosa, en la
            pestaña donde vive. Compartir "el chat con un archivo abierto" no
            le sirve a nadie. */}
        <CopiarUrl obtener={() => urlCanonicaDe(entity)} titulo="Copiar el link de esto" />
        <IconBtn label="Cerrar" onClick={onClose}><X className="h-4 w-4" /></IconBtn>
      </div>
      {errBajada && (
        <p className="border-b border-black/[0.07] px-5 py-2 text-[12px] font-medium text-c-coral-ink">
          No pude descargar el archivo ({errBajada}).
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {err ? (
          <p className="py-6 text-center text-sm text-ink-soft">{err}</p>
        ) : loading ? (
          <Spinner />
        ) : entity.kind === "artifact" ? (
          <>
            {artifact?.summary && (
              <p className="mb-3 text-sm text-ink-soft">{artifact.summary}</p>
            )}
            <Artifact code={artifact?.html ?? ""} lang="html" />
          </>
        ) : entity.kind === "file" ? (
          esFoto ? (
            <ImagenDelAgente cfg={cfg} path={entity.path} />
          ) : soloBaja ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <FileIcon className="h-8 w-8 text-ink-soft" />
              <p className="text-sm font-medium text-ink">Este archivo se abre con otro programa</p>
              <p className="max-w-sm text-[13px] text-ink-soft">
                No se puede mostrar acá, pero lo bajás y lo abrís como siempre.
              </p>
              <Btn onClick={bajar} disabled={bajando}>
                <Download className="h-4 w-4" />
                {bajando ? "Bajando…" : "Descargar"}
              </Btn>
            </div>
          ) : esPlanillaBinaria && hoja ? (
            <Spreadsheet bytes={hoja} />
          ) : ES_TABLA_TEXTO.test(entity.path) ? (
            // El agente lo anuncia como "se abre con Excel": mostrarlo como
            // texto con comas es darle la razón al revés. Se dibuja la tabla y
            // el botón de bajar está arriba.
            <CsvPreview text={text ?? ""} />
          ) : (
            <FileBody path={entity.path} text={text ?? ""} />
          )
        ) : (
          <>
            <Markdown>{ticket?.ticket.body || "_(sin descripción)_"}</Markdown>
            {!!ticket?.comments.length && (
              <div className="mt-5 border-t border-black/[0.07] pt-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  Comentarios
                </p>
                <div className="flex flex-col gap-4">
                  {ticket.comments.map((c, i) => (
                    <div key={i}>
                      <p className="mb-0.5 text-[13px] font-semibold text-ink">
                        {rotuloAutorViewer(c.author)}{" "}
                        <span className="font-normal text-ink-soft">{fmtDate(c.created_at)}</span>
                      </p>
                      <Markdown>{c.body}</Markdown>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
