"use client";

// El chat DENTRO del onboarding: el cliente elige algo del carrusel y la
// conversación empieza ahí mismo, sin salir de la bienvenida.
//
// POR QUÉ NO SE REUSA LA PESTAÑA CHAT: la puerta del onboarding sigue montada
// y atrapa cualquier ruta, así que navegar desde acá no hace NADA visible. Y
// aunque se cerrara primero, mandar al cliente a otra pantalla en el medio de
// la bienvenida rompe el hilo justo cuando recién entendió qué le podés pedir.
//
// NO QUEDA HUÉRFANA: `chatStream` crea la sesión del lado del agente igual que
// el chat normal, así que esta misma conversación aparece después en la
// pestaña Chat. Es la bienvenida la que es efímera, no lo que se habló.
//
// Es a propósito más chico que el chat de verdad: sin sesiones, sin adjuntos,
// sin editar mensajes. Lo único que tiene que pasar acá es la primera vuelta.

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { chatStream, type ChatMessage, type PortalConfig } from "./agent";
import { accionDe } from "./palabras";
import Markdown from "./Markdown";
import { Btn, inputCls } from "./ui";

export default function ChatOnboarding({ cfg, pedido, nombreAgente, onListo, volviendoA }: {
  cfg: PortalConfig;
  pedido: string;
  nombreAgente: string;
  onListo: () => void;
  /** El cliente entró por un link a algo concreto: al cerrar vuelve ahí. */
  volviendoA?: boolean;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // QUÉ ESTÁ HACIENDO MIENTRAS NO ESCRIBE NADA. La primera respuesta del alta
  // tarda: una clienta de prueba esperó cinco minutos con "está pensando…"
  // fijo y un perro en la camilla. El gateway ya manda qué herramienta arranca
  // (`hermes.tool.progress`) y el chat de verdad lo usa; acá no se escuchaba.
  const [haciendo, setHaciendo] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const enCurso = useRef(false);
  const arrancado = useRef(false);
  const caja = useRef<HTMLDivElement>(null);

  const correr = async (texto: string, base: ChatMessage[]) => {
    if (enCurso.current || !texto.trim()) return;
    enCurso.current = true;
    setEnviando(true);
    setErr(null);
    setHaciendo(null);
    setSegundos(0);
    const historia: ChatMessage[] = [...base, { role: "user", content: texto }];
    setMsgs([...historia, { role: "assistant", content: "" }]);

    // Los deltas se pintan agrupados por frame: el markdown se re-parsea
    // entero en cada repintado y token por token trabaría la página.
    let pendiente: string | null = null;
    let frame = 0;
    const pintar = (t: string) => {
      pendiente = t;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pendiente !== null) {
          setMsgs([...historia, { role: "assistant", content: pendiente }]);
        }
      });
    };

    try {
      const final = await chatStream(cfg, historia, pintar, (tool) => setHaciendo(tool));
      if (frame) cancelAnimationFrame(frame);
      setMsgs([...historia, { role: "assistant", content: final }]);
    } catch (e) {
      if (frame) cancelAnimationFrame(frame);
      setMsgs(historia);
      setErr(e instanceof Error ? e.message : "no pude hablar con tu agente");
    } finally {
      enCurso.current = false;
      setEnviando(false);
      setHaciendo(null);
    }
  };

  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;
    correr(pedido, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El reloj de la espera. No es decoración: mientras el agente no escribe una
  // sola letra, es lo único que distingue "está trabajando" de "se colgó".
  useEffect(() => {
    if (!enviando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [enviando]);

  // EL CHAT BAJA SOLO, Y BAJA CON scrollTop.
  //
  // Antes era `fin.scrollIntoView({behavior:"smooth"})` y no funcionaba: el
  // markdown se re-pinta en cada frame del stream, así que cada repintado
  // cancelaba la animación suave del anterior y la caja nunca terminaba de
  // llegar abajo — el cliente tenía que arrastrar la barra a mano para leer lo
  // que su agente le estaba contestando. Mover `scrollTop` es instantáneo, no
  // se puede interrumpir, y mueve SOLO la caja (scrollIntoView además empuja
  // la página entera, que en el onboarding corre el personaje fuera de vista).
  //
  // OJO CON CÓMO SE DECIDE "EL CLIENTE SUBIÓ A RELEER": tiene que salir del
  // evento `scroll`, no de medir la distancia al fondo en cada repintado. Con
  // la medición, un párrafo largo que entra de golpe deja la caja a más de un
  // renglón del fondo sin que nadie haya tocado nada, y el chat se queda
  // clavado arriba para siempre. Probado en vivo: la respuesta bajaba y la
  // caja no la seguía. El navegador NO emite `scroll` cuando el contenido
  // crece, así que la bandera sobrevive intacta al stream.
  const pegado = useRef(true);
  const alScrollear = () => {
    const el = caja.current;
    if (!el) return;
    pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    const el = caja.current;
    if (!el || !pegado.current) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs, haciendo, segundos]);

  return (
    <div className="w-full animate-fadeup text-left">
      <div
        ref={caja}
        onScroll={alScrollear}
        className="max-h-[46vh] overflow-y-auto rounded-card border border-black/[0.07] bg-white p-4"
      >
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="mb-3 flex justify-end">
              <p className="max-w-[85%] rounded-xl bg-c-violet/60 px-3 py-2 text-[13.5px] leading-relaxed text-ink">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={i} className="mb-3">
              {m.content.trim() ? (
                <Markdown>{m.content}</Markdown>
              ) : (
                <Esperando nombre={nombreAgente} haciendo={haciendo} segundos={segundos} />
              )}
            </div>
          ),
        )}
        {err && (
          <p className="text-[13px] text-c-coral-ink">
            {err}. Podés seguir esta charla desde el chat cuando entres.
          </p>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !enviando && input.trim()) {
              const t = input.trim();
              setInput("");
              correr(t, msgs.filter((m) => m.content.trim()));
            }
          }}
          disabled={enviando}
          placeholder="Contestale…"
          aria-label="Tu respuesta"
          className={inputCls}
        />
        <Btn
          size="sm"
          disabled={enviando || !input.trim()}
          onClick={() => {
            const t = input.trim();
            setInput("");
            correr(t, msgs.filter((m) => m.content.trim()));
          }}
        >
          <ArrowUp className="h-4 w-4" />
        </Btn>
      </div>

      <div className="mt-5 flex flex-col items-center gap-2">
        <Btn kind="secondary" size="sm" onClick={onListo}>
          {volviendoA ? "Llevame a lo que vine a ver" : "Entrar al portal"}
        </Btn>
        <span className="text-[12px] text-ink-soft">
          Esta charla te espera en el chat, no se pierde.
        </span>
      </div>
    </div>
  );
}

