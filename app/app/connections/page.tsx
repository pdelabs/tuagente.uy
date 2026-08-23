"use client";

// Connections: which company systems the agent is plugged into, what each
// one is missing, and what connecting it involves.
//
// Contract (adapter v0.20): GET {adapter}/portal/connections →
//   { available, connections: [{ id, label, group, purpose, how, effort,
//                                who, warning, recommended, status,
//                                missing[], missing_prerequisite[] }] }
//
// TWO PRODUCT DECISIONS, better not undone without thinking it through:
//
// 1. Credentials (passwords, tokens, keys) never get pasted here. Status is
//    computed from presence and the adapter never returns a value. OAuth is
//    the exception: the one-time code Google returns isn't a secret the
//    client keeps -- it's the standard flow, and the exchange goes through
//    the adapter.
// 2. Connect actually connects when there's a self-service flow (today:
//    Google, with its step-by-step dialog). "Ask them to connect it" is the
//    fallback for what genuinely needs paperwork on our side (WhatsApp,
//    Slack) -- and the emergency exit if the client would rather we did it
//    together.
//
// The vocabulary is the client's: the missing environment variables never
// show up (that's plumbing) -- what showing up instead is what it involves
// and how long it takes.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight, Check, Clock, ExternalLink, Link2, Plug, RefreshCw, TriangleAlert,
} from "lucide-react";
import {
  activateTelegramPairing, requestedConnections, createConnectionRequest,
  exchangeGoogleAuthCode, getConnections, getGoogleAuthUrl, getTickets,
  saveIdentity, loadConfig,
  type Connection, type PortalConfig,
} from "../lib/agent";
import { ConnectionLogo } from "../lib/ConnectionLogo";
import Permissions from "../lib/Permissions";
import WhatsAppDialog from "./WhatsAppDialog";
import {
  StaleLinkNotice, Btn, Card, Chip, EmptyState, ErrorState, Modal, PageHeader, Spinner, inputCls,
} from "../lib/ui";
import { CopyLink, PARAM, bringIntoView, useRouteParam } from "../lib/routes";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

/** Search, insensitive to accents and case. */
const norm = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const EFFORT: Record<string, string> = {
  minutes: "Se conecta en minutos",
  hours: "Lleva unas horas",
  days: "Lleva varios días",
};

const WHO: Record<string, string> = {
  client_only: "Lo podés hacer vos",
  assisted: "Lo hacemos juntos, en una llamada corta",
  us: "Lo tramitamos nosotros",
};

/** Who connects it, ACCORDING TO WHAT THIS CARD ACTUALLY OFFERS.
 *
 *  The catalog says whose job it is when everything's in place; the status
 *  says whether there's actually something the client can press right now.
 *  Telegram comes marked `client_only` -- "You can do it yourself" -- and on
 *  an agent with no bot the card's only button is "Ask them to connect it":
 *  the line was dumping a job on the client that the portal doesn't let them
 *  do. If there's no self-service path, it doesn't claim there is one either. */
function whoForReal(c: Connection): string | undefined {
  const canAlone = Boolean(c.setup_flow) || Boolean(c.link) || c.status === "ready";
  const who = c.who === "client_only" && !canAlone && c.status !== "connected"
    ? "us" : c.who;
  return who && WHO[who] ? who : undefined;
}


/** Google connection dialog: explicit steps, nobody from tuagente in the
 *  middle. The adapter generates the URL and exchanges the code; this only
 *  guides the client through it. */
