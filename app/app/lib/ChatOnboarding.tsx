"use client";

// The chat INSIDE onboarding: the client picks something from the carousel
// and the conversation starts right there, without leaving the welcome screen.
//
// WHY THE CHAT TAB ISN'T REUSED: onboarding's gate stays mounted and swallows
// any route, so navigating from here does NOTHING visible. And even if it
// closed first, sending the client to another screen in the middle of the
// welcome flow breaks their train of thought right when they just understood
// what they can ask for.
//
// NOTHING IS ORPHANED: `chatStream` creates the session on the agent's side
// just like the regular chat, so this same conversation shows up later on the
// Chat tab. It's the welcome screen that's ephemeral, not what got talked about.
//
// It's deliberately smaller than the real chat: no sessions, no attachments,
// no editing messages. The only thing that has to happen here is the first
// exchange.

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { chatStream, type ChatMessage, type PortalConfig } from "./agent";
import { actionFor } from "./labels";
import Markdown from "./Markdown";
import { Btn, inputCls } from "./ui";

export default function ChatOnboarding({ cfg, request, agentName, onDone, returningTo }: {
  cfg: PortalConfig;
  request: string;
  agentName: string;
  onDone: () => void;
  /** The client arrived through a link to something specific: closing returns them there. */
  returningTo?: boolean;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // WHAT IT'S DOING WHILE IT WRITES NOTHING. Onboarding's first reply takes a
  // while: a test client waited five minutes staring at a fixed "está
  // pensando…" with a dog on the exam table. The gateway already sends which
  // tool is starting (`hermes.tool.progress`) and the real chat uses it; this
  // one wasn't listening.
  const [doing, setDoing] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const inFlight = useRef(false);
  const started = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const run = async (text: string, base: ChatMessage[]) => {
    if (inFlight.current || !text.trim()) return;
    inFlight.current = true;
    setSending(true);
    setErr(null);
    setDoing(null);
    setSeconds(0);
    const history: ChatMessage[] = [...base, { role: "user", content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);

    // Deltas are painted grouped per frame: the markdown gets fully
    // re-parsed on every repaint, and doing it token by token would lock up
    // the page.
    let pending: string | null = null;
    let frame = 0;
    const paint = (t: string) => {
      pending = t;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pending !== null) {
          setMsgs([...history, { role: "assistant", content: pending }]);
        }
      });
    };

    try {
      const final = await chatStream(cfg, history, paint, (tool) => setDoing(tool));
      if (frame) cancelAnimationFrame(frame);
      setMsgs([...history, { role: "assistant", content: final }]);
    } catch (e) {
      if (frame) cancelAnimationFrame(frame);
      setMsgs(history);
      setErr(e instanceof Error ? e.message : "no pude hablar con tu agente");
    } finally {
      inFlight.current = false;
      setSending(false);
      setDoing(null);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(request, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The waiting clock. Not decoration: while the agent hasn't written a
  // single letter, it's the only thing that tells "it's working" apart from
  // "it hung".
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [sending]);

  // THE CHAT SCROLLS DOWN ON ITS OWN, AND IT DOES SO WITH scrollTop.
  //
  // It used to be `end.scrollIntoView({behavior:"smooth"})` and it didn't
  // work: the markdown repaints on every frame of the stream, so each repaint
  // canceled the previous smooth animation and the box never finished
  // reaching the bottom -- the client had to drag the scrollbar by hand to
  // read what their agent was answering. Setting `scrollTop` is instant, it
  // can't be interrupted, and it moves ONLY the box (scrollIntoView also
  // pushes the whole page, which in onboarding scrolls the character out of
  // view).
  //
  // WATCH HOW "THE CLIENT SCROLLED UP TO RE-READ" GETS DECIDED: it has to come
  // from the `scroll` event, not from measuring the distance to the bottom on
  // every repaint. With the measurement, a long paragraph arriving all at
  // once leaves the box more than a line from the bottom with nobody having
  // touched anything, and the chat stays stuck at the top forever. Tested
  // live: the reply scrolled down and the box didn't follow it. The browser
  // does NOT emit `scroll` when content grows, so the flag survives the
  // stream untouched.
  const stuck = useRef(true);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  useEffect(() => {
    const el = box.current;
    if (!el || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs, doing, seconds]);

  return (
    <div className="w-full animate-fadeup text-left">
      <div
        ref={box}
        onScroll={onScroll}
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
                <Waiting name={agentName} doing={doing} seconds={seconds} />
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
            if (e.key === "Enter" && !sending && input.trim()) {
              const t = input.trim();
              setInput("");
              run(t, msgs.filter((m) => m.content.trim()));
            }
          }}
          disabled={sending}
          placeholder="Contestale…"
          aria-label="Tu respuesta"
          className={inputCls}
        />
        <Btn
          size="sm"
          disabled={sending || !input.trim()}
          onClick={() => {
            const t = input.trim();
            setInput("");
            run(t, msgs.filter((m) => m.content.trim()));
          }}
        >
          <ArrowUp className="h-4 w-4" />
        </Btn>
      </div>

      <div className="mt-5 flex flex-col items-center gap-2">
        <Btn kind="secondary" size="sm" onClick={onDone}>
          {returningTo ? "Llevame a lo que vine a ver" : "Entrar al portal"}
        </Btn>
        <span className="text-[12px] text-ink-soft">
          Esta charla te espera en el chat, no se pierde.
        </span>
      </div>
    </div>
  );
}

/** The wait, narrated. Three things and none of them invented: which tool
 *  it's using (translated, never the engine's own name), how long it's been,
 *  and -- once it runs long -- that it can genuinely take a while and there's
 *  no need to sit staring at it.
 *
 *  That last part is the important one and it's honest: onboarding's first
 *  request tends to be the most expensive of all (the agent doesn't know
 *  anything about the business yet) and some replies take several minutes.
 *  The portal can't fix that; what it can do is not leave someone waiting in
 *  silence in front of a screen. */
function Waiting({ name, doing, seconds }: {
  name: string; doing: string | null; seconds: number;
}) {
  const what = doing ? actionFor(doing).inProgress : null;
  return (
    <div className="text-[13px] leading-relaxed text-ink-soft">
      <p>
        {what ? `${name}: ${what.toLowerCase()}…` : `${name} está pensando…`}
        {seconds >= 5 && (
          <span className="ml-1.5 tabular-nums text-ink-soft/70">
            {seconds < 60
              ? `${seconds} s`
              : `${Math.floor(seconds / 60)} min ${seconds % 60} s`}
          </span>
        )}
      </p>
      {seconds >= 45 && (
        <p className="mt-1 text-[12.5px]">
          Esta primera puede llevarle unos minutos: todavía no sabe nada de tu
          negocio y está armando todo de cero. Podés dejar la pantalla abierta y
          seguir con lo tuyo.
        </p>
      )}
    </div>
  );
}
