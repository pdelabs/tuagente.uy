"use client";

// The portal's onboarding: shown ONCE, before any module. Step 1: the client
// names their agent -- giving it a name is the first decision they make about
// it. Step 2: the agent, now named, tells in three lines what's going to
// happen in here.
//
// Name and look are saved ON THE AGENT (POST /portal/identity, adapter 0.26+)
// and stay cached in localStorage. That way the agent is still theirs from any
// machine; the browser is just the fast copy. Having the agent also INTRODUCE
// itself with that name (writing it into the SOUL) is still pending.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellOff, Columns3, Dices, Hand, MessageSquare, X } from "lucide-react";
import { Btn, inputCls } from "./ui";
import { ExampleCarousel } from "./flowExamples";
import ChatOnboarding from "./ChatOnboarding";
import { urlPointsToDetail } from "./routes";
import {
  activateTelegramPairing, createConnectionRequest, getConnections, saveIdentity,
  type Connection, type Manifest, type PortalConfig,
} from "./agent";
import {
  AgentitoAnimated, RIVE_AXES, LOOK_DEFAULT, hasSavedLook, loadAgentLook,
  lookFromAgent, saveAgentLook, type AgentitoLook,
} from "./agentito";

const NAME_KEY = "tuagente_agent_name";

// Names for the naming step's placeholder. They're short, Rioplatense
// nicknames on purpose: a nickname reads as something you GIVE someone close
// to you, not as a person's formal identity -- which is exactly the reading
// we want to avoid. And nobody is legally named Chispa, so the odds of
// stepping on the client's own name are minimal.
const SUGGESTED_NAMES = [
  "Tota", "Rulo", "Pepa", "Milo", "Nina", "Beto", "Cuca", "Tito", "Lola",
  "Kiko", "Mora", "Nino", "Pocha", "Chispa", "Lino", "Juana", "Bruno", "Tuca", "Rosita", "Nilo",
];

/** The face it chose, captured from Rive's canvas: it ends up as the Telegram
 *  bot's photo (one of our tools uploads it over MTProto). If the canvas
 *  doesn't cooperate, naming still goes through, just without a photo. */
function agentitoCapture(): { avatar_png?: string } {
  try {
    const canvas = document.querySelector("canvas");
    if (!canvas || !canvas.width) return {};

    // The canvas does NOT get uploaded as-is. Rive draws with a TRANSPARENT
    // BACKGROUND, and Telegram doesn't support alpha in profile photos: it
    // flattens it against BLACK. The client's little orange face ended up
    // cropped onto a black square, with jagged edges. (Seen on 8/11 with
    // Washington.)
    //
    // So it gets composited onto the portal's own background, square, at
    // 512: that's the size Telegram uses for the large avatar, and shipping
    // anything smaller lets it get upscaled to that -- which is where the
    // jagged edges came from.
    const SIDE = 512;
    const offscreen = document.createElement("canvas");
    offscreen.width = SIDE;
    offscreen.height = SIDE;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return {};

    ctx.fillStyle = "#FBFAFF";           // bg-surface: the same one seen in the portal
    ctx.fillRect(0, 0, SIDE, SIDE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Square, centered and undistorted: onboarding's canvas isn't always
    // square, and a stretched face shows more than anything else would.
    const scale = Math.min(SIDE / canvas.width, SIDE / canvas.height);
    const w = canvas.width * scale;
    const h = canvas.height * scale;
    ctx.drawImage(canvas, (SIDE - w) / 2, (SIDE - h) / 2, w, h);

    const data = offscreen.toDataURL("image/png");
    if (data.startsWith("data:image/png") && data.length > 2000) {
      return { avatar_png: data.split(",", 2)[1] };
    }
  } catch { /* tainted canvas or no buffer: we carry on with no photo */ }
  return {};
}

/** A random look, guaranteed different from the current one. The agent's own
 *  naming and the team's first role naming roll the same dice. */
export function randomizeLook(current: AgentitoLook): AgentitoLook {
  for (;;) {
    const look = { ...current };
    for (const [axis, n] of Object.entries(RIVE_AXES) as [keyof AgentitoLook, number][]) {
      look[axis] = Math.floor(Math.random() * n);
    }
    if (Object.keys(RIVE_AXES).some((a) => look[a as keyof AgentitoLook] !== current[a as keyof AgentitoLook])) {
      return look;
    }
  }
}

/** The name's local copy. A single writer: naming, and the layout when it
 *  learns it from the manifest. */
export function saveAgentName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* private mode: at least it's good for this session */
  }
}

/** The name the client gave their agent, or null if they never named it. */
export function loadAgentName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

/** What we call the agent in the portal: the client's name, or the manifest's. */
export function agentDisplayName(manifest: Manifest | null): string {
  return loadAgentName() || manifest?.agent || "tu agente";
}

/** HAS THIS AGENT ALREADY GONE THROUGH HIRING/NAMING? THE AGENT answers this,
 *  not the browser.
 *
 *  It used to be decided by what this browser remembered, and the browser's
 *  memory gets wiped entirely when the agent changes (`forgetAgent`). Meaning
 *  that entering with the link to an already-configured agent -- from another
 *  machine, in incognito, or simply switching agents -- ran the whole
 *  onboarding flow again. And the last step, "Where do I notify you?", isn't
 *  an informational screen: answering it WRITES to the agent (`saveIdentity`)
 *  and overwrites whatever channel it already had configured.
 *
 *  Two data points and both come from the manifest:
 *  - `named`: the client has already given it a name at some point.
 *  - `notify_channel`: they already answered where they want to be notified.
 *    `"none"` IS an answer ("not right now"), and it's what makes
 *    `NoChannelNotice` offer it again inside the portal: it isn't the same as
 *    never having answered.
 *
 *  Absent (`null`/`undefined`) means "hasn't answered yet" -- and it's also
 *  what an old adapter sends when it doesn't publish the field. In both
 *  cases we'd rather ask: the price of asking too much is one screen; the
 *  price of not asking is a client with no notification channel, which is
 *  exactly what this flow exists to fix. */
