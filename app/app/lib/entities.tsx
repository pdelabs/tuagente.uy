"use client";

// Entidades del agente (tickets y archivos de su workspace) detectadas en el
// texto y mostradas como chips clicables. Módulo HOJA a propósito: no importa
// Markdown, así el renderer puede importar esto sin ciclo. El modal que abre
// cada chip vive en EntityViewer.tsx.

import { createContext, useContext } from "react";
import { FileText, Image as ImageIcon, LayoutDashboard, Sheet, Ticket as TicketIcon } from "lucide-react";
import { ConexionCardInline, PermisosInline } from "./ConexionChip";
import { CapacidadInline } from "./CapacidadChip";

export type Entity =
  | { kind: "ticket"; id: string }
  | { kind: "file"; path: string }
  | { kind: "artifact"; id: string }
  | { kind: "conexion"; id: string }
  | { kind: "permisos"; id: string }
  | { kind: "capacidad"; id: string };

const TICKET_RE = /^t_[0-9a-f]{6,16}$/i;
const ARTIFACT_RE = /^art_\d{10}_[\w-]+$/i;
// El agente menciona una conexión del catálogo como `conexion:google-workspace`
// (se lo enseña su SOUL): el chat la dibuja como tarjeta con estado y botón.
const CONEXION_RE = /^conexi[oó]n:([a-z0-9][a-z0-9-]*)$/i;
// `permisos:whatsapp` — el agente NO puede cambiar la política, pero sí puede
// señalar dónde se cambia: en vez de "no puedo mandar WhatsApps" a secas,
// pone el control adelante y el cliente decide ahí mismo.
const PERMISOS_RE = /^permisos:([a-z0-9][a-z0-9-]*)$/i;
// `capacidad:imagenes` — lo que el agente NO puede hacer todavía y se puede
// prender. El SOUL le enseña a escribirlo solo en una línea y promete que "el
// portal la convierte en una tarjeta": hasta hoy el portal no lo hacía y el
// token quedaba crudo en el medio de la respuesta.
const CAPACIDAD_RE = /^capacidad:([a-z0-9][a-z0-9-]*)$/i;

/** Extensiones que el agente produce y el cliente tiene que poder abrir.
 *
 *  ESTA LISTA ES EL BUG MÁS CARO QUE TUVO EL CHAT: tenía solo texto y código,
 *  así que el JPG de 1080×1080 que el agente acababa de armar para WhatsApp no
 *  se dibujaba como chip — se dibujaba como link relativo y terminaba en
 *  "404: This page could not be found". Lo mismo con los `docx`, `xlsx` y `pdf`
 *  que el agente sabe generar de fábrica. El trabajo estaba hecho y el cliente
 *  no llegaba a él.
 *
 *  Se exporta porque el renderer de markdown detecta las mismas rutas en prosa:
 *  una sola lista, no dos que se desincronizan. */
export const EXT_ARCHIVO =
  "md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|log|out|rst|env|" +
  "py|rb|ts|tsx|js|jsx|mjs|sh|bash|sql|xml|html?|css|" +
  "jpe?g|png|gif|webp|bmp|svg|ico|heic|avif|" +
  "pdf|xlsx|xls|ods|docx|doc|odt|pptx|ppt|odp|rtf|" +
  "zip|gz|tar|ics|mp3|wav|ogg|m4a|mp4|mov|webm";

// Rutas del workspace: el agente las escribe con o sin prefijo.
const FILE_RE = new RegExp(
  `^(?:/opt/data/workspace/|workspace/|\\./)?([\\w./-]+\\.(?:${EXT_ARCHIVO}))$`, "i");

const EXT_IMAGEN = /\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|avif)$/i;
const EXT_PLANILLA = /\.(xlsx|xls|csv|tsv|ods)$/i;

/** ¿Esta ruta es una imagen? La usan el visor (la muestra) y el chip (ícono). */
export const esImagen = (path: string) => EXT_IMAGEN.test(path);
export const esPlanilla = (path: string) => EXT_PLANILLA.test(path);

/** ¿Este texto suelto es una entidad del agente? */
export function detectEntity(raw: string): Entity | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (TICKET_RE.test(text)) return { kind: "ticket", id: text };
  if (ARTIFACT_RE.test(text)) return { kind: "artifact", id: text };
  const cx = CONEXION_RE.exec(text);
  if (cx) return { kind: "conexion", id: cx[1].toLowerCase() };
  const pm = PERMISOS_RE.exec(text);
  if (pm) return { kind: "permisos", id: pm[1].toLowerCase() };
  const cap = CAPACIDAD_RE.exec(text);
  if (cap) return { kind: "capacidad", id: cap[1].toLowerCase() };
  const m = FILE_RE.exec(text);
  if (m && m[1].includes(".")) return { kind: "file", path: m[1] };
  return null;
}

const EntityCtx = createContext<((e: Entity) => void) | null>(null);
export const useOpenEntity = () => useContext(EntityCtx);
export const EntityContext = EntityCtx;

const ENTITY_HINT = {
  ticket: "Ver la tarea",
  file: "Abrir el archivo",
  artifact: "Ver la visualización",
};

export function EntityChip({ entity, label }: { entity: Entity; label: string }) {
  const open = useOpenEntity();
  // Una conexión no abre un modal: ES la tarjeta, con estado y botón.
  if (entity.kind === "conexion") return <ConexionCardInline id={entity.id} />;
  if (entity.kind === "permisos") return <PermisosInline id={entity.id} />;
  if (entity.kind === "capacidad") return <CapacidadInline id={entity.id} />;
  // El ícono dice de qué se trata antes de tocarlo: una foto se abre y se mira,
  // una planilla se abre y se baja.
  const Icon =
    entity.kind === "ticket" ? TicketIcon
      : entity.kind === "artifact" ? LayoutDashboard
        : esImagen(entity.path) ? ImageIcon
          : esPlanilla(entity.path) ? Sheet
            : FileText;
  // Sin proveedor (fuera del chat) no hay a dónde abrir: queda como código.
  if (!open) {
    return (
      <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
        {label}
      </code>
    );
  }
  return (
    <button
      onClick={() => open(entity)}
      title={ENTITY_HINT[entity.kind]}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-c-violet bg-c-violet/40 px-1.5 py-0.5 align-middle font-mono text-[0.85em] text-primary transition hover:border-primary hover:bg-c-violet"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
