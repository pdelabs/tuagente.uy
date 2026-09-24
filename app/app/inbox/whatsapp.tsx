"use client";

// The Bandeja's WhatsApp half: the link to the owner's number, the contact
// pictures, and the chat the owner took over from her phone.
//
// THE AGENT'S WHATSAPP IS A LINKED DEVICE OF THE OWNER'S OWN NUMBER, the way
// WhatsApp Web is. So everything here is said the way WhatsApp says it on her
// phone — «Dispositivos vinculados», «Vincular un dispositivo» — because that
// is the screen she will be looking at with the portal open next to it.
//
// WHAT CAN GET THE NUMBER BANNED IS DECIDED HERE. A linked device that asks
// WhatsApp for forty profile pictures in a second looks like a scraper, and a
// banned number is the client's business phone gone. So a picture is asked
// for only when its row is on screen, one at a time with a pause between two,
// and never twice in the life of the page (`avatarQueue`).

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Check, Loader2, QrCode, RefreshCw, Smartphone, TriangleAlert, Unlink } from "lucide-react";
import {
  cancelWhatsAppPairing, getWhatsAppAvatar, getWhatsAppChat, getWhatsAppPairing,
  getWhatsAppStatus, logoutWhatsApp, resumeWhatsAppChat, startWhatsAppPairing,
  type PortalConfig, type WhatsAppChat, type WhatsAppPairing, type WhatsAppStatus,
} from "../lib/agent";
import { WhatsAppGlyph } from "../lib/glyphs";
import { dateAndTime, momentOf } from "../lib/labels";
import { pollNow, useChanges } from "../lib/live";
import { Btn, supportWhatsApp } from "../lib/ui";
import { initialsOf, phoneLabel, takenOverUntil } from "./conversation";

/* ── Seen on screen ─────────────────────────────────────────────────────── */

/** True from the first time the element scrolls into view. It does not go
 *  back to false: what was fetched for a row stays fetched. */
export function useSeen<T extends Element>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/* ── Profile pictures ───────────────────────────────────────────────────── */

// One picture per jid for the life of the page: an object URL, or null for a
// contact who has none. A refresh of the list does not ask again.
const avatars = new Map<string, string | null>();
const waiting = new Map<string, ((url: string | null) => void)[]>();
const avatarQueue: (() => Promise<void>)[] = [];
let draining = false;
// Between two asks. Scrolling through a long list asks for a picture every
// half second at most — what a person opening chats by hand looks like.
const AVATAR_GAP_MS = 500;

async function drain() {
  if (draining) return;
  draining = true;
  while (avatarQueue.length) {
    await avatarQueue.shift()!();
    await new Promise((r) => setTimeout(r, AVATAR_GAP_MS));
  }
  draining = false;
}

function requestAvatar(cfg: PortalConfig, jid: string, done: (url: string | null) => void) {
  if (avatars.has(jid)) { done(avatars.get(jid)!); return; }
  const queued = waiting.get(jid);
  if (queued) { queued.push(done); return; }
  waiting.set(jid, [done]);
  avatarQueue.push(async () => {
    // A failed ask is a picture we do not have: the initials stay, and the
    // page does not ask WhatsApp again for it.
    const blob = await getWhatsAppAvatar(cfg, jid).catch(() => null);
    const url = blob ? URL.createObjectURL(blob) : null;
    avatars.set(jid, url);
    waiting.get(jid)?.forEach((f) => f(url));
    waiting.delete(jid);
  });
  drain();
}

/** The round face of a conversation: the contact's WhatsApp picture when
 *  there is one and its row has been on screen, their initials otherwise. */
