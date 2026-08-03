"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Send, Sparkles, X } from "lucide-react";

type Action =
  | { type: "goto"; seccion: string }
  | { type: "blog"; slug: string }
  | { type: "html"; titulo: string; html: string }
  | { type: "whatsapp"; mensaje: string };

type Msg = {
  role: "user" | "assistant";
  content: string;
  html?: { titulo: string; html: string };
  whatsapp?: string;
  did?: string[];
};

const MAX_USER_MSGS = 10;

const SUGGESTIONS = [
  "¿Qué podés hacer?",
  "Tengo una distribuidora, ¿qué agente me sirve?",
  "¿Cuánto sale?",
];

const SECTION_LABEL: Record<string, string> = {
  casos: "Casos",
  "como-funciona": "Cómo funciona",
  control: "Control",
  planes: "Planes",
  faq: "FAQ",
  contacto: "Contacto",
};

export default function AgentWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hola 👋 Soy un agente de verdad, corriendo en vivo. Pedime algo: te llevo por la página, te armo una propuesta para tu negocio, lo que quieras.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const userCount = msgs.filter((m) => m.role === "user").length;
  const capped = userCount >= MAX_USER_MSGS;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, open]);

  function runActions(actions: Action[], target: Msg) {
    const did: string[] = [];
    for (const a of actions) {
      if (a.type === "goto") {
        const el = document.getElementById(a.seccion);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.animate(
            [{ boxShadow: "0 0 0 5px rgba(91,75,232,0.55)" }, { boxShadow: "0 0 0 5px rgba(91,75,232,0)" }],
            { duration: 1800, easing: "ease-out" }
          );
          did.push(`→ Te llevé a ${SECTION_LABEL[a.seccion] ?? a.seccion}`);
        }
      }
      if (a.type === "blog") {
        window.open(`/blog/${a.slug}`, "_blank", "noopener");
        did.push("→ Te abrí el artículo en otra pestaña");
      }
      if (a.type === "html") target.html = { titulo: a.titulo, html: a.html };
      if (a.type === "whatsapp") target.whatsapp = a.mensaje;
    }
    target.did = did;
  }

  async function send(text: string) {
    const clean = text.trim().slice(0, 500);
    if (!clean || busy || capped) return;
    const next: Msg[] = [...msgs, { role: "user", content: clean }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await r.json();
      const reply: Msg = { role: "assistant", content: data.reply ?? "Hecho ✅" };
      runActions(Array.isArray(data.actions) ? data.actions : [], reply);
      setMsgs((cur) => [...cur, reply]);
    } catch {
      setMsgs((cur) => [
        ...cur,
        { role: "assistant", content: "Se me cortó la conexión 🤖 Probá de nuevo en un ratito." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[90] inline-flex items-center gap-2.5 rounded-pill bg-primary px-5 py-3.5 text-sm font-extrabold text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-primary-dark"
        >
          <span className="relative grid h-6 w-6 place-items-center">
            <Bot size={22} />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-primary bg-c-green-ink" />
          </span>
          <span className="hidden sm:inline">Probá un agente en vivo</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-[90] flex h-[min(600px,calc(100dvh-2.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-card bg-white shadow-lift ring-1 ring-ink/10">
          <div className="flex items-center justify-between border-b border-ink/5 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-white">
                <Bot size={20} />
              </span>
              <div>
                <p className="text-sm font-extrabold text-ink">Tu agente</p>
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                  <span className="h-2 w-2 rounded-full bg-c-green-ink" /> en línea · demo real
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5"
              aria-label="Cerrar"
            >
              <X size={17} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
            {msgs.map((m, i) => (
              <div key={i}>
                {m.role === "user" ? (
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 font-medium text-white">
                    {m.content}
                  </div>
                ) : (
                  <div className="w-fit max-w-[92%] space-y-2">
                    <div className="rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                      {m.content}
                    </div>
                    {m.did?.map((d) => (
                      <p key={d} className="pl-1 text-xs font-bold text-primary">{d}</p>
                    ))}
                    {m.html && (
                      <div className="overflow-hidden rounded-2xl border border-ink/10">
                        <p className="flex items-center gap-1.5 bg-c-violet px-3 py-2 text-xs font-extrabold text-c-violet-ink">
                          <Sparkles size={12} /> {m.html.titulo} — armado en vivo
                        </p>
                        <iframe
                          sandbox=""
                          srcDoc={m.html.html}
                          className="h-72 w-full bg-white"
                          title={m.html.titulo}
                        />
                      </div>
                    )}
                    {m.whatsapp && (
                      <a
                        href={`https://wa.me/59899002835?text=${encodeURIComponent(m.whatsapp)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-pill bg-c-green px-4 py-2.5 text-xs font-extrabold text-c-green-ink transition hover:-translate-y-0.5"
                      >
                        Mandar por WhatsApp (ya te lo escribí) <ArrowRight size={13} />
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="w-fit rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 shadow-soft">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:240ms]" />
                </span>
              </div>
            )}
            {msgs.length === 1 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-pill border border-primary/25 bg-c-violet/60 px-3.5 py-2 text-xs font-bold text-primary transition hover:bg-c-violet"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {capped && (
              <p className="pt-2 text-center text-xs font-medium text-ink-soft">
                La demo llega hasta acá 😄 Lo que sigue, mejor por WhatsApp.
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-ink/5 px-3 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={capped ? "Demo terminada" : "Pedile algo…"}
              disabled={busy || capped}
              maxLength={500}
              className="min-w-0 flex-1 rounded-pill border border-ink/10 bg-surface px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft/60 focus:border-primary/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || capped || !input.trim()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-white transition hover:bg-primary-dark disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
