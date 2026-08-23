"use client";

// What the agent can do with a connection. The same component in two places:
// the Connections card and the chat, when the agent writes `permissions:<id>`
// -- so the client learns ONE single control.
//
// Two switches and not twelve, on purpose. Classifying each tool
// ("search_contacts reads, send_message acts") is our own job when curating
// the MCP; that IS the curation. Asking a non-technical client to evaluate
// `get_message_context` would dress up a decision of ours as one of theirs,
// which is exactly what we've been removing from the product.
//
// The agent CANNOT touch this: the policy file is mounted read-only on its
// side. It can only point at it.

import { useState } from "react";
import { Eye, Loader2, Send } from "lucide-react";
import { savePermissions, loadConfig, type Connection } from "./agent";

type State = { read: boolean; act: boolean };

function Toggle({ on, label, hint, icon: Icon, saving, onToggle }: {
  on: boolean; label: string; hint: string;
  icon: typeof Eye; saving: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={saving}
      aria-pressed={on}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-black/[0.03] disabled:opacity-60"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          on ? "bg-primary" : "bg-black/15"
        }`}
      >
        <span className={`h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Icon className="h-3.5 w-3.5 text-ink-soft" />
          {label}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">{hint}</span>
      </span>
      {saving && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-ink-soft" />}
    </button>
  );
}

export default function Permissions({ connection, onChange }: {
  connection: Connection; onChange?: (p: State) => void;
}) {
  const [state, setState] = useState<State>(
    connection.permissions ?? { read: true, act: false });
  const [saving, setSaving] = useState<"read" | "act" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const change = (k: keyof State) => {
    const cfg = loadConfig();
    if (!cfg || saving) return;
    const previous = state;
    const next = { ...state, [k]: !state[k] };
    setState(next);          // optimistic: the switch can't hesitate
    setSaving(k);
    setErr(null);
    savePermissions(cfg, connection.id, { [k]: next[k] })
      .then((r) => { setState(r.permissions); onChange?.(r.permissions); })
      .catch((e) => {
        setState(previous);  // if it didn't save, it doesn't show as saved
        setErr(e instanceof Error ? e.message : "no se pudo guardar");
      })
      .finally(() => setSaving(null));
  };

  return (
    <div className="rounded-lg border border-black/[0.07] bg-white p-1.5">
      <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        Qué puede hacer con {connection.label}
      </p>
      <Toggle
        on={state.read}
        icon={Eye}
        label="Puede leer"
        hint="Mirar y buscar. No cambia nada."
        saving={saving === "read"}
        onToggle={() => change("read")}
      />
      <Toggle
        on={state.act}
        icon={Send}
        label="Puede escribir y mandar"
        hint="Mandar mensajes o archivos, y cualquier cosa que salga hacia afuera."
        saving={saving === "act"}
        onToggle={() => change("act")}
      />
      {err && <p className="px-2 pb-1.5 text-[12px] text-c-coral-ink">{err}</p>}
    </div>
  );
}
