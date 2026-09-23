"use client";

// Skills: what the agent knows how to do, with the ones made for the client
// up front. Read-only: the skills live in the kit, and a change to how the
// agent works is asked for over the chat. No search box, no filters, no
// decorative icon, and NO plugins/MCP section.
//
// Contract (engine `server/extra.py`): GET /portal/inventory →
//   { skills: [{ name, label, summary, source, category? }] }
//   `label` is the owner's name for the skill, `summary` the owner's line.
//   (it also returns the plugins and `mcp`; this page draws neither)

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Puzzle, RefreshCw } from "lucide-react";
import {
  getInventory, loadConfig,
  type Inventory, type InventoryItem, type HttpError, type PortalConfig,
} from "../lib/agent";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner,
} from "../lib/ui";
import { timeOf } from "../lib/labels";
import { CopyLink, PARAM, bringIntoView, useRouteParam } from "../lib/routes";

type Failure = { status?: number; message: string };

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;
const GENERAL = "General";

// Categories come from the engine and are in English ("productivity",
// "autonomous-ai-agents", "email"): on a screen that otherwise speaks
// rioplatense, they stuck out as titles shouted in another language. Whatever
// isn't in here is shown as it comes: we'd rather have an odd word than hide
// a new group.
const CATEGORY_LABEL: Record<string, string> = {
  productivity: "Documentos y planillas",
  "autonomous-ai-agents": "Programación",
  email: "Correo",
  research: "Investigación",
  "sales-ops": "Ventas",
  data: "Datos",
  media: "Audio, video e imágenes",
  web: "Web",
};
const categoryLabel = (c: string) => CATEGORY_LABEL[(c || "").toLowerCase()] ?? humanize(c);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const is404 = (f: Failure) => f.status === 404 || /^404\b/.test(f.message);

// Acronyms and extensions that read like a typo in lowercase.
const ACRONYMS = new Set([
  "pdf", "xlsx", "docx", "pptx", "csv", "tsv", "ocr", "api", "url", "sql", "html",
  "css", "json", "yaml", "xml", "cli", "sdk", "ui", "ux", "ai", "ia", "crm", "erp",
  "imap", "smtp", "sms", "mcp", "id", "qr", "http", "https", "rss", "vpn", "gpt",
]);

/** `armado-de-reportes` → "Armado de reportes". Already-readable text is left alone. */
function humanize(raw: string): string {
  const name = (raw || "").trim();
  if (!name || /[A-Z\s]/.test(name)) return name;
  const parts = name.split(/[-_]+/).filter(Boolean);
  if (parts.length === 0) return name;
  const words = parts.map((p) => (ACRONYMS.has(p) ? p.toUpperCase() : p));
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

/** Summaries broken or cut off by the engine: with no useful text, nothing is shown. */
function summarize(raw?: string): string | null {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s || !/[a-z0-9]/.test(norm(s))) return null;
  const cut = s.length > 50 && !/[.!?…:;)\]"']$/.test(s);
  return cut ? `${s}…` : s;
}

type Skill = {
  name: string;         // raw: it's the `?skill=` key
  displayName: string;  // readable
  summary: string | null;
  /** "kit" = the product's own (support portal screens, common to
   *  every client); they go in the system group. */
  source: string;
  category: string;
};

