"use client";

// Skills: what the agent knows how to do, with the ones made for the client
// up front — and editable. Rewritten on 8/6 at Luis's request: no search box,
// no filters, no decorative icon, and NO plugins/MCP section -- that told the
// same story as the Connections tab in engine vocabulary, and having two
// versions of "what it's connected to" confused more than it helped.
//
// Contract (adapter ≥0.21): GET {adapter}/portal/inventory →
//   { skills: [{ name, summary, source, category?, editable? }] }
//   GET  /portal/skills/{name} → { name, content }   (ours only)
//   POST /portal/skills/{name} { content }           (same)
//
// PRODUCT DECISION: editing a skill of your own is editing how the agent
// works -- the file is the living spec the agent rereads on its own. That's
// why editing DOES exist here (unlike connections, which are installed and
// audited on our side): the text is the client's, the mechanics are ours.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Puzzle, RefreshCw } from "lucide-react";
import {
  getInventory, getSkillContent, loadConfig, saveSkill,
  type Inventory, type InventoryItem, type HttpError, type PortalConfig,
} from "../lib/agent";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner,
} from "../lib/ui";
import { timeOf } from "../lib/labels";
import {
  CopyLink, PARAM, openInRoute, closeInRoute, bringIntoView, useRouteParam,
} from "../lib/routes";

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

// English function words that don't exist in rioplatense Spanish. Two of
// them together don't come out of text written in Montevideo.
const ENGLISH_WORDS =
  /\b(the|and|or|when|with|from|your|you|use|used|using|create|creates|read|edit|write|writes|extract|convert|merge|split|fill|secure|into|file|files|document|documents|template|templates|spreadsheet|spreadsheets|scan|scans|text|image|images|tool|tools)\b/gi;

/** Is this summary written for the CLIENT, or is it the engine's own spec sheet?
 *
 *  A skill has two audiences and a single file: `description` tells THE
 *  AGENT when to use it (in English, in the imperative, naming libraries) and
 *  `client_summary` tells THE CLIENT what it gets them. The adapter builds the
 *  `summary` from the second one and FALLS BACK TO THE FIRST when it's
 *  missing (`hermes-kit/adapter/portal_adapter.py:439`). That's how things
 *  like "Create, read, edit Word .docx documents and templates." or "Extract
 *  text from PDFs/scans (pymupdf, marker-pdf)" used to reach this screen --
 *  measured against the lab agent, 16 skills -- the showcase of what the
 *  agent can do, written for whoever programmed it.
 *
 *  It's decided with two signals from the data itself, none of them invented
 *  here:
 *
 *  1. `label` is the frontmatter's `title`, the name in plain rioplatense.
 *     It's written together with `client_summary` -- they're our two fields on
 *     the same sheet -- so its absence says the summary is the engine's
 *     `description`. Only valid if the adapter knows about titles (≥0.23):
 *     against an old one, which sends none at all, this signal would turn
 *     off EVERY summary.
 *  2. English, in case some skill carries `title` but not `client_summary`.
 *
 *  Translating by hand here would mean inventing a dictionary that drifts out
 *  of sync with the kit on the very first change. What's missing on the
 *  agent's side goes as a request to the kit; in the meantime, the card shows
 *  the name and stays quiet. */
function writtenForClient(
  s: { summary: string | null; label: string }, adapterHasTitles: boolean,
): boolean {
  if (!s.summary) return false;
  if (adapterHasTitles && !s.label) return false;
  return (s.summary.match(ENGLISH_WORDS) ?? []).length < 2;
}

type Skill = {
  name: string;         // raw: it's the edit endpoint's key
  displayName: string;  // readable
  summary: string | null;
  editable: boolean;
  /** "kit" = the product's own (support portal screens, common to
   *  every client); they go in the system group, with no editing. */
  source: string;
  category: string;
};

/** The file has two parts: the YAML header (spec sheet -- we maintain it)
 *  and the body (the specification -- the client's). The editor shows ONLY
 *  the body: the header is stored separately and pasted back on save, so the
 *  client never sees the machinery and can't break it. */
function splitContent(content: string): { header: string; body: string } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/);
  return m ? { header: m[1], body: m[2] } : { header: "", body: content };
}

