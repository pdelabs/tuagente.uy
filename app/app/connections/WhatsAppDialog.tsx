"use client";

// WhatsApp's own steps. Each connection has its own: Google exchanges an
// OAuth code, Telegram pastes a pairing code, and here a QR gets scanned.
//
// Pairing does NOT start on its own. The bridge used to request a QR the
// moment it came up, it expired after 3 minutes, restarted, and asked for
// another one -- burning sessions forever with nobody watching. Now it
// starts when the client presses "Start", which is when they actually have
// the phone in hand.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import {
  getWhatsAppPairQr, getWhatsAppPairStatus, startWhatsAppPairing,
  type Connection, type PortalConfig,
} from "../lib/agent";
import { Btn, Modal, Spinner } from "../lib/ui";
import { ConnectionLogo } from "../lib/ConnectionLogo";

type PairStatus = { paired: boolean; pairing: boolean; has_qr: boolean };

/** THIS IS THE ERROR A VETERINARY CLINIC READ ON SCREEN:
 *  «el puente de WhatsApp no responde: <urlopen error [Errno -2] Name or
 *  service not known>» [the WhatsApp bridge isn't responding]. It's not a
 *  passing outage and retrying won't fix it: the QR bridge is a SEPARATE
 *  service that gets installed on the agent when the client asks for it, so
 *  on 99% of agents it simply doesn't exist. The adapter can't tell "not
 *  installed" apart from "is down" -- both are a failing urlopen -- but for
 *  the client the useful answer is the same: you don't have this path, and
 *  the one that works we do for you. */
const NOT_INSTALLED = /name or service not known|no responde|connection refused|econnrefused|temporary failure in name resolution|urlopen|503/i;