export default function SkillsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [data, setData] = useState<Inventory | null>(null);
  const [err, setErr] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Which skill the URL points at (`?skill=<name>`). The name IS readable
  // ("armado-de-reportes"), so the link explains itself.
  //
  // A link to one brings it into view and highlights it, which is all the
  // information that exists: there is no text to open.
  const selectedId = useRouteParam(PARAM.skill);
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setData(null); setErr(null); }
    setLoading(true);
    getInventory(cfg)
      .then((r) => {
        setData(r && typeof r === "object" ? r : { skills: [], engine_plugins: [], mcp: [] });
        setErr(null);
        setLastUpdated(new Date());
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setLoading(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  const skills = useMemo<Skill[]>(() => {
    const raw = Array.isArray(data?.skills) ? data!.skills : [];
    const clean = raw.filter(
      (s): s is InventoryItem => Boolean(s) && typeof s?.name === "string" && s.name.trim() !== "");
    return clean
      // `sin-…` ONES ARE NOT SKILLS: THEY ARE THE LACK OF ONE. `sin-busqueda-web`
      // and `sin-imagenes` are the instructions the agent reads when asked for
      // something it can't do ("what to deliver, how to say it without dressing
      // it up"). In the showcase of what it can do they came out as "Cuando no
      // podés buscar en internet", which was verbatim what the test client
      // flagged as written for whoever programmed it.
      .filter((s) => !(norm(String(s.source ?? "")) === "kit" && /^sin-/.test(s.name)))
      .map((s) => {
        // Both are the OWNER's text: the skill's `title` and its
        // `client_summary`, never the model's `description` -- which is what
        // used to reach this screen and had to be sniffed out as English.
        const label = (s.label || "").trim();
        return {
        name: s.name,
        displayName: label || humanize(s.name),
        summary: summarize(s.summary),
        source: norm(String(s.source ?? "")),
        category: typeof s.category === "string" ? s.category.trim() : "",
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  }, [data]);

  // Grouped by WHOSE a skill is: the ones made for this client, and the rest.
  const own = useMemo(() => skills.filter((s) => s.source === "custom"), [skills]);
  const system = useMemo(() => skills.filter((s) => s.source !== "custom"), [skills]);

  const selectedSkill = useMemo(
    () => (selectedId ? skills.find((s) => s.name === selectedId) ?? null : null), [selectedId, skills]);

  // If the one that arrived via link lives in the closed drawer, the drawer
  // opens. Done as an effect and not derived state, so the client can fold it
  // back up afterward.
  useEffect(() => {
    if (selectedSkill && selectedSkill.source !== "custom") setShowSystem(true);
  }, [selectedSkill]);

  // And it gets brought into view -- same helper as Approvals. It used to
  // be a 150 ms `setTimeout` with smooth scroll and BROUGHT NOTHING INTO VIEW:
  // the row stayed at 823 px with the window at 813 and `scrollY` at 0, i.e.
  // right below the fold. The why (and why it's `instant` now) is in
  // `bringIntoView`.
  //
  // The deps are the NAME and a boolean, not the object: the list refreshes
  // itself every minute, and with the object in the deps the effect ran again
  // on every refresh. With the smooth scroll that went unnoticed (it moved
  // nothing); now that it moves, it would be the page jumping on its own
  // every 60 seconds while the client reads something else.
  const hasSelected = Boolean(selectedSkill);
  useEffect(() => {
    if (!hasSelected) return;
    return bringIntoView(".skill-selected");
  }, [selectedId, hasSelected, showSystem]);

  // The system's own, grouped: first the tuagente product's own (they support
  // portal screens), then the engine's own by category.
  const systemGroups = useMemo(() => {
    const groups: { key: string; label: string; hint?: string; items: Skill[] }[] = [];
    const kit = system.filter((s) => s.source === "kit");
    if (kit.length > 0) {
      groups.push({
        key: "__tuagente",
        label: "De tuagente",
        hint: "Sostienen las pantallas de tu portal (aprobaciones, archivos, posteos). Las mantenemos nosotros.",
        items: kit,
      });
    }
    const byCategory = new Map<string, Skill[]>();
    for (const s of system) {
      if (s.source === "kit") continue;
      const arr = byCategory.get(s.category);
      if (arr) arr.push(s);
      else byCategory.set(s.category, [s]);
    }
    for (const c of Array.from(byCategory.keys()).sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return humanize(a).localeCompare(humanize(b), "es");
    })) {
      groups.push({ key: c || "__general", label: c ? categoryLabel(c) : GENERAL, items: byCategory.get(c)! });
    }
    return groups;
  }, [system]);

  const body = () => {
    if (err && data === null) {
      if (is404(err)) {
        return (
          <>
            <EmptyState
              icon={Puzzle}
              title="Este agente todavía no expone sus habilidades"
              hint="Cuando lo actualicemos, vas a ver acá todo lo que sabe hacer."
            />
            <div className="flex justify-center">
              <Btn kind="ghost" size="sm" onClick={() => load()}>Reintentar</Btn>
            </div>
          </>
        );
      }
      return <ErrorState message={err.message} onRetry={() => load()} />;
    }
    if (!data) return <Spinner />;
    if (skills.length === 0) {
      return (
        <EmptyState
          icon={Puzzle}
          title="Tu agente todavía no declara habilidades"
          hint="Cuando le sumemos la primera, la vas a ver listada acá."
        />
      );
    }

    return (
      <>
        {/* A link to a skill that's no longer there (renamed, removed)
            can't be left silent: the client presses it and nothing happens. */}
        {selectedId && !selectedSkill && (
          <p className="mb-4 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] leading-snug text-c-amber-ink">
            No encontré la habilidad que buscabas. Puede que le hayamos cambiado el nombre
            o que ya no esté; abajo está todo lo que tu agente sabe hacer hoy.
          </p>
        )}

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold tracking-tight text-ink">Hechas para vos</h2>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
              Las armamos para tu operación, y son tuyas: si querés que algo se haga
              distinto, decíselo a tu agente por el chat.
            </p>
          </div>

          {own.length === 0 ? (
            <p className="px-1 text-[13px] leading-snug text-ink-soft">
              Todavía no armamos habilidades a medida para tu operación. La primera que
              instalemos va a aparecer acá.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {own.map((s) => (
                <Card
                  key={s.name}
                  className={selectedId === s.name
                    ? "skill-selected ring-2 ring-primary/25" : ""}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="break-words text-sm font-semibold text-ink">{s.displayName}</p>
                        {s.category && <Chip tone="violet">{categoryLabel(s.category)}</Chip>}
                        {selectedId === s.name && (
                          <CopyLink label="Copiar el link de esta habilidad" />
                        )}
                      </div>
                      {s.summary && (
                        <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                          {s.summary}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {system.length > 0 && (
          <section className="mt-8">
            {/* The engine's own exist but don't compete for attention: one
                collapsed row, not a wall of cards. */}
            <button
              onClick={() => setShowSystem((v) => !v)}
              aria-expanded={showSystem}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-black/[0.03]"
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${showSystem ? "" : "-rotate-90"}`}
              />
              <span className="text-sm font-bold tracking-tight text-ink">
                Comunes del sistema
              </span>
              <span className="text-[12px] tabular-nums text-ink-soft">
                {system.length} habilidades
              </span>
              {!showSystem && (
                <span className="min-w-0 truncate text-[12px] text-ink-soft/80">
                  · aprobaciones, planillas, PDFs y más
                </span>
              )}
            </button>

            {showSystem && (
              <div className="mt-2 flex flex-col gap-5">
                {systemGroups.map((g) => (
                  <div key={g.key}>
                    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                        {g.label}
                      </h3>
                      <span className="text-[11px] tabular-nums text-ink-soft/70">
                        {g.items.length}
                      </span>
                      {g.hint && (
                        <span className="text-[11px] text-ink-soft/70">· {g.hint}</span>
                      )}
                    </div>
                    <Card className="overflow-hidden !p-0">
                      <ul className="divide-y divide-black/[0.06]">
                        {g.items.map((s) => {
                          // The one that came via link: highlighted and with
                          // its own link at hand.
                          const highlighted = selectedId === s.name;
                          return (
                            <li
                              key={s.name}
                              className={`px-4 py-3 ${
                                highlighted ? "skill-selected bg-c-violet/40" : ""}`}
                            >
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <p className="break-words text-sm font-semibold text-ink">
                                  {s.displayName}
                                </p>
                                {highlighted && (
                                  <CopyLink label="Copiar el link de esta habilidad" />
                                )}
                              </div>
                              {s.summary && (
                                <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                                  {s.summary}
                                </p>
                              )}
                              {highlighted && (
                                <p className="mt-1.5 text-[12px] leading-snug text-ink-soft/80">
                                  Esta viene con el sistema y es igual para todos: la mantenemos
                                  nosotros y no se edita. Si querés que tu agente trabaje distinto,
                                  decíselo por el chat.
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </>
    );
  };

  return (
    <div className={WRAP}>
      <PageHeader
        title="Habilidades"
        subtitle="Lo que tu agente sabe hacer — y cómo lo hace"
        actions={
          <>
            {/* One single clock in the whole portal: the business's. It's the
                same time Home and Activity show in this same
                stamp -- two tabs answering "since when is this?" differently
                is exactly what we're getting rid of. */}
            {lastUpdated && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {timeOf(lastUpdated.getTime())}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={loading} onClick={() => load(true)}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && data !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {body()}
    </div>
  );
}
