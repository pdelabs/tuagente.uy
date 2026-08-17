"use client";

// Compositor: `@` le habla a alguien del equipo, `/` busca cosas tuyas
// (archivos y tickets). Un prefijo para "hablarle a alguien", otro para
// "encontrar algo mío" -- la misma convención que la gente ya conoce.
//
// `@` era de los archivos. Se los lleva `/` porque en una sala `@` significa
// una sola cosa, y pelearla contra la costumbre de todo el mundo es perder.
// `#` sigue vivo para tickets: no cuesta nada y a quien lo aprendió no se le
// saca.
//
// Al elegir un archivo o un ticket se inserta su id/ruta y el chat lo dibuja
// como chip. Al elegir a alguien del equipo NO se inserta texto: se cambia el
// destinatario del turno, que es lo que un `@` significa.

import { useEffect, useMemo, useState } from "react";
import { FileText, Ticket as TicketIcon, User } from "lucide-react";
import { getTickets, getFiles, type PortalConfig } from "../lib/agent";
import { roleName, type RolesById } from "../lib/roles";

export type MentionKind = "ticket" | "file" | "role";
export type MentionItem = { insert: string; label: string; hint?: string };

/** Token de mención inmediatamente antes del cursor, si lo hay. */
export function mentionAt(text: string, caret: number):
  { kind: MentionKind; term: string; start: number } | null {
  const before = text.slice(0, caret);
  // `/` only counts at the start of a word, same as the others: a path typed
  // mid-sentence ("entregables/enero") must not open the picker.
  const m = /(^|\s)([#@/])([\w.-]{0,60})$/.exec(before);
  if (!m) return null;
  return {
    kind: m[2] === "@" ? "role" : m[2] === "#" ? "ticket" : "file",
    term: m[3],
    start: caret - m[3].length - 1,
  };
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Trae y filtra candidatos. Cachea por tipo: el tablero no cambia por tecla. */
export function useMentionItems(
  cfg: PortalConfig | null,
  kind: MentionKind | null,
  term: string,
  roles: RolesById = {},
) {
  const [tickets, setTickets] = useState<MentionItem[] | null>(null);
  const [files, setFiles] = useState<MentionItem[] | null>(null);

  useEffect(() => {
    if (!cfg) return;
    if (kind === "ticket" && tickets === null) {
      getTickets(cfg)
        .then((r) => setTickets(
          (r.tickets ?? []).map((t) => ({
            insert: t.id,
            label: t.title,
            hint: t.tenant ? `${t.status} · ${t.tenant}` : t.status,
          })),
        ))
        .catch(() => setTickets([]));
    }
    if (kind === "file" && files === null) {
      getFiles(cfg)
        .then((r: { files?: { path: string; size?: number }[] }) => setFiles(
          (r.files ?? []).map((f) => ({
            insert: f.path,
            label: f.path.split("/").pop() ?? f.path,
            hint: f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : undefined,
          })),
        ))
        .catch(() => setFiles([]));
    }
  }, [cfg, kind, tickets, files]);

  // The team needs no fetch: the roster is already in memory. `insert` is the
  // role id -- the picker does not put it in the text, it hands the turn over.
  const team = useMemo(
    () => Object.values(roles).map((role) => ({
      insert: role.id,
      label: roleName(role.id, roles),
      hint: role.label,
    })),
    [roles],
  );

  return useMemo(() => {
    const pool = kind === "ticket" ? tickets : kind === "file" ? files : kind === "role" ? team : null;
    if (!pool) return null; // null = cargando
    const needle = norm(term);
    const hit = needle
      ? pool.filter((i) => norm(i.label).includes(needle) || norm(i.insert).includes(needle))
      : pool;
    return hit.slice(0, 8);
  }, [kind, term, tickets, files, team]);
}

export function MentionList({ kind, items, activeIdx, onPick }: {
  kind: MentionKind;
  items: MentionItem[] | null;
  activeIdx: number;
  onPick: (item: MentionItem) => void;
}) {
  const Icon = kind === "ticket" ? TicketIcon : kind === "role" ? User : FileText;
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-black/10 bg-white">
      <p className="border-b border-black/[0.06] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {kind === "ticket" ? "Tickets del tablero"
          : kind === "role" ? "Tu equipo"
          : "Archivos del agente"}
      </p>
      {items === null ? (
        <p className="px-3 py-2 text-[13px] text-ink-soft">Buscando…</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-2 text-[13px] text-ink-soft">Nada coincide.</p>
      ) : (
        <ul>
          {items.map((it, i) => (
            <li key={it.insert}>
              <button
                onMouseDown={(e) => { e.preventDefault(); onPick(it); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
                  i === activeIdx ? "bg-c-violet/60" : "hover:bg-black/[0.04]"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{it.label}</span>
                {it.hint && (
                  <span className="shrink-0 truncate text-[11px] text-ink-soft">{it.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
