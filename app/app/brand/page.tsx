"use client";

// Marca — everything the agent works from about the owner's business, in one
// place she can check. The agent researched it (her website, what it found),
// split it in sections, and each one is either CONFIRMED (her word) or a
// DRAFT (the agent's reading, which it treats as such). Below: what it still
// doesn't know, her own free notes, and the files she hands it.
//
// Contract (the engine's business plugin, on the `adapter` base, shown when
// the manifest flips `business`):
//   GET    /portal/business                        → BusinessContext
//   PUT    /portal/business/sections/{key} {text}  → {ok, section}   saving confirms
//   POST   /portal/business/sections/{key}/confirm → {ok, section}
//   PUT    /portal/business/notes {text}           → {ok}
//   POST   /portal/business/files (multipart file) → {ok, file}
//   DELETE /portal/business/files/{name}           → {ok}
//   POST   /portal/business/research {website?}    → {ok}   409 if one is running
//
// LIVE: the portal's one poller (`lib/live.ts`) publishes `business` when the
// engine writes a `business.*` event, and this tab re-reads. While a research
// run is going on the tab also asks every 5 s on its own, so the finished
// sections show up without depending on which event the run ends with.
//
// Nothing opens here, so there is no route param: the files open in the Files
// tab's viewer (`/app/files?file=`), and a question is answered in a new chat
// with the text written and not sent (`?d=`).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Globe, Loader2, MessageSquare, RefreshCw } from "lucide-react";
import {
  getBusiness, loadConfig, researchBusiness, saveBusinessNotes,
  type BusinessContext, type BusinessSection, type HttpError, type PortalConfig,
} from "../lib/agent";
import { Btn, EmptyState, ErrorState, PageHeader, Spinner, inputCls } from "../lib/ui";
import { useChanges } from "../lib/live";
import { buildChatDraftLink } from "../lib/flowExamples";
import SectionCard, { dayLabel } from "./SectionCard";
import FilesBlock from "./FilesBlock";

const PAGE = "mx-auto w-full max-w-3xl px-4 py-6 md:px-8";
const RESEARCH_POLL_MS = 5_000;

/** "negocio.com.uy" out of "https://www.negocio.com.uy/". */
const hostOf = (url: string) =>
  url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");

export default function BrandPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [data, setData] = useState<BusinessContext | null>(null);
  const [err, setErr] = useState<HttpError | null>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const load = useCallback(() => {
    if (!cfg) return;
    getBusiness(cfg)
      .then((d) => { setData(d); setErr(null); })
      .catch((e: HttpError) => setErr(e));
  }, [cfg]);
  useEffect(load, [load]);
  useChanges(["business"], load);

  const researching = Boolean(data?.researching);
  useEffect(() => {
    if (!researching) return;
    const id = setInterval(load, RESEARCH_POLL_MS);
    return () => clearInterval(id);
  }, [researching, load]);

  const replaceSection = (s: BusinessSection) =>
    setData((d) => d && { ...d, sections: d.sections.map((x) => (x.key === s.key ? s : x)) });

  const header = (
    <PageHeader
      title="Marca"
      subtitle="Todo lo que tu agente sabe de tu negocio. Lo que confirmás acá es palabra tuya; lo demás lo trata como borrador."
    />
  );

  if (!cfg || (!data && !err)) return <div className={PAGE}>{header}<Spinner /></div>;
  if (!data) {
    // Reachable by a shared link on an agent without the module: the nav
    // only hides the entry.
    if (err?.status === 404) {
      return (
        <div className={PAGE}>
          {header}
          <EmptyState
            icon={BookOpen}
            title="Este agente todavía no tiene esta pestaña"
            hint="Tu agente necesita una actualización para mostrarla. Escribinos y la vemos."
          />
        </div>
      );
    }
    return <div className={PAGE}>{header}<ErrorState message={err!.message} onRetry={load} /></div>;
  }

  const confirmed = data.sections.filter((s) => s.confirmed).length;

  return (
    <div className={PAGE}>
      {header}

      <ResearchBar cfg={cfg} data={data} onStarted={load} />

      {data.exists && data.sections.length > 0 && (
        <>
          <Progress confirmed={confirmed} total={data.sections.length} />
          <div className="mt-3 grid gap-3">
            {data.sections.map((s) => (
              <SectionCard key={s.key} cfg={cfg} section={s} onSaved={replaceSection} />
            ))}
          </div>
        </>
      )}

      {data.questions.length > 0 && <Questions questions={data.questions} />}

      <div className="mt-6 grid gap-6">
        <Notes cfg={cfg} saved={data.notes} onSaved={(notes) => setData((d) => d && { ...d, notes })} />
        <FilesBlock cfg={cfg} files={data.files} onChanged={load} />
      </div>
    </div>
  );
}

/** Where the context came from, and how to have the agent look again. When
 *  there is none yet it is the whole empty state: the website, and the button. */