/** La espera, contada. Tres cosas y ninguna inventada: qué herramienta está
 *  usando (traducida, nunca el nombre del motor), cuánto lleva, y —cuando se
 *  hace larga— que puede tardar de verdad y que no hace falta quedarse mirando.
 *
 *  Lo último es lo importante y es honesto: el primer pedido del alta suele ser
 *  el más caro de todos (el agente todavía no sabe nada del negocio) y hay
 *  respuestas de varios minutos. Eso no lo arregla el portal; lo que sí puede
 *  hacer es no dejar a alguien esperando en silencio delante de una pantalla. */
function Esperando({ nombre, haciendo, segundos }: {
  nombre: string; haciendo: string | null; segundos: number;
}) {
  const que = haciendo ? accionDe(haciendo).curso : null;
  return (
    <div className="text-[13px] leading-relaxed text-ink-soft">
      <p>
        {que ? `${nombre}: ${que.toLowerCase()}…` : `${nombre} está pensando…`}
        {segundos >= 5 && (
          <span className="ml-1.5 tabular-nums text-ink-soft/70">
            {segundos < 60
              ? `${segundos} s`
              : `${Math.floor(segundos / 60)} min ${segundos % 60} s`}
          </span>
        )}
      </p>
      {segundos >= 45 && (
        <p className="mt-1 text-[12.5px]">
          Esta primera puede llevarle unos minutos: todavía no sabe nada de tu
          negocio y está armando todo de cero. Podés dejar la pantalla abierta y
          seguir con lo tuyo.
        </p>
      )}
    </div>
  );
}
