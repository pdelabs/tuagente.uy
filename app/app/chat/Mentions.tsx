"use client";

// Composer: `@` addresses someone on the team, `/` searches your own things
// (files and tickets). One prefix for "talk to someone", another for
// "find something of mine" -- the same convention people already know.
//
// `@` used to belong to files. `/` takes it over because in a room `@` means
// one single thing, and fighting that against everyone's habit is a losing
// battle. `#` stays alive for tickets: it costs nothing, and whoever already
// learned it doesn't lose it.
//
// Picking a file or a ticket inserts its id/path and the chat draws it as a
// chip. Picking someone on the team does NOT insert text: it changes the
// turn's recipient, which is what an `@` means.

import { useEffect, useMemo, useState } from "react";
import { FileText, Ticket as TicketIcon, User } from "lucide-react";
import { getTickets, getFiles, type PortalConfig } from "../lib/agent";
import { roleName, type RolesById } from "../lib/roles";

export type MentionKind = "ticket" | "file" | "role";
export type MentionItem = { insert: string; label: string; hint?: string };

/** The mention token immediately before the caret, if there is one. */
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

/** Fetches and filters candidates. Cached per type: the board doesn't change per keystroke. */
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
    if (!pool) return null; // null = still loading
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