/** Inline editor for one of the client's own skills. Content loads on open. */
function SkillEditor({ cfg, name, onClose, onSaved }: {
  cfg: PortalConfig; name: string; onClose: () => void; onSaved: () => void;
}) {
  const [header, setHeader] = useState("");
  const [content, setContent] = useState<string | null>(null);
  // The text exactly as it was on open: without this, editing is a one-way trip.
  const [original, setOriginal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    getSkillContent(cfg, name)
      .then((r) => {
        if (!alive) return;
        const { header: h, body } = splitContent(r.content);
        setHeader(h);
        setContent(body);
        setOriginal(body);
      })
      // Safety net: if we still end up here with one the adapter doesn't
      // serve, the client does NOT read "that skill doesn't exist or isn't
      // editable" over something the screen just told them is editable.
      .catch((e: HttpError) => {
        if (!alive) return;
        setErr(e?.status === 404
          ? "Esta habilidad no se puede editar desde acá. Escribinos y la cambiamos nosotros."
          : e.message || "No pude abrir la habilidad.");
      });
    return () => { alive = false; };
  }, [cfg, name]);

  const save = () => {
    if (content === null) return;
    setSaving(true);
    setErr(null);
    saveSkill(cfg, name, header + content)
      .then(() => { setDone(true); onSaved(); })
      .catch((e: HttpError) => setErr(e.message || "No se pudo guardar."))
      .finally(() => setSaving(false));
  };

  if (err && content === null) {
    return <p className="mt-2 text-[13px] text-c-coral-ink">{err}</p>;
  }
  if (content === null) return <div className="mt-3"><Spinner /></div>;

  const dirty = original !== null && content !== original;

  return (
    <div className="mt-3">
      {/* This changes how the agent works. Say it up front, not after: a test
          client saw the "Editar" button and didn't touch it, afraid of
          breaking something with no way back. Now the way back exists. */}
      <p className="mb-2 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[12px] leading-relaxed text-c-amber-ink">
        Esto es la instrucción que sigue tu agente para esta habilidad. Si lo cambiás,
        cambia cómo trabaja. Podés volver a como estaba mientras no cierres, y si algo
        queda raro, escribinos y lo dejamos como antes.
      </p>
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setDone(false); }}
        spellCheck={false}
        className="h-80 w-full resize-y rounded-lg border border-black/[0.1] bg-white p-3 font-mono text-[12px] leading-relaxed text-ink outline-none transition focus:border-primary/50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={save} disabled={saving || !content.trim()}>
          {saving ? "Guardando…" : "Guardar"}
        </Btn>
        {dirty && (
          <Btn kind="ghost" size="sm" onClick={() => { setContent(original); setDone(false); }}>
            Volver a como estaba
          </Btn>
        )}
        <Btn kind="ghost" size="sm" onClick={onClose}>Cerrar</Btn>
        {done && (
          <span className="text-[12px] font-medium text-c-green-ink">
            Guardado — tu agente lo toma solo en unos minutos.
          </span>
        )}
        {err && <span className="text-[12px] text-c-coral-ink">{err}</span>}
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [data, setData] = useState<Inventory | null>(null);
  const [err, setErr] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Which skill the URL points at (`?skill=<name>`). The name IS readable
  // ("armado-de-reportes"), so the link explains itself.
  //
  // NOTE: pointing at it isn't the same as EDITING it. The system's own have
  // no text to show -- the adapter only serves the content of the editable
  // ones, everything else gives a 404 -- so a link to one of those brings it
  // into view and highlights it, which is all the information that exists.
  // The param used to do absolutely nothing with those, which are the only
  // ones a freshly installed agent has: the link landed on the front page
  // without saying a word.
  const selectedId = useRouteParam(PARAM.skill);
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setData(null); setErr(null); }
    setLoading(true);
    getInventory(cfg)
      .then((r) => {
        setData(r && typeof r === "object" ? r : { skills: [], plugins: [], mcp: [] });
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
    // Does the adapter know about plain-Spanish titles? (≥0.23). If it sends
    // none at all it's old, not that the skills have no spec sheet: see
    // `writtenForClient`.
    const adapterHasTitles = clean.some((s) => (s.label || "").trim() !== "");
    return clean
      // `sin-…` ONES ARE NOT SKILLS: THEY ARE THE LACK OF ONE. `sin-busqueda-web`
      // and `sin-imagenes` are the instructions the agent reads when asked for
      // something it can't do ("what to deliver, how to say it without dressing
      // it up"). In the showcase of what it can do they came out as "Cuando no
      // podés buscar en internet", which was verbatim what the test client
      // flagged as written for whoever programmed it. What IS useful for them
      // to know -- that web search can be turned on -- is the capabilities
      // catalog, which has its own card and its own text.
      .filter((s) => !(norm(String(s.source ?? "")) === "kit" && /^sin-/.test(s.name)))
      .map((s) => {
        const label = (s.label || "").trim();
        const summary = summarize(s.summary);
        return {
        name: s.name,
        displayName: label || humanize(s.name),
        summary: writtenForClient({ summary, label }, adapterHasTitles) ? summary : null,
        // ONLY an explicit `editable: true`. It used to be that if the field
        // was missing, it got inferred from `source === "custom"` -- and
        // there are client-owned skills the adapter CANNOT edit: the ones
        // that live inside a category folder
        // (`skills/contenido/contenido-para-redes/`) list as the client's own
        // but with no `editable`, and `GET /portal/skills/{name}` only
        // resolves top-level ones. Result: the screen said "you can edit
        // this", the Editar button showed up, and pressing it answered "esa
        // habilidad no existe o no es editable" -- the machine contradicting
        // itself in the client's face. Under-inferring (not offering to edit
        // something editable) is a missing button; over-inferring is a
        // broken promise.
        editable: s.editable === true,
        source: norm(String(s.source ?? "")),
        category: typeof s.category === "string" ? s.category.trim() : "",
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  }, [data]);

  // WHOSE a skill is and WHETHER IT CAN BE EDITED are two different
  // questions, and here they used to be the same one ("own = editable").
  // There are skills made for this client that the adapter doesn't serve for
  // editing -- the ones that live inside a category folder -- and lumping
  // them into "Comunes del sistema" fixed the broken button by telling
  // another lie, that they aren't theirs. They're grouped by source, and the
  // Editar button only shows up where it genuinely works.
  const own = useMemo(() => skills.filter((s) => s.source === "custom"), [skills]);
  const system = useMemo(() => skills.filter((s) => s.source !== "custom"), [skills]);

  const selectedSkill = useMemo(
    () => (selectedId ? skills.find((s) => s.name === selectedId) ?? null : null), [selectedId, skills]);
  // The editor only opens for the ones that can be edited.
  const editingName = selectedSkill?.editable ? selectedSkill.name : null;

  // If the one that arrived via link lives in the closed drawer, the drawer
  // opens. Done as an effect and not derived state, so the client can fold it
  // back up afterward.
  useEffect(() => {
    if (selectedSkill && selectedSkill.source !== "custom") setShowSystem(true);
  }, [selectedSkill]);

  // And it gets brought into view -- same helper as Connections. It used to
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
        hint: "Sostienen las pantallas de tu portal (entregas, aprobaciones, visualizaciones). Las mantenemos nosotros.",
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
              hint="Corre una versión del conector anterior a esta pantalla. Cuando lo actualicemos, vas a ver acá todo lo que sabe hacer."
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
            {/* The text used to promise editing ALL of them. The ones that
                say Editar get changed here; the others get requested like
                any other change. */}
            <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
              Las armamos para tu operación, y son tuyas: si querés que algo se haga
              distinto, decíselo a tu agente por el chat. Las que dicen Editar las podés
              cambiar acá mismo, y los cambios los toma solo en unos minutos.
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
                        {editingName === s.name && (
                          <CopyLink label="Copiar el link de esta habilidad" />
                        )}
                      </div>
                      {s.summary && (
                        <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                          {s.summary}
                        </p>
                      )}
                    </div>
                    {/* Only where it genuinely works: a button that answers
                        "esa habilidad no existe o no es editable" over
                        something the screen says is yours is worse than not
                        offering it. */}
                    {cfg && s.editable && editingName !== s.name && (
                      <Btn
                        kind="ghost"
                        size="sm"
                        onClick={() => openInRoute({ [PARAM.skill]: s.name })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Btn>
                    )}
                  </div>
                  {cfg && editingName === s.name && (
                    <SkillEditor
                      cfg={cfg}
                      name={s.name}
                      onClose={() => closeInRoute(PARAM.skill)}
                      onSaved={() => load(true)}
                    />
                  )}
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
                  · entregas, aprobaciones, planillas, PDFs y más
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
                          // its own link at hand. No editor because there's
                          // nothing to edit; saying so is more honest than an
                          // empty panel.
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
                same time Home, Activity and Artifacts show in this same
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