export function hiringAlreadyAnswered(manifest: Manifest | null | undefined): boolean {
  return Boolean(manifest?.named) && (manifest?.notify_channel ?? "").trim() !== "";
}

/** THE SAME QUESTION, FOR A TEAM AGENT. On a team there's no naming step for
 *  the agent itself -- the client names whoever they hire, not the agent --
 *  so `named` never arrives and `hiringAlreadyAnswered` would always be
 *  false. What's left is the notify channel, and the same lesson applies:
 *  answering it WRITES to the agent, so a client who already answered doesn't
 *  get asked again when they come in from another machine. */
export function channelAlreadyAnswered(manifest: Manifest | null | undefined): boolean {
  return (manifest?.notify_channel ?? "").trim() !== "";
}

// What we tell in step 2: only what the manifest turns on.
//
// SHOWN WITH NO CARD, and that's not just aesthetics. They used to be three
// white boxes with a hairline border in a three-column grid -- i.e. the same
// look as the next screen's example carousel, which you DO touch and which
// starts the conversation. A test client tapped them one by one and wrote
// "they look clickable and do nothing". This is an index of what they'll
// find inside, not a menu: with no box there's nothing inviting a touch, and
// the screen's only control stays the button at the bottom.
const POINTS = [
  {
    key: "chat",
    icon: MessageSquare,
    tone: "bg-c-violet",
    title: "Chat",
    description: "Hablame como a cualquiera del equipo: me pedís las cosas en tus palabras.",
  },
  {
    key: "kanban",
    icon: Columns3,
    tone: "bg-c-amber",
    title: "Tablero",
    description: "Cada cosa que me pedís queda como una tarea, y ves en qué anda.",
  },
  {
    key: "approvals",
    icon: Hand,
    tone: "bg-c-coral",
    title: "Aprobaciones",
    description: "Antes de un paso sensible freno y espero tu visto bueno.",
  },
];