export default function WhatsAppDialog({ cfg, connection, onClose, onConnected, onRequest }: {
  cfg: PortalConfig; connection: Connection; onClose: () => void; onConnected: () => void;
  /** Ask that we connect it ourselves: the same request as the card's. */
  onRequest?: () => void;
}) {
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // The QR is fetched and turned into a blob: an <img src> does NOT send the
  // authorization header, and the adapter's endpoint requires bearer -- the
  // pairing code can't be left open to anyone.
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const alreadyNotified = useRef(false);
  // Did the agent ever manage to answer? If it never answered and the error
  // is "not installed", there's nothing to retry.
  const hasAnswered = useRef(false);

  const fetchStatus = useCallback(() => getWhatsAppPairStatus(cfg), [cfg]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const poll = () => {
      fetchStatus()
        .then(async (d: PairStatus) => {
          if (!alive) return;
          hasAnswered.current = true;
          setStatus(d);
          if (d.paired && !alreadyNotified.current) { alreadyNotified.current = true; onConnected(); }
          if (!d.has_qr) { setQrUrl((v) => { if (v) URL.revokeObjectURL(v); return null; }); return; }
          try {
            const url = URL.createObjectURL(await getWhatsAppPairQr(cfg));
            if (!alive) { URL.revokeObjectURL(url); return; }
            setQrUrl((v) => { if (v) URL.revokeObjectURL(v); return url; });
          } catch { /* the next tick retries */ }
        })
        .catch((e) => {
          if (!alive) return;
          const msg = e instanceof Error ? e.message : String(e);
          setErr(msg);
          // The bridge isn't installed: that doesn't change while the dialog
          // stays open, so hitting it again every 3 seconds is pure load on
          // the client's agent just to read the same 503 again.
          if (!hasAnswered.current && NOT_INSTALLED.test(msg)) stop();
        });
    };
    poll();
    timer = setInterval(poll, 3000);   // the QR rotates every few seconds
    return () => { alive = false; stop(); };
  }, [fetchStatus, onConnected, cfg]);

  // Release the last blob on close.
  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);

  // No status plus a network error on the agent's side = the bridge isn't there.
  const noBridge = Boolean(err && !status && NOT_INSTALLED.test(err));

  const start = () => {
    setStarting(true);
    setErr(null);
    startWhatsAppPairing(cfg)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setStarting(false));
  };

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <ConnectionLogo id={connection.id} />
          <div>
            <p className="text-sm font-bold text-ink">Conectar WhatsApp</p>
            {/* The subtitle used to announce "Scanning a code, like WhatsApp
                Web" right above the text that says this path isn't
                installed. It's only said once it's known: while it isn't
                known, nothing gets promised. */}
            {noBridge ? (
              <p className="text-[12px] text-ink-soft">Lo tramitamos nosotros.</p>
            ) : status?.paired ? (
              <p className="text-[12px] text-ink-soft">Ya está vinculado.</p>
            ) : status ? (
              <p className="text-[12px] text-ink-soft">Escaneando un código, como WhatsApp Web.</p>
            ) : null}
          </div>
        </div>

        {noBridge ? (
          /* Neither the risk notice nor the button: there's nothing to press
             here. The only honest thing is to say this path isn't there and
             offer the one that is. */
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              La vía del código QR no está instalada en tu agente: es un agregado
              aparte y hoy no lo tiene. Igual no es la que te conviene para el
              número de la empresa.
            </p>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              La que sirve para una línea comercial es la oficial de WhatsApp.
              Pide que Meta verifique tu empresa y la tramitamos nosotros: son
              unos días y no tenés que configurar nada.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {onRequest && (
                <Btn size="sm" onClick={() => { onRequest(); onClose(); }}>
                  Pedir que la conecten
                </Btn>
              )}
              <Btn kind="secondary" size="sm" onClick={onClose}>Cerrar</Btn>
            </div>
          </div>
        ) : status?.paired ? (
          <div className="flex flex-col items-start gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-c-green-ink">
              <Check className="h-4 w-4" /> ¡Conectado! Tu agente ya puede leer tus mensajes.
            </p>
            <p className="text-[12px] leading-relaxed text-ink-soft">
              Mandar mensajes arranca <strong>apagado</strong>. Lo prendés vos cuando quieras,
              en los permisos de esta conexión.
            </p>
            <Btn size="sm" onClick={onClose}>Listo</Btn>
          </div>
        ) : (
          <>
            {/* The risk goes BEFORE the button, not in a footnote. */}
            <div className="mb-4 flex gap-2.5 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-c-amber-ink" />
              <p className="text-[12.5px] leading-relaxed text-c-amber-ink">
                <strong>Usá un número que no sea el de la empresa.</strong> Esta vía no es la
                oficial de WhatsApp, y te pueden bloquear el número que escanees. Para la línea
                comercial existe la vía oficial: lleva días y la tramitamos nosotros.
              </p>
            </div>

            {!status?.pairing ? (
              <div className="flex items-center gap-3">
                <Btn onClick={start} disabled={starting}>
                  {starting ? "Preparando…" : "Empezar"}
                </Btn>
                <span className="text-[12px] text-ink-soft">
                  Tené el teléfono a mano: el código dura unos segundos.
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {qrUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={qrUrl}
                    alt="Código QR para vincular WhatsApp"
                    width={240}
                    height={240}
                    className="rounded-lg border border-black/[0.07]"
                  />
                ) : (
                  <div className="flex h-[240px] w-[240px] items-center justify-center">
                    <Spinner />
                  </div>
                )}
                <ol className="w-full text-[12.5px] leading-relaxed text-ink-soft">
                  <li>1. Abrí WhatsApp en el teléfono.</li>
                  <li>2. Andá a <strong>Dispositivos vinculados</strong> → Vincular dispositivo.</li>
                  <li>3. Apuntá a este código.</li>
                </ol>
              </div>
            )}
          </>
        )}
        {/* The engine's raw text is NEVER shown: if it's the missing-bridge
            case it's already covered above, and any other error is said in
            plain Spanish. It stays in the `title` for us. */}
        {err && !noBridge && (
          <p className="mt-3 text-[13px] font-medium text-c-coral-ink" title={err}>
            No pude preparar el código. Probá de nuevo en un rato; si sigue igual,
            escribinos y lo conectamos nosotros.
          </p>
        )}
      </div>
    </Modal>
  );
}
