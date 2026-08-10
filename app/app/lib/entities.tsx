"use client";

// Entidades del agente (tickets y archivos de su workspace) detectadas en el
// texto y mostradas como chips clicables. Módulo HOJA a propósito: no importa
// Markdown, así el renderer puede importar esto sin ciclo. El modal que abre
// cada chip vive en EntityViewer.tsx.

import { createContext, useContext } from "react";
import { FileText, LayoutDashboard, Ticket as TicketIcon } from "lucide-react";
import { ConexionCardInline, PermisosInline } from "./ConexionChip";

export type Entity =
  | { kind: "ticket"; id: string }
  | { kind: "file"; path: string }
  | { kind: "artifact"; id: string }
  | { kind: "conexion"; id: string }
  | { kind: "permisos"; id: string };

const TICKET_RE = /^t_[0-9a-f]{6,16}$/i;
const ARTIFACT_RE = /^art_\d{10}_[\w-]+$/i;
// El agente menciona una conexión del catálogo como `conexion:google-workspace`
// (se lo enseña su SOUL): el chat la dibuja como tarjeta con estado y botón.
const CONEXION_RE = /^conexi[oó]n:([a-z0-9][a-z0-9-]*)$/i;
// `permisos:whatsapp` — el agente NO puede cambiar la política, pero sí puede
// señalar dónde se cambia: en vez de "no puedo mandar WhatsApps" a secas,
// pone el control adelante y el cliente decide ahí mismo.
const PERMISOS_RE = /^permisos:([a-z0-9][a-z0-9-]*)$/i;
// Rutas del workspace: el agente las escribe con o sin prefijo.
const FILE_RE =
  /^(?:\/opt\/data\/workspace\/|workspace\/|\.\/)?([\w./-]+\.(?:md|txt|csv|json|ya?ml|log|py|ts|tsx|js|sh|sql|html))$/i;

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
  const m = FILE_RE.exec(text);
  if (m && m[1].includes(".")) return { kind: "file", path: m[1] };
  return null;
}

const EntityCtx = createContext<((e: Entity) => void) | null>(null);
export const useOpenEntity = () => useContext(EntityCtx);
export const EntityContext = EntityCtx;

const ENTITY_ICON = { ticket: TicketIcon, file: FileText, artifact: LayoutDashboard };
const ENTITY_HINT = {
  ticket: "Ver el ticket",
  file: "Ver el archivo",
  artifact: "Ver el artefacto",
};

export function EntityChip({ entity, label }: { entity: Entity; label: string }) {
  const open = useOpenEntity();
  // Una conexión no abre un modal: ES la tarjeta, con estado y botón.
  if (entity.kind === "conexion") return <ConexionCardInline id={entity.id} />;
  if (entity.kind === "permisos") return <PermisosInline id={entity.id} />;
  const Icon = ENTITY_ICON[entity.kind];
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
