"use client";

// Sidebar de conversaciones: búsqueda, agrupado por fecha, fijadas, renombrar,
// borrar y filtro de sesiones de sistema (crons, workers, títulos automáticos).
// Endpoints verificados contra :8642 — PATCH /api/sessions/{id} renombra (200),
// DELETE /api/sessions/{id} borra (200).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X,
} from "lucide-react";
import {
  deleteSession, renameSession, type PortalConfig,
} from "../lib/agent";
import { ErrorState, Spinner, inputCls } from "../lib/ui";

export type SessionSummary = {
  id: string;
  source: string; // "api_server" | "telegram" | "cron" | "kanban" | ...
  title: string | null;
  preview: string | null;
  message_count: number;
  started_at: number; // epoch en segundos
  last_active: number;
};

const HUMAN_SOURCES = new Set(["api_server", "telegram", "whatsapp", "discord"]);
const PINNED_KEY = "tuagente_chat_pinned";

// Conversaciones que un cliente reconoce como suyas: las humanas, sin las
// internas del sistema (crons, workers del kanban, generación de títulos).
export function isHumanSession(s: SessionSummary): boolean {
  if (!HUMAN_SOURCES.has(s.source)) return false;
  const t = (s.title ?? s.preview ?? "").trimStart();
  // "### Task": las que Hermes usa para titular/etiquetar.
  // "[Aviso del portal]": la sesión donde el adapter le avisa al agente que
  // comentaste un ticket. Es maquinaria nuestra, no una conversación tuya.
  return !t.startsWith("### Task") && !t.startsWith("[Aviso del portal]");
}

export function sessionTitle(s: SessionSummary): string {
  return s.title?.trim() || s.preview?.trim() || "Conversación";
}