function GoogleDialog({ cfg, connection, onClose, onConnected }: {
  cfg: PortalConfig; connection: Connection; onClose: () => void; onConnected: () => void;
}) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    getGoogleAuthUrl(cfg)
      .then((d) => { if (alive) setAuthUrl(d.auth_url); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [cfg]);

  const exchange = async () => {
    setExchanging(true);
    setErr(null);
    try {
      const d = await exchangeGoogleAuthCode(cfg, pasted);
      if (!d.ok) throw new Error("No se pudo conectar Google.");
      setDone(true);
      onConnected();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExchanging(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <ConnectionLogo id={connection.id} />
          <div>
            <p className="text-sm font-bold text-ink">Conectar {connection.label}</p>
            <p className="text-[12px] text-ink-soft">Dos minutos, dos pasos.</p>
          </div>
        </div>

        {done ? (
          <div className="flex flex-col items-start gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-c-green-ink">
              <Check className="h-4 w-4" /> ¡Conectado! Tu agente ya puede ver tus carpetas.
            </p>
            <Btn size="sm" onClick={onClose}>Listo</Btn>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-c-violet/60 text-[12px] font-bold text-primary">1</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  Entrá con tu cuenta de Google y aceptá el permiso de lectura.
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">
                  Si aparece &ldquo;Google no verificó esta app&rdquo;, tocá
                  &ldquo;Avanzado&rdquo; y después &ldquo;Ir a tuagente&rdquo;: somos nosotros.
                </p>
                <a
                  href={authUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!authUrl}
                  className={`mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-white transition ${authUrl ? "bg-primary hover:bg-primary-dark" : "pointer-events-none bg-black/20"}`}
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Google
                </a>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-c-violet/60 text-[12px] font-bold text-primary">2</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  Al final vas a caer en una página que <strong>no carga</strong> — es lo
                  esperado. Copiá la dirección entera de la barra y pegala acá:
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="http://localhost:1/?state=…"
                    className={`${inputCls} flex-1 font-mono text-[12px]`}
                  />
                  <Btn size="sm" onClick={exchange} disabled={!pasted.trim() || exchanging}>
                    {exchanging ? "Conectando…" : "Conectar"}
                  </Btn>
                </div>
              </div>
            </li>
            {err && <p className="text-[13px] font-medium text-c-coral-ink">{err}</p>}
          </ol>
        )}
      </div>
    </Modal>
  );
}

/** Telegram "ready": open the chat + paste the activation code right here. */
function TelegramReady({ c, cfg, onActivated }: {
  c: Connection; cfg: PortalConfig | null; onActivated: () => void;
}) {
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const activate = async () => {
    if (!cfg || !code.trim()) return;
    setActivating(true);
    setErr(null);
    try {
      const d = await activateTelegramPairing(cfg, code);
      if (!d.ok) throw new Error("No se pudo activar Telegram.");
      setDone(true);
      // There's now a way to notify them: let the manifest know, so the
      // "still no channel" banner stops showing. Onboarding records it when
      // pairing happens there; the same thing happens here and nobody was
      // recording it, so a client who turned it on from this screen was left
      // with the reminder stuck on forever.
      saveIdentity(cfg, { contact: { channel: "telegram", value: "portal" } })
        .catch(() => { /* old or down adapter: Telegram stayed as it was */ });
      onActivated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  };

  if (done) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-c-green-ink">
        <Check className="h-4 w-4" /> ¡Activado! Mandale otro mensaje y ya te contesta.
      </p>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      <a
        href={c.link!}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        <ExternalLink className="h-4 w-4" />
        Abrir el chat
      </a>
      <p className="text-[12px] leading-snug text-ink-soft">
        Mandale un hola. ¿Te contestó con un código? Pegalo acá:
      </p>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setErr(null); }}
          onKeyDown={(e) => e.key === "Enter" && activate()}
          placeholder="Código"
          maxLength={16}
          className={`${inputCls} w-36 font-mono uppercase`}
        />
        <Btn size="sm" onClick={activate} disabled={!code.trim() || activating}>
          {activating ? "Activando…" : "Activar"}
        </Btn>
      </div>
      {err && <p className="text-[12px] font-medium text-c-coral-ink">{err}</p>}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "connected")
    return (
      <Chip tone="green">
        <Check className="h-3 w-3" /> Conectado
      </Chip>
    );
  if (status === "ready")
    return (
      <Chip tone="violet">
        Lista para vos
      </Chip>
    );
  if (status === "blocked")
    return (
      <Chip tone="amber">
        <Clock className="h-3 w-3" /> Falta un paso nuestro
      </Chip>
    );
  return <Chip tone="neutral">Sin conectar</Chip>;
}

