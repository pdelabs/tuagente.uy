"use client";

// Los pasos propios de WhatsApp. Cada conexión tiene los suyos: Google canjea
// un código OAuth, Telegram pega un código de pairing, y acá se escanea un QR.
//
// El pareo NO arranca solo. Antes el puente pedía un QR apenas levantaba,
// se vencía a los 3 minutos, reiniciaba y volvía a pedir otro — quemando
// sesiones para siempre sin que nadie mirara. Ahora arranca cuando el cliente
// aprieta "Empezar", que es cuando de verdad tiene el teléfono en la mano.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import type { Connection, PortalConfig } from "../lib/agent";
import { Btn, Modal, Spinner } from "../lib/ui";
import { ConexionLogo } from "../lib/ConexionLogo";

type Estado = { paired: boolean; pairing: boolean; has_qr: boolean };

/** ESTE ES EL ERROR QUE UNA VETERINARIA LEYÓ EN LA PANTALLA:
 *  «el puente de WhatsApp no responde: <urlopen error [Errno -2] Name or
 *  service not known>». No es una caída pasajera y no se arregla reintentando:
 *  el puente del QR es un servicio APARTE que se le instala al agente cuando el
 *  cliente lo pide, así que en el 99% de los agentes simplemente no existe. El
 *  adapter no puede distinguir "no está instalado" de "está caído" —los dos son
 *  un urlopen que falla— pero para el cliente la respuesta útil es la misma:
 *  esta vía no la tenés, y la que sirve la hacemos nosotros. */
const NO_ESTA = /name or service not known|no responde|connection refused|econnrefused|temporary failure in name resolution|urlopen|503/i;

