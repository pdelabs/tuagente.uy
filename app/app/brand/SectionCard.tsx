"use client";

// One section of the business context: what the agent wrote about one side
// of the business (what it sells, how it talks, its hours…), and whether the
// owner already said "that's right". CONFIRMED is her word; the rest the
// agent treats as a draft.
//
// Editing SAVES AND CONFIRMS in one step: if she rewrote it, it is hers. The
// card redraws from the section the engine returns, never from what it
// believes it sent.

import { useState } from "react";
import { Check, Loader2, PencilLine } from "lucide-react";
import {
  confirmBusinessSection, saveBusinessSection,
  type BusinessSection, type PortalConfig,
} from "../lib/agent";
import { Btn, Chip, inputCls } from "../lib/ui";
import Markdown from "../lib/Markdown";
import { momentOf } from "../lib/labels";

/** "hoy", "ayer", "el 17 ago". */
export function dayLabel(epoch: number | null | undefined): string {
  const m = momentOf(epoch);
  if (!m) return "";
  if (m.days === 0) return "hoy";
  if (m.days === -1) return "ayer";
  return `el ${m.date}`;
}

export default function SectionCard({ cfg, section, onSaved }: {
  cfg: PortalConfig;
  section: BusinessSection;
  onSaved: (s: BusinessSection) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"confirm" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(section.text);
    setErr(null);
    setEditing(true);
  };

  const confirm = () => {
    setBusy("confirm");
    setErr(null);
    confirmBusinessSection(cfg, section.key)
      .then((r) => onSaved(r.section))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(null));
  };

  const save = () => {
    setBusy("save");
    setErr(null);
    saveBusinessSection(cfg, section.key, draft)
      .then((r) => { onSaved(r.section); setEditing(false); })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(null));
  };

  const empty = !section.text.trim();

  return (
    <section className="rounded-xl border border-black/[0.07] bg-white">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-black/[0.07] px-4 py-2.5">
        <h2 className="min-w-0 flex-1 text-sm font-bold text-ink">{section.heading}</h2>
        {section.confirmed ? (
          <span title={section.confirmed_at ? `Lo confirmaste ${dayLabel(section.confirmed_at)}` : undefined}>
            <Chip tone="green"><Check className="mr-0.5 h-3 w-3" />Confirmado</Chip>
          </span>
        ) : (
          <Chip tone="amber">Borrador</Chip>
        )}
      </header>

      {editing ? (
        <div className="px-4 py-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(18, Math.max(5, draft.split("\n").length + 1))}
            className={`${inputCls} font-mono text-[13px] leading-relaxed`}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn size="sm" disabled={busy !== null} onClick={save}>
              {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Btn>
            <Btn kind="ghost" size="sm" disabled={busy !== null} onClick={() => setEditing(false)}>
              Cancelar
            </Btn>
            <span className="text-[12px] text-ink-soft">Al guardar queda confirmado.</span>
          </div>
        </div>
      ) : (
        <div className="min-w-0 px-4 py-3 text-sm text-ink">
          {empty
            ? <p className="text-ink-soft">Tu agente todavía no escribió nada acá.</p>
            : <Markdown>{section.text}</Markdown>}
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.07] px-4 py-2.5">
          {!section.confirmed && !empty && (
            <Btn size="sm" disabled={busy !== null} onClick={confirm}>
              {busy === "confirm"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Check className="h-3.5 w-3.5" />}
              Confirmar
            </Btn>
          )}
          <Btn kind="secondary" size="sm" disabled={busy !== null} onClick={startEditing}>
            <PencilLine className="h-3.5 w-3.5" />
            {empty ? "Escribirlo" : "Editar"}
          </Btn>
          {section.confirmed && section.confirmed_at && (
            <span className="text-[12px] text-ink-soft">Lo confirmaste {dayLabel(section.confirmed_at)}.</span>
          )}
        </div>
      )}
      {err && <p className="px-4 pb-3 text-[12px] text-c-coral-ink">No pude guardarlo: {err}</p>}
    </section>
  );
}