export default function ConnectionsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requested, setRequested] = useState<Record<string, string>>({});
  // The requests already made, read from the board. They used to live ONLY in
  // this React state: reloading the page had the client seeing "Sin conectar"
  // [Not connected] again with no way to know whether they'd already asked or
  // not.
  const [openRequests, setOpenRequests] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Connection | null>(null);
  // The whole catalog lives behind a gate: it only opens if the client asks
  // for it, or if they come looking for a connection that's in there.
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  // Which connection the client is coming for. It arrives in the URL from
  // the flow that needs it: without this they land on a screen with six
  // cards and none of them says which one was theirs.
  //
  // It now travels via query (`?connection=telegram`), like the rest of the
  // portal. It used to travel via hash `#c=` so as not to clash with the
  // magic link; the problem is that the hash is EXACTLY where the credential
  // arrives, so sharing that URL meant sharing the key. The hash is still
  // read so as not to break old links that might still be floating around.
  const inRoute = useRouteParam(PARAM.connection);
  const [inHash, setInHash] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = window.location.hash.match(/(?:^#|&)c=([^&]+)/);
      setInHash(m ? decodeURIComponent(m[1]) : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const targetId = inRoute ?? inHash;

  // Bring it into view once it's painted. Card doesn't take a ref (React 18),
  // so it's found by its marker class.
  // If the one they came to connect is in the catalog below, it opens on its
  // own: sending them to a screen where their card is hidden would be worse
  // than not sending them at all.
  useEffect(() => {
    if (targetId && connections?.some((c) => c.id === targetId
      && c.status !== "connected" && !(c.required || c.status === "ready"))) {
      setShowAll(true);
    }
  }, [targetId, connections]);

  // The deps are booleans, not the list: it refreshes itself every minute,
  // and with `connections` here the effect ran on every refresh -- i.e. the
  // page jumping on its own every 60 seconds while the client reads another
  // card.
  const hasConnections = connections !== null;
  useEffect(() => {
    if (!targetId || !hasConnections) return;
    return bringIntoView(".connection-target");
  }, [targetId, hasConnections, showAll]);

  useEffect(() => setCfg(loadConfig()), []);

  const load = useCallback(async () => {
    if (!cfg) return;
    try {
      const r = await getConnections(cfg);
      setConnections(r.connections ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // Open requests are an extra: if the board doesn't answer, the
    // connections screen still has to keep working just the same.
    try {
      const t = await getTickets(cfg);
      // How an open request is recognized lives in `agent.ts`: Team reads
      // the same rule, and two copies of it is one of the two ending up
      // offering to ask again for what's already on its way.
      setOpenRequests(requestedConnections(t.tickets));
    } catch { /* no board: we carry on with whatever's in memory */ }
  }, [cfg]);

  useEffect(() => {
    if (!cfg) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  /** Requesting a connection = creating a ticket. Same path -- and same
   *  helper -- as the onboarding request: it's born blocked so the worker
   *  doesn't pick it up. */
  const requestConnection = async (c: Connection) => {
    if (!cfg) return;
    setRequesting(c.id);
    try {
      const data = await createConnectionRequest(cfg, {
        title: `Conectar ${c.label}`,
        body:
          `Para qué sirve: ${c.purpose}\n` +
          `Cómo se conecta: ${c.how}\n\n` +
          `No hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
          `que hay que conectarlo y dejá el ticket esperando.`,
      });
      setRequested((p) => ({ ...p, [c.id]: data.id ?? "ok" }));
      load(); // so the "Requested" status comes from the board, not from here
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(null);
    }
  };

  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  if (connections === null && error)
    return <div className={WRAP}><ErrorState message={error} onRetry={load} /></div>;
  if (connections === null) return <div className={WRAP}><Spinner /></div>;

  // What the CLIENT can resolve right now goes on top and separate: a
  // connection with an unconnected self-service flow, a bot waiting for its
  // first message, or something their flow needs. The rest is grouped as
  // always.
  // THREE ZONES, and the order matters. This used to be grouped by "can you
  // connect it alone?" and by group (channel/system): Google came out on top
  // of everything with nobody having asked for it, and email -- which a flow
  // needed -- got lost among six identical cards. Now a single question
  // rules: does something need it TODAY? The flows answer that, and it
  // updates on its own.
  const needed = connections.filter(
    (c) => c.status !== "connected" && (c.required || c.status === "ready"));
  const active = connections.filter((c) => c.status === "connected");
  const others = connections.filter(
    (c) => !needed.includes(c) && !active.includes(c));
  const q = norm(search.trim());
  const filteredOthers = q
    ? others.filter((c) => norm(`${c.label} ${c.purpose}`).includes(q))
    : others;

  /** Already requested? Comes from the board (survives a reload) or from
   *  what you just did on this screen. */
  const alreadyRequested = (c: Connection) =>
    Boolean(requested[c.id]) || openRequests.has((c.label ?? "").trim().toLowerCase());

  /** The connection the link points to, or null if the catalog doesn't have
   *  it. The banner above is built with THIS, not with the URL's raw id:
   *  without the check, `connectionLabel` humanizes anything ("noexiste-xyz"
   *  → "noexiste xyz") and the portal ends up announcing a made-up product. */
  const targetConnection = targetId ? connections.find((c) => c.id === targetId) ?? null : null;

  const renderCard = (c: Connection) => (
    <Card
      key={c.id}
      className={`flex flex-col gap-2 p-4 ${
        c.id === targetId
          ? "connection-target !border-2 !border-primary ring-4 ring-primary/15"
          : c.required && c.status !== "connected" ? "!border !border-c-amber" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ConnectionLogo id={c.id} />
          <h3 className="text-[15px] font-semibold text-ink">{c.label}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* "Requested" wins over "not connected": that's the question the
              client asks themselves when they come back ("did I already ask
              or not?"), and the raw status used to answer it wrong. */}
          {c.status !== "connected" && alreadyRequested(c)
            ? <Chip tone="amber"><Clock className="h-3 w-3" /> Pedida</Chip>
            : <StatusChip status={c.status} />}
          {c.required && c.status !== "connected" && (
            <Chip tone="amber">Tu flujo la necesita</Chip>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-soft">{c.purpose}</p>
      <p className="text-[13px] text-ink-soft">{c.how}</p>

      {c.warning && (
        <p className="flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-2.5 py-1.5 text-[12px] text-c-amber-ink">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {c.warning}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        {c.effort && EFFORT[c.effort] && <span>{EFFORT[c.effort]}</span>}
        {whoForReal(c) && (
          <>
            <span aria-hidden>·</span>
            <span>{WHO[whoForReal(c)!]}</span>
          </>
        )}
      </div>

      {/* "Ready": the bot exists, only its first message is missing -- one
          click and done. If the bot replies with a code (pairing), it gets
          pasted right here: being authenticated in the portal + having the
          DM is the double proof. */}
      {c.status === "ready" && c.link && (
        <TelegramReady c={c} cfg={cfg} onActivated={load} />
      )}

      {/* Permissions only make sense once the connection exists: before
          connecting it there's nothing to limit. */}
      {c.status === "connected" && (
        <div className="mt-1"><Permissions connection={c} /></div>
      )}

      {c.status !== "connected" && c.status !== "ready" && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {/* With a self-service flow, Connect actually CONNECTS (step
              dialog); "ask them to connect it" stays as the emergency exit.
              With no flow, asking is the only path -- WhatsApp or Slack we
              always handle ourselves. */}
          {c.setup_flow && c.status === "disconnected" ? (
            <>
              <Btn onClick={() => setDialog(c)}>
                Conectar
                <ArrowRight className="h-4 w-4" />
              </Btn>
              {alreadyRequested(c) ? (
                <p className="text-[13px] font-medium text-c-green-ink">
                  Ya nos lo pediste. Te escribimos.
                </p>
              ) : (
                <button
                  onClick={() => requestConnection(c)}
                  disabled={requesting === c.id}
                  className="text-[12px] font-semibold text-ink-soft underline-offset-2 transition hover:text-ink hover:underline"
                >
                  {requesting === c.id ? "Pidiendo…" : "¿Preferís que lo hagamos juntos? Pedilo"}
                </button>
              )}
            </>
          ) : alreadyRequested(c) ? (
            /* Full and stable confirmation: what happened, what's next, and
               that there's nothing else to do. This used to be a line that
               showed up where the button was and got lost from view; the
               client kept pressing again just in case. */
            <div className="rounded-lg border border-c-green bg-c-green/30 px-3 py-2">
              <p className="text-[13px] font-semibold text-c-green-ink">
                Listo, quedó pedido.
              </p>
              <p className="mt-0.5 text-[12px] text-c-green-ink/85">
                Lo anotamos y lo vas a ver en Aprobaciones, en “Lo que pediste”. Te
                escribimos cuando esté conectada; no tenés que hacer nada más.
              </p>
            </div>
          ) : (
            <Btn onClick={() => requestConnection(c)} disabled={requesting === c.id}>
              <Link2 className="h-4 w-4" />
              {requesting === c.id ? "Pidiendo…" : "Pedir que la conecten"}
            </Btn>
          )}
        </div>
      )}
    </Card>
  );

  return (
    <div className={WRAP}>
      <PageHeader
        title="Conexiones"
        subtitle="Los sistemas de tu empresa a los que tu agente está enchufado."
        actions={
          <>
            {targetConnection && <CopyLink label="Copiar el link de esta conexión" />}
            <Btn kind="ghost" onClick={load}>
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Btn>
          </>
        }
      />

      {/* Where you're coming from. Without this the client lands on six cards
          and none of them says which one was theirs: "you get lost in
          everything there is". BUT ONLY WHAT'S KNOWN GETS CLAIMED. The banner
          used to say the same thing always -- "You're here to connect X.
          It's what's missing for one of your flows" -- and that made up two
          things: with `?connection=noexiste-xyz` it made up the product
          ("You're here to connect noexiste xyz"), and with any real id it
          made up the need, even when the one that was actually needed was a
          different one. Now there are four distinct banners and none of them
          claims more than it knows. */}
      {targetId && targetConnection === null && (
        <StaleLinkNotice>
          No tengo ninguna conexión que se llame «{targetId}» — puede que el link sea viejo o
          que esté mal escrito. Abajo está todo lo que tu agente puede conectar hoy.
        </StaleLinkNotice>
      )}

      {targetConnection && targetConnection.status === "connected" && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-c-green bg-c-green/25 px-3 py-2.5">
          <Check className="h-4 w-4 shrink-0 text-c-green-ink" />
          <p className="text-[13px] font-semibold text-c-green-ink">
            {targetConnection.label} ya está conectada.
          </p>
          <p className="text-[12.5px] text-c-green-ink/85">
            Te la marcamos abajo, con sus permisos.
          </p>
        </div>
      )}

      {targetConnection && targetConnection.status !== "connected" && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
          <TriangleAlert className="h-4 w-4 shrink-0 text-c-amber-ink" />
          <p className="text-[13px] font-semibold text-c-amber-ink">
            Venís a conectar {targetConnection.label}.
          </p>
          <p className="text-[12.5px] text-c-amber-ink/85">
            {targetConnection.required
              ? "Es la que le falta a uno de tus trabajos — te la marcamos abajo."
              : "Te la marcamos abajo."}
          </p>
        </div>
      )}

      {error && (
        <p className="mb-4 inline-flex rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({error}).
        </p>
      )}

      {/* Each connection has its own steps: Google exchanges an OAuth code,
          WhatsApp scans a QR. The catalog's `setup_flow` decides which. */}
      {dialog && cfg && dialog.setup_flow === "google-oauth" && (
        <GoogleDialog
          cfg={cfg}
          connection={dialog}
          onClose={() => setDialog(null)}
          onConnected={load}
        />
      )}
      {dialog && cfg && dialog.setup_flow === "whatsapp-qr" && (
        <WhatsAppDialog
          cfg={cfg}
          connection={dialog}
          onClose={() => setDialog(null)}
          onConnected={load}
          onRequest={() => requestConnection(dialog)}
        />
      )}

      {connections.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Todavía no hay conexiones disponibles"
          hint="Cuando agreguemos integraciones para tu agente, van a aparecer acá."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* 1 · What's needed right now. Comes from the flows: if the
              client requests a job that needs email, email shows up here
              that same day. */}
          {needed.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-c-amber-ink">
                Le hacen falta a tu agente
              </h2>
              <p className="mb-2.5 text-[13px] text-ink-soft">
                Sin esto, alguno de tus trabajos queda a medias.
              </p>
              <div className="grid gap-3 md:grid-cols-2">{needed.map(renderCard)}</div>
            </section>
          )}

          {/* 2 · What's already running. Compact: it's a reassurance signal,
              not something to read every day. */}
          {active.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Andando
              </h2>
              <Card className="!p-2">
                <div className="flex flex-col">
                  {active.map((c) => (
                    <details key={c.id} className="group px-2 py-1.5">
                      <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
                        <ConnectionLogo id={c.id} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {c.label}
                        </span>
                        <span className="text-[12px] font-medium text-ink-soft transition group-open:text-ink">
                          Permisos
                        </span>
                        <Chip tone="green"><Check className="h-3 w-3" /> Conectado</Chip>
                      </summary>
                      <div className="ml-11 mt-2 max-w-sm"><Permissions connection={c} /></div>
                    </details>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* 3 · The whole catalog, behind a gate. Nobody needs to see
              WhatsApp and Slack every day; whoever's looking for them looks
              for them. */}
          {others.length > 0 && (
            <section>
              {!showAll ? (
                <Btn kind="secondary" onClick={() => setShowAll(true)}>
                  <Plug className="h-4 w-4" />
                  Ver todo lo que se puede conectar ({others.length})
                </Btn>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                      Todo lo que se puede conectar
                    </h2>
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar…"
                        className={`${inputCls} w-44 py-1.5 text-[13px]`}
                      />
                      <Btn kind="ghost" size="sm" onClick={() => { setShowAll(false); setSearch(""); }}>
                        Ocultar
                      </Btn>
                    </div>
                  </div>
                  {filteredOthers.length === 0 ? (
                    <p className="text-[13px] text-ink-soft">Nada coincide con esa búsqueda.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">{filteredOthers.map(renderCard)}</div>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