function dayGroup(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff < 7) return "Últimos 7 días";
  if (diff < 30) return "Últimos 30 días";
  return "Anteriores";
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function Sessions({
  cfg, sessions, sessionsErr, activeId, sending,
  onOpen, onNew, onRefresh, onDeletedActive, searchRef, onNavigate,
}: {
  cfg: PortalConfig;
  sessions: SessionSummary[] | null;
  sessionsErr: string | null;
  activeId: string | null;
  sending: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  onDeletedActive: () => void;
  searchRef?: React.RefObject<HTMLInputElement>;
  onNavigate?: () => void; // cerrar el drawer en mobile
}) {
  const [q, setQ] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setPinned(JSON.parse(localStorage.getItem(PINNED_KEY) || "[]")); } catch { /* noop */ }
  }, []);

  const savePinned = (next: string[]) => {
    setPinned(next);
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  // Cerrar el menú contextual al hacer click afuera o con Escape.
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuId]);

  const closeMenu = () => { setMenuId(null); setConfirmId(null); };

  const visible = useMemo(() => {
    if (!sessions) return null;
    const base = showSystem ? sessions : sessions.filter(isHumanSession);
    if (!q.trim()) return base;
    const needle = norm(q.trim());
    return base.filter((s) => norm(sessionTitle(s)).includes(needle));
  }, [sessions, showSystem, q]);

  const systemCount = useMemo(
    () => (sessions ? sessions.length - sessions.filter(isHumanSession).length : 0),
    [sessions],
  );

  const { pinnedItems, groups } = useMemo(() => {
    if (!visible) return { pinnedItems: [] as SessionSummary[], groups: [] as { group: string; items: SessionSummary[] }[] };
    const pinSet = new Set(pinned);
    const pinnedItems = visible.filter((s) => pinSet.has(s.id));
    const rest = visible.filter((s) => !pinSet.has(s.id));
    const order = ["Hoy", "Ayer", "Últimos 7 días", "Últimos 30 días", "Anteriores"];
    const map = new Map<string, SessionSummary[]>();
    for (const s of rest) {
      const g = dayGroup(s.last_active);
      map.set(g, [...(map.get(g) ?? []), s]);
    }
    return {
      pinnedItems,
      groups: order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! })),
    };
  }, [visible, pinned]);

  const doRename = async (id: string) => {
    const title = renameText.trim();
    if (!title) return;
    setBusyId(id);
    setErr(null);
    try {
      await renameSession(cfg, id, title);
      setRenamingId(null);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "no pude renombrar");
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (id: string) => {
    setBusyId(id);
    setErr(null);
    try {
      await deleteSession(cfg, id);
      savePinned(pinned.filter((p) => p !== id));
      closeMenu();
      if (id === activeId) onDeletedActive();
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "no pude borrar");
    } finally {
      setBusyId(null);
    }
  };

  const Row = ({ s }: { s: SessionSummary }) => {
    const active = s.id === activeId;
    const isPinned = pinned.includes(s.id);
    if (renamingId === s.id) {
      return (
        <div className="px-1 py-1">
          <input
            autoFocus
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doRename(s.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={() => setRenamingId(null)}
            disabled={busyId === s.id}
            className={`${inputCls} py-1 text-[13px]`}
          />
        </div>
      );
    }
    return (
      <div
        className={`group relative flex items-center gap-1 rounded-lg pl-2 pr-1 transition ${
          active ? "bg-black/[0.06]" : "hover:bg-black/[0.04]"
        }`}
      >
        <button
          onClick={() => { onOpen(s.id); onNavigate?.(); }}
          disabled={sending}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left disabled:opacity-60"
        >
          {isPinned && <Pin className="h-3 w-3 shrink-0 text-ink-soft" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            {sessionTitle(s)}
          </span>
          {!HUMAN_SOURCES.has(s.source) && (
            <span className="shrink-0 text-[10px] text-ink-soft/70">{s.source}</span>
          )}
        </button>
        <button
          aria-label="Opciones"
          onClick={() => setMenuId(menuId === s.id ? null : s.id)}
          className={`shrink-0 rounded-md p-1 text-ink-soft transition hover:bg-black/[0.06] hover:text-ink ${
            menuId === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>

        {menuId === s.id && (
          <div className="absolute right-1 top-8 z-20 w-44 overflow-hidden rounded-lg border border-black/10 bg-white py-1">
            {confirmId === s.id ? (
              <div className="px-2 py-1.5">
                <p className="mb-1.5 text-[12px] text-ink-soft">¿Borrar esta conversación?</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => doDelete(s.id)}
                    disabled={busyId === s.id}
                    className="flex-1 rounded-md bg-c-coral px-2 py-1 text-[12px] font-semibold text-c-coral-ink disabled:opacity-50"
                  >
                    {busyId === s.id ? "Borrando…" : "Sí, borrar"}
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="flex-1 rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-black/[0.05]"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <MenuItem
                  icon={isPinned ? PinOff : Pin}
                  label={isPinned ? "Dejar de fijar" : "Fijar arriba"}
                  onClick={() => {
                    savePinned(isPinned ? pinned.filter((p) => p !== s.id) : [s.id, ...pinned]);
                    closeMenu();
                  }}
                />
                <MenuItem
                  icon={Pencil}
                  label="Renombrar"
                  onClick={() => {
                    setRenameText(sessionTitle(s));
                    setRenamingId(s.id);
                    closeMenu();
                  }}
                />
                <MenuItem icon={Trash2} label="Borrar" danger onClick={() => setConfirmId(s.id)} />
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <button
          onClick={() => { onNew(); onNavigate?.(); }}
          disabled={sending}
          className="flex w-full items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Nueva conversación
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft/70" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Buscar conversación"
            className={`${inputCls} py-1.5 pl-8 pr-7 text-[13px]`}
          />
          {q && (
            <button
              aria-label="Limpiar búsqueda"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-soft hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {err && (
        <p className="mx-3 mb-2 rounded-lg border border-c-coral bg-c-coral/30 px-2 py-1.5 text-[12px] text-c-coral-ink">
          {err}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {sessions === null && !sessionsErr && <Spinner />}
        {sessionsErr && <ErrorState message={sessionsErr} onRetry={onRefresh} />}
        {visible !== null && !sessionsErr && visible.length === 0 && (
          <p className="px-2 py-6 text-center text-[13px] text-ink-soft">
            {q ? "Ninguna conversación coincide." : "Todavía no hay conversaciones."}
          </p>
        )}

        {pinnedItems.length > 0 && (
          <div className="mb-2">
            <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">
              Fijadas
            </p>
            {pinnedItems.map((s) => <Row key={s.id} s={s} />)}
          </div>
        )}
        {groups.map(({ group, items }) => (
          <div key={group} className="mb-2">
            <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">
              {group}
            </p>
            {items.map((s) => <Row key={s.id} s={s} />)}
          </div>
        ))}
      </div>

      {systemCount > 0 && (
        <div className="border-t border-black/[0.07] p-2">
          <button
            onClick={() => setShowSystem((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-soft transition hover:bg-black/[0.04] hover:text-ink"
          >
            {showSystem && <Check className="h-3 w-3" />}
            {showSystem ? "Ocultar sesiones de sistema" : `Ver sesiones de sistema (${systemCount})`}
          </button>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-black/[0.05] ${
        danger ? "text-c-coral-ink" : "text-ink"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