function ResearchBar({ cfg, data, onStarted }: {
  cfg: PortalConfig;
  data: BusinessContext;
  onStarted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [website, setWebsite] = useState(data.website ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = () => {
    setBusy(true);
    setErr(null);
    researchBusiness(cfg, website.trim() || undefined)
      .then(() => { setOpen(false); onStarted(); })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  if (data.researching) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-black/[0.07] bg-white px-4 py-3 text-sm text-ink-soft">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>
          Investigando tu web… Lo que encuentre aparece acá solo, no hace falta que esperes en la pestaña.
        </span>
      </div>
    );
  }

  const form = (
    <div className="mt-3">
      <label className="mb-1 block text-[12px] font-medium text-ink-soft" htmlFor="brand-website">
        La web de tu negocio
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="brand-website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && start()}
          placeholder="https://tunegocio.com.uy"
          inputMode="url"
          className={`${inputCls} min-w-0 flex-1 basis-56`}
        />
        <div className="flex gap-2">
          <Btn size="md" disabled={busy} onClick={start}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            Investigar
          </Btn>
          {data.exists && (
            <Btn kind="ghost" size="md" disabled={busy} onClick={() => { setOpen(false); setErr(null); }}>
              Cancelar
            </Btn>
          )}
        </div>
      </div>
    </div>
  );

  if (!data.exists) {
    return (
      <div className="rounded-xl border border-black/[0.07] bg-white px-4 py-4">
        <p className="text-sm font-bold text-ink">Tu agente todavía no investigó tu negocio</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Le pasás tu web, la lee y te arma acá lo que entendió: qué vendés, a quién, cómo
          hablás. Vos lo revisás y confirmás lo que está bien. Mientras tanto, abajo podés
          dejarle notas y archivos.
        </p>
        {form}
        {err && <p className="mt-2 text-[12px] text-c-coral-ink">{err}</p>}
      </div>
    );
  }

  const when = dayLabel(data.researched_at);
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-60 text-[13px] text-ink-soft">
          <Globe className="-mt-0.5 mr-1.5 inline h-3.5 w-3.5" />
          {data.website
            ? <>Investigado de <span className="font-medium text-ink">{hostOf(data.website)}</span></>
            : "Investigado"}
          {when && ` ${when}`}
          {data.sources.length > 1 && ` · ${data.sources.length} páginas leídas`}
        </p>
        {!open && (
          <Btn kind="secondary" size="sm" onClick={() => { setWebsite(data.website ?? ""); setOpen(true); }}>
            <RefreshCw className="h-3.5 w-3.5" />
            Investigar de nuevo
          </Btn>
        )}
      </div>
      {open && form}
      {err && <p className="mt-2 text-[12px] text-c-coral-ink">{err}</p>}
    </div>
  );
}

function Progress({ confirmed, total }: { confirmed: number; total: number }) {
  const all = confirmed === total;
  return (
    <div className="mt-6 flex items-center gap-3">
      <p className={`shrink-0 text-[13px] font-semibold ${all ? "text-c-green-ink" : "text-ink"}`}>
        {all && <Check className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />}
        {confirmed} de {total} {total === 1 ? "sección confirmada" : "secciones confirmadas"}
      </p>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
        <div
          className={`h-full rounded-full ${all ? "bg-c-green-ink" : "bg-primary"}`}
          style={{ width: `${total ? (confirmed / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

function Questions({ questions }: { questions: string[] }) {
  return (
    <section className="mt-6 rounded-xl border border-c-amber bg-c-amber/25">
      <h2 className="border-b border-c-amber px-4 py-2.5 text-sm font-bold text-ink">
        Lo que me falta saber
      </h2>
      <ul className="divide-y divide-c-amber/70">
        {questions.map((q) => (
          <li key={q} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <p className="min-w-0 flex-1 basis-60 text-sm text-ink">{q}</p>
            <Link
              href={buildChatDraftLink(`Sobre la pregunta de Marca «${q}»: `)}
              className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Contestar en el chat
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Her free notes. What she writes here the agent reads as-is. The draft
 *  follows the agent's copy while she hasn't touched it; once she types, the
 *  poll never overwrites what she is writing. */
function Notes({ cfg, saved, onSaved }: {
  cfg: PortalConfig;
  saved: string;
  onSaved: (text: string) => void;
}) {
  const [draft, setDraft] = useState(saved);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!touched) setDraft(saved); }, [saved, touched]);

  const dirty = draft !== saved;

  const save = () => {
    setBusy(true);
    setErr(null);
    saveBusinessNotes(cfg, draft)
      .then(() => {
        onSaved(draft);
        setTouched(false);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="rounded-xl border border-black/[0.07] bg-white">
      <h2 className="border-b border-black/[0.07] px-4 py-2.5 text-sm font-bold text-ink">Tus notas</h2>
      <div className="px-4 py-3">
        <p className="mb-2 text-[12px] leading-snug text-ink-soft">
          Lo que escribas acá lo lee tu agente tal cual: horarios especiales, cómo querés
          que conteste, lo que no está en la web.
        </p>
        <textarea
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setTouched(true); setJustSaved(false); }}
          rows={Math.min(16, Math.max(5, draft.split("\n").length + 1))}
          placeholder="Por ejemplo: en enero cerramos los lunes. A los clientes de siempre tratalos de vos."
          className={`${inputCls} leading-relaxed`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn size="sm" disabled={busy || !dirty} onClick={save}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar
          </Btn>
          {justSaved && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-c-green-ink">
              <Check className="h-3.5 w-3.5" />
              Guardado
            </span>
          )}
          {!justSaved && dirty && <span className="text-[12px] text-ink-soft">Sin guardar</span>}
        </div>
        {err && <p className="mt-2 text-[12px] text-c-coral-ink">No pude guardarlas: {err}</p>}
      </div>
    </section>
  );
}
