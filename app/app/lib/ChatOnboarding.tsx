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
import Markdown from "./Markdown";
import { Btn, inputCls } from "./ui";

export default function ChatOnboarding({ cfg, pedido, nombreAgente, onListo }: {
  cfg: PortalConfig;
  pedido: string;
  nombreAgente: string;
  onListo: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const enCurso = useRef(false);
  const arrancado = useRef(false);
  const fin = useRef<HTMLDivElement>(null);

  const correr = async (texto: string, base: ChatMessage[]) => {
    if (enCurso.current || !texto.trim()) return;
    enCurso.current = true;
    setEnviando(true);
    setErr(null);
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
      const final = await chatStream(cfg, historia, pintar);
      if (frame) cancelAnimationFrame(frame);
      setMsgs([...historia, { role: "assistant", content: final }]);
    } catch (e) {
      if (frame) cancelAnimationFrame(frame);
      setMsgs(historia);
      setErr(e instanceof Error ? e.message : "no pude hablar con tu agente");
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  };

  useEffect(() => {
    if (arrancado.current) return;
    arrancado.current = true;
    correr(pedido, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  return (
    <div className="w-full animate-fadeup text-left">
      <div className="max-h-[46vh] overflow-y-auto rounded-card border border-black/[0.07] bg-white p-4">
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
                <p className="text-[13px] text-ink-soft">{nombreAgente} está pensando…</p>
              )}
            </div>
          ),
        )}
        {err && (
          <p className="text-[13px] text-c-coral-ink">
            {err}. Podés seguir esta charla desde el chat cuando entres.
          </p>
        )}
        <div ref={fin} />
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
        <Btn kind="secondary" size="sm" onClick={onListo}>Entrar al portal</Btn>
        <span className="text-[12px] text-ink-soft">
          Esta charla te espera en el chat, no se pierde.
        </span>
      </div>
    </div>
  );
}