export function ContactAvatar({ cfg, jid, name, seen, className = "h-9 w-9" }: {
  cfg: PortalConfig;
  jid: string | null;
  name: string;
  seen: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(() => (jid ? avatars.get(jid) ?? null : null));
  useEffect(() => {
    if (!jid || !seen) return;
    let alive = true;
    requestAvatar(cfg, jid, (u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [cfg, jid, seen]);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className={`${className} shrink-0 rounded-full border border-black/[0.07] object-cover`} />
    );
  }
  return (
    <span
      aria-hidden
      className={`${className} inline-flex shrink-0 items-center justify-center rounded-full bg-c-violet text-[12px] font-bold text-c-violet-ink`}
    >
      {initialsOf(name)}
    </span>
  );
}

/* ── One chat's record ──────────────────────────────────────────────────── */

/** The engine's record of a WhatsApp chat: the contact's name and number, and
 *  whether the owner took it over. Asked for only once the row is on screen
 *  and again when anything WhatsApp moves. It is the engine's own table, not
 *  a query to WhatsApp, so it carries none of the pictures' risk. */
export function useWhatsAppChat(cfg: PortalConfig | null, jid: string | null, seen = true) {
  const [chat, setChat] = useState<WhatsAppChat | null>(null);
  const load = useCallback(() => {
    if (!cfg || !jid || !seen) return;
    getWhatsAppChat(cfg, jid).then(setChat).catch(() => {});
  }, [cfg, jid, seen]);
  useEffect(() => { setChat(null); load(); }, [load]);
  useChanges(["whatsapp"], load);
  return { chat, reload: load };
}

/* ── The owner took it over ─────────────────────────────────────────────── */

/** «Hasta las 18:40», or «hasta mañana a las 09:00» when it is not today. */
function untilLabel(ms: number): string {
  const p = dateAndTime(ms);
  if (!p) return "";
  return p.date === "hoy" ? `hasta las ${p.time}` : `hasta el ${p.date} a las ${p.time}`;
}

/** The banner on a WhatsApp thread the owner is answering from her phone,
 *  with the one thing to do about it: give it back. */
export function TakeoverBanner({ cfg, chat, onResumed }: {
  cfg: PortalConfig; chat: WhatsAppChat; onResumed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const until = takenOverUntil(chat);
  if (until === null) return null;
  const resume = () => {
    setBusy(true);
    setFailed(false);
    resumeWhatsAppChat(cfg, chat.jid)
      .then(() => { onResumed(); pollNow(); })
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-c-violet bg-c-violet/40 px-3 py-2">
      <Smartphone className="h-3.5 w-3.5 shrink-0 text-c-violet-ink" />
      <p className="min-w-0 flex-1 text-[13px] font-medium text-c-violet-ink">
        La estás atendiendo vos: tu agente no le contesta {untilLabel(until)}.
        {failed && " No pude avisarle, probá de nuevo."}
      </p>
      <Btn kind="secondary" size="sm" disabled={busy} onClick={resume}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Que la retome el agente
      </Btn>
    </div>
  );
}

/* ── The link to the owner's number ─────────────────────────────────────── */

const secondsLeft = (at: string | number | null | undefined) => {
  const ms = momentOf(at)?.ms;
  return ms === undefined ? null : Math.max(0, Math.round((ms - Date.now()) / 1000));
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** How often the QR is asked for while it is on screen. WhatsApp rotates the
 *  code every ~20 s and the engine hands the new one here. */
const PAIRING_POLL_MS = 2_000;

/** The QR, the countdown, and what to do with the phone. Pure: what it draws
 *  is `pairing`, and the parent owns the polling. */
export function PairingCard({ pairing, onRetry, onCancel }: {
  pairing: WhatsAppPairing | null;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);
  const state = pairing?.state ?? "pending";
  const left = secondsLeft(pairing?.expires_at);

  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-4">
      <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-lg border border-black/[0.07] bg-white">
          {state === "pending" && pairing?.qr_png ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pairing.qr_png} alt="Código QR para vincular WhatsApp" className="h-48 w-48" />
          ) : state === "pending" ? (
            <Loader2 className="h-5 w-5 animate-spin text-ink-soft" />
          ) : (
            <QrCode className="h-10 w-10 text-black/15" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">Escaneá el código con tu celular</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
            <li>Abrí WhatsApp en tu celular.</li>
            <li>Tocá <b className="font-semibold text-ink">Dispositivos vinculados</b> (en Ajustes, o en el menú de los tres puntos).</li>
            <li>Tocá <b className="font-semibold text-ink">Vincular un dispositivo</b>.</li>
            <li>Escaneá este código con la cámara que se abre.</li>
          </ol>
          {state === "pending" && (
            <p className="mt-3 text-[12px] text-ink-soft">
              {left === null || !pairing?.qr_png
                ? "Generando el código…"
                : left > 0
                  ? `El código se renueva en ${clock(left)}.`
                  : "Renovando el código…"}
            </p>
          )}
          {state === "timeout" && (
            <p className="mt-3 text-[13px] font-medium text-c-amber-ink">
              El código venció sin que lo escanearas.
            </p>
          )}
          {state === "error" && (
            <p className="mt-3 text-[13px] font-medium text-c-coral-ink">
              No se pudo vincular. Generá otro código y probá de nuevo.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {(state === "timeout" || state === "error") && (
              <Btn kind="primary" size="sm" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" />
                Generar otro código
              </Btn>
            )}
            <Btn kind="ghost" size="sm" onClick={onCancel}>Cancelar</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What each state that is not «connected» tells the owner, and whether the
 *  way out is linking again. */
const DOWN: Partial<Record<WhatsAppStatus["state"], { title: string; text: string; relink: boolean }>> = {
  unpaired: {
    title: "Conectá tu WhatsApp",
    text: "Tu agente contesta los mensajes que le llegan a tu WhatsApp, con tus reglas. Se vincula como un dispositivo más de tu número, igual que WhatsApp Web: tu celular sigue funcionando como siempre.",
    relink: true,
  },
  disconnected: {
    title: "WhatsApp se desconectó",
    text: "Tu agente no está recibiendo mensajes de WhatsApp. Suele volver solo en unos minutos; si no vuelve, vinculalo de nuevo.",
    relink: true,
  },
  logged_out: {
    title: "WhatsApp quedó desvinculado",
    text: "Se cerró la sesión desde el celular, o pasó mucho tiempo sin conexión. Hasta que lo vuelvas a vincular, tu agente no contesta por WhatsApp.",
    relink: true,
  },
  banned: {
    title: "WhatsApp bloqueó este número; escribinos",
    text: "Tu agente no puede usar este número. No lo vuelvas a vincular: escribinos y lo vemos juntos.",
    relink: false,
  },
};

/** The line or the card at the top of the Bandeja that says whether the
 *  agent is on the owner's WhatsApp, and lets her link it or unlink it. The
 *  parent draws it only when `manifest.modules.whatsapp` is on. */
export function WhatsAppPanel({ cfg }: { cfg: PortalConfig }) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [pairing, setPairing] = useState<WhatsAppPairing | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [justLinked, setJustLinked] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loadStatus = useCallback(() => {
    getWhatsAppStatus(cfg).then(setStatus).catch((e) => setFailure(e.message));
  }, [cfg]);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useChanges(["whatsapp"], loadStatus);

  // A pairing started somewhere else (another tab, a reload mid-scan) is
  // still a QR waiting to be scanned: show it.
  const open = pairingOpen || status?.state === "pairing";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const ask = () => getWhatsAppPairing(cfg)
      .then((p) => {
        if (!alive) return;
        setPairing(p);
        if (p.state === "completed") {
          setPairingOpen(false);
          setPairing(null);
          setJustLinked(true);
          loadStatus();
        }
        if (p.state === "cancelled") { setPairingOpen(false); setPairing(null); loadStatus(); }
      })
      .catch(() => {});
    ask();
    const t = setInterval(ask, PAIRING_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [open, cfg, loadStatus]);

  const startPairing = () => {
    setBusy(true);
    setFailure(null);
    setPairing(null);
    startWhatsAppPairing(cfg)
      .then(() => setPairingOpen(true))
      .catch((e) => setFailure(e.message))
      .finally(() => setBusy(false));
  };
  const cancelPairing = () => {
    setPairingOpen(false);
    setPairing(null);
    cancelWhatsAppPairing(cfg).catch(() => {}).finally(loadStatus);
  };
  const unlink = () => {
    setBusy(true);
    setFailure(null);
    logoutWhatsApp(cfg)
      .then(() => { setConfirmUnlink(false); setJustLinked(false); loadStatus(); })
      .catch((e) => setFailure(e.message))
      .finally(() => setBusy(false));
  };

  if (!status) return null;

  // A pairing that stopped (timeout, error) keeps its card up: the way on is
  // «Generar otro código», and it should not vanish under her.
  const stuck = pairing && (pairing.state === "timeout" || pairing.state === "error");
  if (open || stuck) {
    return (
      <div className="mb-4">
        <PairingCard pairing={pairing} onRetry={startPairing} onCancel={cancelPairing} />
      </div>
    );
  }

  if (status.state === "connected") {
    const who = [phoneLabel(status.phone), status.push_name && `(${status.push_name})`]
      .filter(Boolean).join(" ");
    return (
      <div
        className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 ${
          justLinked ? "border-c-green bg-c-green/40" : "border-black/[0.07] bg-white"
        }`}
      >
        <WhatsAppGlyph className={`h-4 w-4 shrink-0 ${justLinked ? "text-c-green-ink" : "text-ink-soft"}`} />
        <p className={`min-w-0 flex-1 text-[13px] ${justLinked ? "font-medium text-c-green-ink" : "text-ink"}`}>
          {justLinked && <Check className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />}
          {justLinked ? "Listo, quedó vinculado. " : ""}
          WhatsApp conectado{who ? `: ${who}` : ""}
        </p>
        {confirmUnlink ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-soft">Tu agente deja de contestar por WhatsApp.</span>
            <Btn kind="danger" size="sm" disabled={busy} onClick={unlink}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sí, desvincular
            </Btn>
            <Btn kind="ghost" size="sm" disabled={busy} onClick={() => setConfirmUnlink(false)}>
              Cancelar
            </Btn>
          </div>
        ) : (
          <Btn kind="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>
            <Unlink className="h-3.5 w-3.5" />
            Desvincular
          </Btn>
        )}
        {failure && <p className="w-full text-[12px] text-c-coral-ink">No pude desvincularlo: {failure}</p>}
      </div>
    );
  }

  if (status.state === "connecting" || status.state === "pairing") {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-black/[0.07] bg-white px-3 py-2 text-[13px] text-ink-soft">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Conectando WhatsApp…
      </div>
    );
  }

  const down = DOWN[status.state] ?? DOWN.disconnected!;
  const tone = status.state === "banned"
    ? "border-c-coral bg-c-coral/30"
    : status.state === "unpaired" ? "border-black/[0.07] bg-white" : "border-c-amber bg-c-amber/25";
  const Icon = status.state === "unpaired" ? WhatsAppGlyph : TriangleAlert;
  return (
    <div className={`mb-4 rounded-xl border p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.04]">
          <Icon className="h-4 w-4 text-ink" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{down.title}</p>
          <p className="mt-1 max-w-xl text-[13px] text-ink-soft">{down.text}</p>
          {status.phone && status.state !== "unpaired" && (
            <p className="mt-1 text-[12px] text-ink-soft">Número: {phoneLabel(status.phone)}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {down.relink ? (
              <Btn kind="primary" size="sm" disabled={busy} onClick={startPairing}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
                {status.state === "unpaired" ? "Vincular WhatsApp" : "Vincular de nuevo"}
              </Btn>
            ) : (
              <a
                href={supportWhatsApp(
                  `Hola, WhatsApp bloqueó el número ${phoneLabel(status.phone)} de mi agente.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
              >
                Escribinos
              </a>
            )}
          </div>
          {failure && <p className="mt-2 text-[12px] text-c-coral-ink">No pude empezar: {failure}</p>}
        </div>
      </div>
    </div>
  );
}