export default function Onboarding({ manifest, cfg, onDone, team }: {
  manifest: Manifest;
  cfg: PortalConfig;
  onDone: (name: string) => void;
  /** TEAM HIRING: who just joined the client's team.
   *
   *  When this is set, this onboarding runs TRIMMED DOWN -- the business and
   *  the notify channel, nothing else -- and it does so in the voice of the
   *  teammate the client just hired. Naming doesn't happen here: it already
   *  happened when they picked it (`lib/hiring.tsx`), and asking for a name
   *  again would mean naming someone twice. The overview doesn't show either:
   *  the three cards describe what ONE agent does, and this client has a team. *
   *
   *  What DOES stay is what team hiring doesn't ask and the portal still
   *  needs: what the business is (it's what triggers the brief) and where to
   *  notify them (without it the agent works and nobody finds out). */
  team?: { name: string; look: AgentitoLook } | null;
}) {
  // If the agent was ALREADY named (another machine, another person at the
  // company), it doesn't ask for the name again: it skips straight to the
  // overview.
  const alreadyNamed = Boolean(manifest.named);
  const [name, setName] = useState(
    () => team?.name ?? loadAgentName() ?? (alreadyNamed ? manifest.agent : ""));
  // The notify channel is its OWN step, not the overview's footer. It's the
  // decision that decides whether the portal is any use -- "the sheet is
  // waiting for me to show up and I'm not going to" -- and squeezed below
  // three cards it competed with them.
  const [step, setStep] = useState<"naming" | "business" | "overview" | "notify" | "automations" | "chat">(
    team ? "business" : alreadyNamed ? "overview" : "naming");
  // Who THE CLIENT is. Onboarding used to ask the agent's name and never the
  // business's: the portal ended up talking about "us" and the agent signing
  // with the previous owner's name.
  // Only once on mount: computing it during render would change on every
  // keystroke. And onboarding is never painted server-side (the gate waits
  // for localStorage), so Math.random here doesn't break hydration.
  const [suggested] = useState(
    () => SUGGESTED_NAMES[Math.floor(Math.random() * SUGGESTED_NAMES.length)]);
  const [company, setCompany] = useState("");
  const [url, setUrl] = useState("");
  // The options are NAMED CHANNELS, and "not now" is one of them. They used to
  // be two buttons, "Via Telegram" and "I don't use Telegram", and the second
  // wasn't an answer but another obligation: it asked for an email anyway.
  // Both test clients said the same thing in different words -- "I felt old
  // for not using Telegram" and "nobody in my neighborhood uses Telegram" --
  // and both ended up giving a piece of data just so the screen would let
  // them through.
  const [channel, setChannel] = useState<"telegram" | "whatsapp" | "email" | "none" | "">("");
  const [mail, setMail] = useState("");
  const [phone, setPhone] = useState("");
  // Choosing "Telegram" without activating it would leave the agent with
  // nowhere to write, so it gets activated right here. And the whole catalog,
  // not just Telegram: it's where we learn what THIS agent can do (does it
  // have a bot, is its email already connected) and what each connection is
  // called.
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  // What the client picked from the carousel: starts the chat without leaving here.
  const [prompt, setPrompt] = useState("");
  // WHERE TO GO BACK TO ON FINISHING. Onboarding puts itself in front of ANY
  // route, and closing it used to always send to /app/home: whoever arrived
  // with a link to a deliverable -- the one login promised it would respect --
  // ended up on the home page and had to go find what had been sent to them.
  // Captured once on mount, before anything touches the URL. (The credential
  // was already stripped from the hash in the layout; only the path and
  // params travel here.)
  const [linkDestination] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return urlPointsToDetail()
      ? window.location.pathname + window.location.search
      : null;
  });
  // While the photo is taken, the character STAYS STILL. The capture grabs
  // whatever frame is on screen, and in `calm` the agentito sips some
  // mate at ~20s and then every so often -- so it almost always got caught
  // mid-sip, straw halfway there. Nobody names their agent in under twenty
  // seconds. (Seen on 8/11 in Mr.Wobble's photo.)
  const [posing, setPosing] = useState(false);

  useEffect(() => {
    if (step !== "overview" && step !== "notify") return;
    getConnections(cfg)
      .then((r) => {
        setConnections(r.connections ?? []);
        if ((r.connections ?? []).some((c) => c.id === "telegram" && c.status === "connected")) {
          setPaired(true);
        }
      })
      .catch(() => { /* no catalog, we carry on: whatever can be tried gets offered */ });
  }, [step, cfg]);

  const connectionOf = (id: string) => connections?.find((c) => c.id === id) ?? null;
  const tg = connectionOf("telegram");

  // Two sources for the same datum, because the step CANNOT complete without
  // it: the manifest (adapter 0.35+, always present) and the connection
  // (which may not have arrived if the catalog call failed).
  const botHandle = manifest.telegram_bot
    || tg?.link?.replace(/^https:\/\/t\.me\//, "")
    || null;
  const botLink = botHandle ? `https://t.me/${botHandle}` : null;
  // Does THIS agent have Telegram? PRINCIPLE ZERO: the portal serves any
  // agent and we install the bot ourselves, one per client. With no
  // `TELEGRAM_BOT_TOKEN` there's no bot, the connection stays `disconnected`
  // and the manifest sends `telegram_bot: null` -- meaning there's nobody to
  // write to and the code step is impossible to finish. (Measured on 8/13 on
  // the lab's three agents: all three with no bot.) If the catalog didn't
  // arrive, we assume there isn't one: the cost of over-promising is paid by
  // the client waiting for a message that's never going to come.
  const hasTelegram = Boolean(manifest.telegram_bot)
    || tg?.status === "ready" || tg?.status === "connected";
  // Email only works as a channel if the company's inbox is ALREADY
  // connected: otherwise the agent has nowhere to write from.
  const emailConnected = connectionOf("email")?.status === "connected";

  const activateTelegram = async () => {
    if (!code.trim()) return;
    setActivating(true);
    setPairErr(null);
    try {
      const d = await activateTelegramPairing(cfg, code);
      if (!d.ok) throw new Error("No se pudo activar Telegram.");
      setPaired(true);
      // The channel gets recorded THE MOMENT it starts to exist, not at the
      // end of onboarding: if the client closes here, Telegram is already
      // running and the portal can't keep reminding them they're missing a
      // channel.
      saveIdentity(cfg, { contact: { channel: "telegram", value: "portal" } })
        .catch(() => { /* old or down adapter: retried on continue */ });
    } catch (e) {
      setPairErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  };

  // Researching a website is TWO things and the character has both: first the
  // magnifying glass sweeping (finding the site, going through it) and then
  // the book (reading what it found). A single gesture held for a minute
  // reads as a looping animation; alternating them looks like someone
  // working. It starts on `searching` because that's the real order. The state
  // machine crossfades gestures in 220ms, so the change doesn't jump.
  const readingWeb = (step === "overview" || step === "notify") && Boolean(url.trim());
  const [gesture, setGesture] = useState<"searching" | "reading">("searching");
  useEffect(() => {
    if (!readingWeb) return;
    setGesture("searching");
    const t = setInterval(
      () => setGesture((g) => (g === "searching" ? "reading" : "searching")), 5200);
    return () => clearInterval(t);
  }, [readingWeb]);

  const mailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.trim());
  // A Uruguayan phone number is eight or nine digits; with or without 598,
  // with or without spaces. Nothing more gets validated: what arrives is for
  // US to call, and bouncing the format back at someone who typed their
  // number correctly is the same toll, just smaller.
  const phoneOk = (phone.match(/\d/g)?.length ?? 0) >= 8;
  // THERE'S NO GATE ANYMORE. It used to be "either Telegram activated, or an
  // email": without that the button stayed off and you couldn't enter the
  // portal. The product decision (8/13) is that the channel can be left for
  // later -- the cost of forcing it was the client handing over some random
  // piece of data just to get through, which isn't a channel, it's a fake
  // formality. The only thing asked is to ANSWER the question: "Not now" is
  // an answer and sits next to the others.
  const answeredSomething = channel !== "";
  // ONE SINGLE CRITERION: can the agent write to them THROUGH HERE, TODAY?
  // It's the only question, and it's answered the same way for all four answers.
  //
  // Telegram only counts if it ended up paired (otherwise the agent would
  // write to a chat that doesn't exist). Email only counts if the company's
  // inbox is already connected -- which is what this very screen tells the
  // client two lines below. WhatsApp never counts yet. Everything else is "no
  // channel", and that gets SAVED (see `continueFromNotify`): a channel that
  // doesn't exist and a client who never answered can't be the same datum.
  const realChannel = channel === "telegram" && paired ? "telegram"
    : channel === "email" && mailOk && emailConnected ? "email"
      : null;
  // What gets handled by hand: there's nothing here the client can plug in
  // themselves, so it becomes a request of ours with their info attached.
  // Telegram lands on this list when the agent has no bot: the shortcut
  // doesn't exist, and instead of sending them to a screen where they still
  // couldn't do it, we request it for them.
  const connectionRequest = channel === "whatsapp" && phoneOk ? "whatsapp"
    : channel === "email" && mailOk && !emailConnected ? "email"
      : channel === "telegram" && !hasTelegram ? "telegram"
        : null;
  // Celebration counter: every naming fires the character's trigger.
  const [celebrations, setCelebrations] = useState(0);
  const [look, setLook] = useState<AgentitoLook>(
    () => (team?.look
      ?? (hasSavedLook()
        ? loadAgentLook()
        : lookFromAgent(manifest.look) ?? LOOK_DEFAULT)));
  const ready = name.trim().length > 0;

  const anotherLook = () => {
    const next = randomizeLook(look);
    saveAgentLook(next);
    setLook(next);
  };

  const submitName = async () => {
    if (!ready) return;
    const n = name.trim();
    // Pose first, photo after. The 450ms give Rive time to finish the
    // transition: capturing it on the same tick returns the old frame.
    setPosing(true);
    await new Promise((r) => setTimeout(r, 450));
    saveAgentName(n);
    setName(n);
    setCelebrations((f) => f + 1);
    setStep("business");
    // The name gets saved HERE, when it happens, not at the end of
    // onboarding. When the last step became mandatory (picking a channel),
    // the name used to sit in the browser until the very end: the agent went
    // through the whole Telegram pairing without knowing its own name, its
    // bot kept the old one, and if the client abandoned the flow there the
    // name was lost.
    const photo = agentitoCapture();
    setPosing(false);
    saveIdentity(cfg, { name: n, look, ...photo })
      .catch(() => { /* old or down adapter: the browser's copy stays */ });
  };

  /** Step 2 -> overview. The site gets sent HERE and not at the end: while the
   *  client reads the overview, the agent is already reading their site.
   *
   *  On team hiring the overview doesn't exist, so the brief still gets sent
   *  and it goes straight to the channel question. */
  const submitCompany = () => {
    const e = company.trim();
    if (!e) return;
    saveIdentity(cfg, {
      company: e,
      ...(url.trim() ? { url: url.trim() } : {}),
    }).catch(() => { /* old or down adapter: the portal carries on */ });
    setStep(team ? "notify" : "overview");
  };

  /** The same request the Connections tab leaves -- same helper, same ticket
   *  blocked from the start -- with the info the client just gave.
   *
   *  THE TITLE COMES FROM THE CATALOG, same as there (`Conectar ${label}`),
   *  not from a constant written here. It's the only thing Connections uses
   *  to recognize you already requested it: it used to compare its own label
   *  against the ticket's title, and since onboarding wrote "Conectar el
   *  correo de la empresa" while the catalog says "Correo de la empresa", it
   *  never matched -- the client who requested it in onboarding went to
   *  Connections, saw "Sin conectar", and requested it again. */
  const requestConnection = (id: "whatsapp" | "email" | "telegram") => {
    const label = connectionOf(id)?.label
      ?? (id === "whatsapp" ? "WhatsApp" : id === "email" ? "Correo de la empresa" : "Telegram");
    const detail = id === "whatsapp"
      ? `Número: ${phone.trim()}\n\n` +
        `Vía oficial (Cloud API): pide verificación de la empresa ante Meta y ` +
        `la tramitamos nosotros.`
      : id === "email"
        ? `Casilla: ${mail.trim()}\n\n` +
          `Hay que conectar la casilla de la empresa (IMAP/SMTP) para que el ` +
          `agente pueda escribir desde ahí.`
        : `Todavía no tiene un bot de Telegram propio: hay que crearlo y pasarle ` +
          `el link para que le mande el primer mensaje.`;
    createConnectionRequest(cfg, {
      title: `Conectar ${label}`,
      body:
        `Lo pidió en el alta del portal, cuando eligió por dónde quiere que le avise.\n` +
        detail +
        `\n\nNo hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
        `que hay que conectarlo y dejá el ticket esperando.`,
    }).catch(() => { /* if it couldn't be recorded, onboarding doesn't get stuck over it */ });
  };

  /** The notify step, resolved where it's decided and not at the end of onboarding.
   *
   *  Same lesson as naming: saving it only on the last screen meant losing it
   *  if the client closed before that -- and on top of it, it only saved if
   *  they'd gone through naming, so whoever entered from another machine into
   *  an ALREADY-named agent picked a channel that never got saved.
   *
   *  What does NOT get sent: `whatsapp` as a notify channel. The adapter only
   *  accepts telegram/email/none, and sending anything else fails the whole
   *  call. Until the kit adds it, WhatsApp lives as a request -- a ticket,
   *  same as in Connections -- and not as a channel.
   *
   *  AND SOMETHING ALWAYS GETS SAVED. It used to only record "none" for two of
   *  the four answers: picking WhatsApp, or email with an invalid address,
   *  wrote nothing, so the manifest stayed at `notify_channel: null` --
   *  indistinguishable from a client who never got to answer -- and the
   *  banner reminding them they're missing a channel never showed up. Right
   *  for the one who picked WhatsApp, who's the one who'll go longest with no
   *  channel. */
  const continueFromNotify = () => {
    const contact = realChannel === "telegram"
      ? { channel: "telegram" as const, value: "portal" }
      : realChannel === "email"
        ? { channel: "email" as const, value: mail.trim() }
        // No channel that actually works came out of this, no matter which
        // one they picked: it gets saved EXPLICITLY. It's what lets the
        // portal offer it again inside, and lets the agent know it has
        // nowhere to write.
        : { channel: "none" as const };
    if (answeredSomething) {
      saveIdentity(cfg, { contact })
        .catch(() => { /* old or down adapter: the portal carries on */ });
    }
    // What stayed in progress, so the inside banner doesn't talk to them as
    // if they'd said nothing. It's just the TEXT: who shows the banner is
    // decided by the manifest, which is where the truth comes from.
    rememberChannelInProgress(connectionRequest);
    if (connectionRequest) requestConnection(connectionRequest);
    // On team hiring this was the last question: the client already picked
    // someone and already waited for them to arrive, and the automations
    // carousel would offer to build a flow with an agent they don't know yet.
    // They enter the portal, which is where their team is.
    if (team) { finish(); return; }
    setStep("automations");
  };

  /** Closes onboarding and leaves the client where they were headed.
   *
   *  With no explicit destination it sends them to wherever the LINK THEY
   *  ENTERED WITH pointed, and only if it wasn't pointing anywhere specific,
   *  to home. */
  const finish = (destination?: string) => {
    const n = name.trim();
    onDone(n);
    // A HARD navigation on purpose. With router.push, closing onboarding
    // mounted the /app page -- which does replace("/app/home") in an effect
    // -- and swallowed the destination: "Build the first one" ended up on
    // Home. This happens once in a client's lifetime; one extra reload is
    // cheap next to a call to action that leads nowhere.
    window.location.assign(destination ?? linkDestination ?? "/app/home");
  };

  // The Approvals tab is conditional (it exists when something's waiting),
  // but here the CAPABILITY gets presented, not the tab: if there's a board,
  // there's an approval gate -- and it's the promise that builds the most trust.
  const points = POINTS.filter((p) =>
    p.key === "approvals" ? manifest.modules.kanban : manifest.modules[p.key]);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* The first thing a client sees of tuagente: the title is the
            product's thesis, and it turns naming into what it really is --
            giving a name to someone joining the team. */}
        {step === "business" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Ahora contame de vos
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Para trabajar necesito saber para quién. Con esto me alcanza para
              arrancar; el resto lo vamos corrigiendo sobre la marcha.
            </p>
          </div>
        )}
        {step === "overview" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Así vamos a trabajar
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Me pedís cosas en tus palabras, las resuelvo, y todo lo que hago
              queda a la vista acá.
            </p>
          </div>
        )}
        {step === "chat" && (
          <div className="mb-6 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Ya estamos
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
              Contestale lo que te pregunte y lo armamos entre los dos. Cuando
              quieras, entrá al portal: la charla sigue ahí.
            </p>
          </div>
        )}
        {step === "automations" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              ¿Qué te saco de encima?
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
              Lo mejor que puedo hacer por vos es ocuparme de lo que se repite,
              sin que tengas que acordarte. Tocá algo parecido a lo que
              necesitás y lo armamos ahora.
            </p>
          </div>
        )}
        {step === "notify" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              ¿Por dónde te aviso?
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Cuando termine algo tuyo o necesite tu ok, te escribo por donde
              vos digas. Si preferís verlo más adelante, también está bien.
            </p>
          </div>
        )}
        {step === "naming" && (
          <div className="mb-10 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Tu empresa tiene un empleado nuevo
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Va a trabajar para vos todos los días, y todo lo que haga queda a la
              vista en este portal. Empecemos por lo más importante: ponerle nombre.
            </p>
          </div>
        )}
        <div
          className={`relative transition-all duration-500 ${
            step === "naming" ? "h-40 w-40" : step === "chat" ? "h-16 w-16" : "h-28 w-28"
          }`}
        >
          {/* If it was handed the site, the agentito isn't idle: it's really
              reading it -- the adapter already created the brief's ticket.
              The gesture isn't decorative, it shows what's actually happening. */}
          <AgentitoAnimated
            celebrations={celebrations}
            look={look}
            state={posing ? "normal" : readingWeb ? gesture : "calm"}
            className="h-full w-full"
          />
          {/* The dice lives glued to the character: it changes ITS look, not the page. */}
          {step === "naming" && (
            <button
              onClick={anotherLook}
              title="Otro look"
              aria-label="Otro look"
              className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white shadow-soft transition hover:scale-105 hover:bg-black/[0.03] active:scale-95"
            >
              <Dices className="h-[18px] w-[18px] text-ink" />
            </button>
          )}
        </div>

        {/* "Hi! I'm ____" in the agent's voice is just plain ambiguous: a name
            field under a face has no subject, and filling it in feels like
            introducing yourself. It's solved with two things, not with
            wording:
            1. The PLACEHOLDER carries a name already. With a name already in
               there, the field reads as "here's a name for it" without
               explaining anything. It comes at random from a list: the odds
               of it landing on the client's own name are low enough not to
               worry about.
            2. Before this screen there'll be a login where the client already
               entered THEIR OWN name -- by the time they get here, the
               question of who's who is already answered. (Pending: that login
               doesn't exist yet.) */}
        {/* "Hi! I'm X" ONLY during naming. Repeating it afterward is
            introducing yourself again to someone who already gave you your
            name two screens ago: it reads as if it forgot. Everywhere else
            it's just the name, and what says what's happening is the h1 above. */}
        <h2 className={`mt-6 font-extrabold leading-tight tracking-tight text-ink ${step === "chat" ? "sr-only" : "text-[32px] sm:text-[38px]"}`}>
          {step !== "naming" ? (
            <span className="text-primary">{name}</span>
          ) : (
            <>
              ¡Hola! Soy{" "}
              {step === "naming" ? (
                <input
                  autoFocus
                  value={name}
                  maxLength={24}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitName()}
                  placeholder={suggested}
                  aria-label="Nombre para tu agente"
                  className="inline-block w-[6.5em] max-w-[70vw] border-b-[3px] border-black/15 bg-transparent text-center text-[32px] font-extrabold tracking-tight text-primary outline-none transition placeholder:font-extrabold placeholder:text-ink-soft/35 focus:border-primary sm:text-[38px]"
                />
              ) : (
                <span className="text-primary">{name}</span>
              )}
            </>
          )}
        </h2>

        {step === "naming" ? (
          <div className="mt-8">
            <Btn disabled={!ready} onClick={submitName}>
              Continuar <ArrowRight className="h-4 w-4" />
            </Btn>
          </div>
        ) : step === "business" ? (
          <div className="mt-6 w-full max-w-md animate-fadeup text-left">
            <label className="block text-[13px] font-semibold text-ink" htmlFor="ob-empresa">
              ¿Cómo se llama tu negocio?
            </label>
            <input
              id="ob-empresa"
              autoFocus
              value={company}
              maxLength={60}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && company.trim() && submitCompany()}
              placeholder="Farmacia Artigas"
              className={`${inputCls} mt-1.5`}
            />
            <p className="mt-1.5 text-[12px] text-ink-soft">
              Es como te voy a nombrar acá adentro y cuando escriba algo a nombre tuyo.
            </p>

            <label className="mt-5 block text-[13px] font-semibold text-ink" htmlFor="ob-url">
              ¿Tenés página web? <span className="font-normal text-ink-soft">(opcional)</span>
            </label>
            <input
              id="ob-url"
              value={url}
              maxLength={200}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && company.trim() && submitCompany()}
              placeholder="farmaciaartigas.com.uy"
              className={`${inputCls} mt-1.5`}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
              Si me la pasás, la leo mientras entrás y te dejo un resumen de lo que
              entendí de tu negocio. Es un borrador: lo vas a poder corregir.
            </p>

            <div className="mt-7 flex items-center gap-3">
              <Btn disabled={!company.trim()} onClick={submitCompany}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
            </div>
          </div>
        ) : step === "overview" ? (
          <div className="animate-fadeup">
            {points.length > 0 && (
              <div className="mt-8 grid gap-x-5 gap-y-6 text-left sm:grid-cols-3">
                {points.map((p) => {
                  const Icon = p.icon;
                  return (
                    <div key={p.key}>
                      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${p.tone}`}>
                        <Icon className="h-4 w-4 text-ink" />
                      </div>
                      <p className="text-sm font-bold text-ink">{p.title}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{p.description}</p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-8">
              <Btn onClick={() => setStep("notify")}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
            </div>
          </div>
        ) : step === "notify" ? (
          <div className="animate-fadeup">
            {/* It's the last question THE AGENT asks, and it reads as such. It
                gets its own screen because it's what decides whether the
                portal is any use -- a test client said it plainly: "the sheet
                is waiting for me to show up and I'm not going to". */}
            <div className="mx-auto mt-2 w-full max-w-md rounded-card border border-black/[0.07] bg-white p-5 text-left">
              <p className="text-[15px] font-bold text-ink">
                ¿Por dónde te aviso cuando pase algo?
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Cuando algo necesite tu ok, o cuando anote algo tuyo y quiera confirmarlo.
                Te escribo yo, no te llegan mails del sistema.
              </p>
              {/* FOUR ANSWERS, ALL NAMED. The fourth is "not now" and sits next
                  to the others on purpose: it's an answer, not an escape hatch
                  hidden at the bottom. WhatsApp is listed because it's what
                  half the country uses -- and it's listed telling the truth
                  about what it takes, instead of being missing and leaving the
                  client thinking the product doesn't get her. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ["telegram", "Telegram"],
                  ["whatsapp", "WhatsApp"],
                  ["email", "Correo"],
                  ["none", "Ahora no"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => { setChannel(k); setPairErr(null); }}
                    className={`rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
                      channel === k
                        ? "border-primary bg-c-violet/60 text-primary"
                        : "border-black/10 text-ink-soft hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Telegram gets activated HERE, but ONLY if this agent has a
                  bot. With no bot there's nobody to write to: the code box
                  used to sit there asking for something that was never going
                  to arrive. */}
              {channel === "telegram" && !hasTelegram && (
                <div className="mt-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    Todavía no tengo un Telegram propio: el bot te lo creamos
                    nosotros y no lo puedo prender yo desde acá. Es rápido —
                    cuando esté, te pasamos el link para que le mandes un hola y
                    listo.
                  </p>
                </div>
              )}
              {channel === "telegram" && hasTelegram && (
                paired ? (
                  <p className="mt-3 text-[13px] font-semibold text-c-green-ink">
                    Listo, ya nos hablamos por ahí.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {botLink && (
                      <a
                        href={botLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
                      >
                        Abrir el chat conmigo
                      </a>
                    )}
                    {/* The handle is ALSO written out, not just in the button:
                        if the connections call fails, the step goes back to
                        impossible. And this way it can be searched by hand
                        from the phone, which is where people have Telegram. */}
                    <p className="text-[12px] leading-snug text-ink-soft">
                      {botHandle
                        ? <>Buscame en Telegram como <span className="font-semibold text-ink">@{botHandle}</span> y mandame un hola. Te contesto con un código: pegalo acá.</>
                        : <>Mandame un hola por Telegram. Te contesto con un código: pegalo acá.</>}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={code}
                        onChange={(e) => { setCode(e.target.value); setPairErr(null); }}
                        onKeyDown={(e) => e.key === "Enter" && activateTelegram()}
                        placeholder="Código"
                        maxLength={16}
                        aria-label="Código de Telegram"
                        className={`${inputCls} w-36 font-mono uppercase`}
                      />
                      <Btn size="sm" disabled={!code.trim() || activating} onClick={activateTelegram}>
                        {activating ? "Activando…" : "Activar"}
                      </Btn>
                    </div>
                    {pairErr && <p className="text-[12px] text-c-coral-ink">{pairErr}</p>}
                  </div>
                )
              )}

              {/* WHATSAPP SAYS WHAT IT COSTS AND ISN'T OFFERED AS IF IT WERE A
                  BUTTON. What the kit has today are two paths: the official
                  one (Cloud API), which needs Meta to verify the business and
                  takes days, and a QR bridge that only exists if we install it
                  on the agent and that can get the number blocked. Neither one
                  is "press Connect": offering it that way is what threw a
                  Python error in a vet clinic's face. */}
              {channel === "whatsapp" && (
                <div className="mt-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    Por WhatsApp todavía no te puedo escribir solo. La vía que sirve
                    para un número de empresa pide que Meta verifique el negocio, y
                    ese trámite lo hacemos nosotros: suele llevar unos días. Dejanos
                    el número y lo arrancamos hoy.
                  </p>
                  <input
                    autoFocus
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="099 123 456"
                    inputMode="tel"
                    maxLength={30}
                    aria-label="Tu número de WhatsApp"
                    className={`${inputCls} mt-2`}
                  />
                  {/* The shortcut is offered ONLY if it exists on this agent.
                      Offering "Telegram in two taps" to an agent with no bot
                      sends her to a screen where she still can't do it either. */}
                  {hasTelegram && (
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                      Mientras tanto, si querés que te avise desde hoy, Telegram se
                      activa acá en dos toques.
                    </p>
                  )}
                </div>
              )}

              {channel === "email" && (
                <div className="mt-3">
                  <input
                    autoFocus
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    placeholder="tu@empresa.com"
                    aria-label="Tu mail"
                    className={inputCls}
                  />
                  {/* Honesty: by mail I do NOT write to you yet, UNLESS the
                      company's inbox is already connected. We connect the
                      email ourselves (it needs the inbox's own credentials),
                      so without that it's a request, not a promise. */}
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                    {emailConnected
                      ? "La casilla de tu empresa ya está conectada: te escribo desde ahí."
                      : "Para escribirte por mail necesitamos conectar la casilla de la empresa, "
                        + "y eso lo hacemos nosotros. Dejanos tu dirección y te contactamos para "
                        + "dejarlo andando."}
                  </p>
                </div>
              )}

              {/* What gets lost, said once and without drama: it doesn't
                  change what the agent does, it changes who notifies whom. */}
              {channel === "none" && (
                <div className="mt-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    Entonces no te escribo a ningún lado: lo que haga te va a estar
                    esperando acá y lo ves cuando entres. Trabaja igual — lo que
                    cambia es que te enterás cuando venís, en vez de que te avise yo.
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                    {hasTelegram
                      ? "Cuando quieras prenderlo, está en Conexiones y son dos minutos."
                      : "Cuando quieras, entrá a Conexiones y pedilo desde ahí: lo dejamos andando nosotros y te avisamos."}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              <Btn disabled={!answeredSomething} onClick={continueFromNotify}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
              {/* What's going to happen on tapping Continue, said before
                  tapping it. It's the line that spares the surprise of a
                  client who picked something, continued, and only found out
                  inside that nothing was going to reach her. */}
              <span className="max-w-sm text-[12px] leading-relaxed text-ink-soft">
                {channel === ""
                  ? "Elegí una, o tocá «Ahora no» si preferís verlo más adelante."
                  : realChannel === "telegram"
                    ? "Listo: te escribo por Telegram."
                    : realChannel === "email"
                      ? "Listo: te escribo a esa dirección."
                      : channel === "telegram"
                        ? hasTelegram
                          ? "Todavía no lo activaste: entrás sin avisos y lo terminás cuando quieras desde Conexiones."
                          : "Queda pedido: te lo dejamos andando y te avisamos. Mientras tanto entrás sin avisos."
                        : channel === "whatsapp"
                          ? phoneOk
                            ? "Queda pedido: te escribimos para conectarlo. Mientras tanto entrás sin avisos."
                            : "Dejanos el número, o seguí y lo vemos más adelante."
                          : channel === "email"
                            ? mailOk
                              ? "Queda pedido: te escribimos para conectar la casilla. Mientras tanto entrás sin avisos."
                              : "Escribí tu dirección, o seguí y lo vemos más adelante."
                            : "Seguís sin avisos. Lo vemos cuando quieras desde Conexiones."}
                {url.trim() && (
                  <> Mientras tanto sigo leyendo tu web: lo que saque queda en Entregas.</>
                )}
              </span>
            </div>
          </div>
        ) : step === "chat" ? (
          <ChatOnboarding
            cfg={cfg}
            request={prompt}
            agentName={name || "Tu agente"}
            onDone={() => finish()}
            returningTo={Boolean(linkDestination)}
          />
        ) : (
          <div className="w-full animate-fadeup">
            <ExampleCarousel onPick={(p) => { setPrompt(p); setStep("chat"); }} />
            {/* Primary is building the first one: the whole point of
                onboarding is that the client walks away with ONE thing
                running, not that they enter the portal. "Go to home" still
                exists -- forcing it would be a toll, and whoever wants to
                look around before deciding has to be able to. */}
            <div className="mt-7 flex flex-col items-center gap-3">
              <Btn onClick={() => {
                setPrompt(
                  "Quiero que te encargues de algo que se repite en mi empresa. " +
                  "Proponeme dos o tres cosas que podrías hacer solo, de a una por " +
                  "vez, y armamos la que más me sirva.");
                setStep("chat");
              }}>
                Contarle lo mío <ArrowRight className="h-4 w-4" />
              </Btn>
              <button
                onClick={() => finish()}
                className="text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
              >
                {linkDestination ? "Ahora no, llevame a lo que vine a ver" : "Ahora no, ir al inicio"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* ── The other half of letting the channel step be skipped ───────────────── */

const CHANNEL_POSTPONED_KEY = "tuagente_channel_postponed";
// Which channel is IN PROGRESS on our side, so the banner doesn't talk to
// them as if they'd answered nothing. It's just the text: who sees the banner
// is decided by the manifest. Lives under the `tuagente_` prefix, so it gets
// wiped on an agent change like everything else.
const CHANNEL_IN_PROGRESS_KEY = "tuagente_channel_in_progress";

/** What we asked them to connect, if they asked for anything. */
export function rememberChannelInProgress(channel: "whatsapp" | "email" | "telegram" | null) {
  try {
    if (channel) localStorage.setItem(CHANNEL_IN_PROGRESS_KEY, channel);
    else localStorage.removeItem(CHANNEL_IN_PROGRESS_KEY);
  } catch { /* private mode: the banner falls back to the generic text, which is still correct */ }
}

const IN_PROGRESS_MESSAGE: Record<string, string> = {
  whatsapp: "Estamos conectando tu WhatsApp; hasta que esté, lo que haga te espera acá.",
  email: "Estamos conectando la casilla de tu empresa; hasta que esté, lo que haga te espera acá.",
  telegram: "Te estamos prendiendo el Telegram; hasta que esté, lo que haga te espera acá.",
};

/** The reminder that there's still no channel to notify through.
 *
 *  Letting them in with no channel is only honest if the portal offers it
 *  again: otherwise "later" means never, and the client is left with an
 *  agent that works and never tells them -- which is exactly what both test
 *  clients said would keep them from paying.
 *
 *  Shows up when NO CHANNEL THAT ACTUALLY WORKS came out of onboarding, which
 *  it saves as `notify_channel: "none"` no matter which one the client
 *  picked. With old adapters the field doesn't arrive and nothing shows: it's
 *  better to remind nobody than to remind someone who already has their
 *  channel set. It can be dismissed, and dismissing it lasts: the path isn't
 *  lost because Connections is still there. */
export function NoChannelNotice({ manifest }: { manifest: Manifest }) {
  const [closed, setClosed] = useState(true);
  const [inProgress, setInProgress] = useState<string | null>(null);
  useEffect(() => {
    try {
      setClosed(localStorage.getItem(CHANNEL_POSTPONED_KEY) === "1");
      setInProgress(localStorage.getItem(CHANNEL_IN_PROGRESS_KEY));
    } catch {
      setClosed(false);
    }
  }, []);
  if (manifest.notify_channel !== "none" || closed) return null;
  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(CHANNEL_POSTPONED_KEY, "1");
    } catch { /* private mode: good for this session */ }
  };
  // Where it leads: to whatever it left requested, if it left something; if
  // not, to the Telegram shortcut ONLY when this agent has a bot; and if not
  // that either, to the whole screen, where the real path is to request it.
  // And the link doesn't say "pick a channel": it's the one time the client
  // would see the word the whole flow deliberately avoided.
  const target = inProgress && IN_PROGRESS_MESSAGE[inProgress]
    ? `/app/connections?connection=${inProgress}`
    : manifest.telegram_bot
      ? "/app/connections?connection=telegram"
      : "/app/connections";
  return (
    <div className="border-b border-black/[0.07] bg-c-amber/25 px-6 py-2.5 md:px-8">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <BellOff className="h-4 w-4 shrink-0 text-c-amber-ink" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-c-amber-ink">
          {(inProgress && IN_PROGRESS_MESSAGE[inProgress])
            || "Todavía no tengo por dónde avisarte: lo que haga te espera acá hasta que entres."}{" "}
          <Link
            href={target}
            className="font-semibold underline underline-offset-2"
          >
            {inProgress && IN_PROGRESS_MESSAGE[inProgress] ? "Ver cómo va" : "Decime por dónde te aviso"}
          </Link>
        </p>
        <button
          onClick={close}
          aria-label="Cerrar el aviso"
          title="Cerrar el aviso"
          className="shrink-0 rounded-lg p-1 text-c-amber-ink transition hover:bg-black/[0.05]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