export default function DialogoWhatsApp({ cfg, conexion, onCerrar, onConectada, onPedir }: {
  cfg: PortalConfig; conexion: Connection; onCerrar: () => void; onConectada: () => void;
  /** Pedir que lo conectemos nosotros: el mismo pedido de la tarjeta. */
  onPedir?: () => void;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [arrancando, setArrancando] = useState(false);
  // El QR se trae con fetch y se vuelve un blob: un <img src> NO manda el
  // header de autorización, y el endpoint del adapter pide bearer — el
  // código de pareo no puede quedar abierto a cualquiera.
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const yaAviso = useRef(false);
  // ¿El agente llegó a contestar alguna vez? Si nunca contestó y el error es
  // "no está instalado", no hay nada que reintentar.
  const contesto = useRef(false);

  const pedir = useCallback(async (ruta: string, metodo = "GET") => {
    const r = await fetch(`${cfg.adapter}/portal/connections/whatsapp/pair${ruta}`, {
      method: metodo, headers: { Authorization: `Bearer ${cfg.key}` },
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
    return d;
  }, [cfg]);

  useEffect(() => {
    let vivo = true;
    let reloj: ReturnType<typeof setInterval> | null = null;
    const frenar = () => { if (reloj) { clearInterval(reloj); reloj = null; } };
    const mirar = () => {
      pedir("")
        .then(async (d: Estado) => {
          if (!vivo) return;
          contesto.current = true;
          setEstado(d);
          if (d.paired && !yaAviso.current) { yaAviso.current = true; onConectada(); }
          if (!d.has_qr) { setQrUrl((v) => { if (v) URL.revokeObjectURL(v); return null; }); return; }
          try {
            const r = await fetch(
              `${cfg.adapter}/portal/connections/whatsapp/pair/qr.png?t=${Date.now()}`,
              { headers: { Authorization: `Bearer ${cfg.key}` } });
            if (!r.ok) return;
            const url = URL.createObjectURL(await r.blob());
            if (!vivo) { URL.revokeObjectURL(url); return; }
            setQrUrl((v) => { if (v) URL.revokeObjectURL(v); return url; });
          } catch { /* el próximo tick reintenta */ }
        })
        .catch((e) => {
          if (!vivo) return;
          const msg = e instanceof Error ? e.message : String(e);
          setErr(msg);
          // El puente no está instalado: eso no cambia mientras el diálogo esté
          // abierto, así que seguir pegándole cada 3 segundos es pura carga
          // sobre el agente del cliente para volver a leer el mismo 503.
          if (!contesto.current && NO_ESTA.test(msg)) frenar();
        });
    };
    mirar();
    reloj = setInterval(mirar, 3000);   // el QR rota cada pocos segundos
    return () => { vivo = false; frenar(); };
  }, [pedir, onConectada, cfg]);

  // Soltar el último blob al cerrar.
  useEffect(() => () => { if (qrUrl) URL.revokeObjectURL(qrUrl); }, [qrUrl]);

  // Sin estado y con un error de red del lado del agente = el puente no está.
  const sinPuente = Boolean(err && !estado && NO_ESTA.test(err));

  const empezar = () => {
    setArrancando(true);
    setErr(null);
    pedir("/start", "POST")
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setArrancando(false));
  };

  return (
    <Modal onClose={onCerrar}>
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <ConexionLogo id={conexion.id} />
          <div>
            <p className="text-sm font-bold text-ink">Conectar WhatsApp</p>
            {/* El subtítulo anunciaba "Escaneando un código, como WhatsApp Web"
                justo arriba del texto que dice que esa vía no está instalada.
                Se dice recién cuando se sabe: mientras no se sabe, no se
                promete nada. */}
            {sinPuente ? (
              <p className="text-[12px] text-ink-soft">Lo tramitamos nosotros.</p>
            ) : estado?.paired ? (
              <p className="text-[12px] text-ink-soft">Ya está vinculado.</p>
            ) : estado ? (
              <p className="text-[12px] text-ink-soft">Escaneando un código, como WhatsApp Web.</p>
            ) : null}
          </div>
        </div>

        {sinPuente ? (
          /* Ni el aviso del riesgo ni el botón: acá no hay nada que apretar.
             Lo único honesto es decir que esta vía no está y ofrecer la que
             sí existe. */
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
              {onPedir && (
                <Btn size="sm" onClick={() => { onPedir(); onCerrar(); }}>
                  Pedir que la conecten
                </Btn>
              )}
              <Btn kind="secondary" size="sm" onClick={onCerrar}>Cerrar</Btn>
            </div>
          </div>
        ) : estado?.paired ? (
          <div className="flex flex-col items-start gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-c-green-ink">
              <Check className="h-4 w-4" /> ¡Conectado! Tu agente ya puede leer tus mensajes.
            </p>
            <p className="text-[12px] leading-relaxed text-ink-soft">
              Mandar mensajes arranca <strong>apagado</strong>. Lo prendés vos cuando quieras,
              en los permisos de esta conexión.
            </p>
            <Btn size="sm" onClick={onCerrar}>Listo</Btn>
          </div>
        ) : (
          <>
            {/* El riesgo va ANTES del botón, no en un pie de página. */}
            <div className="mb-4 flex gap-2.5 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-c-amber-ink" />
              <p className="text-[12.5px] leading-relaxed text-c-amber-ink">
                <strong>Usá un número que no sea el de la empresa.</strong> Esta vía no es la
                oficial de WhatsApp, y te pueden bloquear el número que escanees. Para la línea
                comercial existe la vía oficial: lleva días y la tramitamos nosotros.
              </p>
            </div>

            {!estado?.pairing ? (
              <div className="flex items-center gap-3">
                <Btn onClick={empezar} disabled={arrancando}>
                  {arrancando ? "Preparando…" : "Empezar"}
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
        {/* El texto crudo del motor NUNCA a la vista: si el caso es el del
            puente ausente ya está contado arriba, y cualquier otro se dice en
            castellano. Queda en el `title` para nosotros. */}
        {err && !sinPuente && (
          <p className="mt-3 text-[13px] font-medium text-c-coral-ink" title={err}>
            No pude preparar el código. Probá de nuevo en un rato; si sigue igual,
            escribinos y lo conectamos nosotros.
          </p>
        )}
      </div>
    </Modal>
  );
}
