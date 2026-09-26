"use client";

// Portal shell: sidebar built from the manifest + connection status with the
// agent. Features live in subfolders and do NOT touch this file.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, BookOpen, ChevronDown, Columns3, Folder, Hand, Home, Images,
  Inbox, LifeBuoy, LogOut, MessageSquare, Puzzle, Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  loadConfig, clearConfig, getManifest, getApprovals, getFlows, getTickets, APPROVALS_EVENT,
  learnAgentUtcOffset, CONFIG_KEY, savedConfig,
  credentialInUrl, sameSession,
  type PortalConfig, type Manifest,
} from "./lib/agent";
import { Btn, SUPPORT, Support, Spinner, inputCls } from "./lib/ui";
import { pollNow, startChangeFeed, useChanges } from "./lib/live";
import {
  notifyRouteChange, stripCredentialFromUrl, urlPointsToDetail, useUrlPointsToDetail,
  backToTab,
} from "./lib/routes";
import { INTROS, useIntroGate } from "./lib/intros";
import Onboarding, {
  NoChannelNotice, loadAgentName, onboardingAlreadyAnswered, saveAgentName,
} from "./lib/onboarding";
import {
  AgentitoAvatar, loadAgentLook, lookFromAgent, saveAgentLook,
} from "./lib/agentito";

// Module order and labels; only the ones the manifest enables get shown
// (except "home", which is ours and doesn't depend on what the agent
// exposes). `sec` = lives under "Más": the workshop views (files, usage,
// skills…). The main nav is what the client uses daily: their flows, their
// chat, their in-progress work.
// Modules the agent declares but the portal does NOT show yet. It's a switch,
// not a deletion: the screen, its route and its welcome screen stay whole,
// and removing the key from here brings them back to the nav.
//
// `skills` since 9/26/2026 (Luis): the agent's instruction files, read-only,
// with names only we understand — nothing a client can act on. The page stays
// at /app/skills for us. `usage` too, the same day: what the agent costs is
// ours to watch — she pays a flat monthly — and the page stays at /app/usage.
//
// `usage` sat here from 8/16 to 8/19/2026, because the
// number it showed was FALSE, and false in the worst direction: it only saw
// what passed through litellm, and image generation hits the provider
// directly (the tab said US$0.17 the day the provider charged US$1.52 -- 9x).
// It came back once the number stopped being ours: it now comes from the
// agent's own OpenRouter account (`/portal/usage`), which is what they were
// actually charged.
export const HIDDEN_MODULES = new Set<string>(["skills", "usage"]);

export const MODULES: { key: string; path: string; label: string; icon: LucideIcon; sec?: boolean }[] = [
  { key: "home", path: "/app/home", label: "Inicio", icon: Home },
  { key: "chat", path: "/app/chat", label: "Chat", icon: MessageSquare },
  // Bandeja right after Chat, and ABOVE Tablero, because it is the tab with
  // somebody waiting on the other side: a mail that came in is a person, and a
  // person waits worse than a task does. What lands here is the channel
  // tickets and ONLY those -- the Tablero asks the same endpoint for
  // everything else, so no ticket is on both screens.
  { key: "inbox", path: "/app/inbox", label: "Bandeja", icon: Inbox },
  // Posteos: a daily flow writes one every morning and leaves it here. A generic icon and not
  // lucide's `Instagram`: the module is "what your agent left ready to
  // publish", and naming one network in the nav would promise the portal
  // knows which one it goes to -- it doesn't, and tomorrow the same tab holds
  // another.
  { key: "posts", path: "/app/posts", label: "Posteos", icon: Images },
  // Marca: everything the agent knows about the business, for the owner to
  // confirm or correct. Right after Posteos because that is where it shows
  // most -- a post in the wrong voice is corrected here, not there.
  { key: "business", path: "/app/brand", label: "Marca", icon: BookOpen },
  { key: "approvals", path: "/app/approvals", label: "Aprobaciones", icon: Hand },
  // ACTIVIDAD WENT BACK UNDER "Más" (9/16, Luis). It came out of there on 8/13
  // with a good reason -- two blind-QA clients went hunting for it and one of
  // them found out THERE that her flows had failed -- and that reason is
  // spent: a flow that fails now says so on its own tab, and the main nav had
  // grown a tab for every screen we ever built. The log of what the agent did
  // is still one click away and still the proof that it worked; what it is not
  // is a place the client goes every day.
  // TABLERO AND FLUJOS WENT UNDER "Más" TOO (9/26, Luis): the main nav is what
  // the owner opens every day — the chat, the people waiting, the posts, her
  // brand, her yes. The board and the flows are set up once and then run on
  // their own; a flow that fails still says so, and the chat still creates them.
  { key: "kanban", path: "/app/pipeline", label: "Tablero", icon: Columns3, sec: true },
  { key: "flows", path: "/app/flows", label: "Flujos", icon: Workflow, sec: true },
  { key: "activity", path: "/app/activity", label: "Actividad", icon: Activity, sec: true },
  { key: "files", path: "/app/files", label: "Archivos", icon: Folder, sec: true },
  { key: "usage", path: "/app/usage", label: "Uso", icon: BarChart3, sec: true },
  { key: "skills", path: "/app/skills", label: "Habilidades", icon: Puzzle, sec: true },
];

const MORE_OPEN_KEY = "tuagente_nav_more_open";

function loadMoreOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MORE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveMoreOpen(open: boolean) {
  try {
    localStorage.setItem(MORE_OPEN_KEY, open ? "1" : "0");
  } catch { /* private mode: good for this visit */ }
}

function Login({ onReady }: { onReady: () => void }) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  // Whoever arrives via a shared link (to a deliverable, to a task) with no
  // session on THIS browser used to land on a login that explained nothing: it
  // looked like the wrong portal. We tell them the link is good and that as
  // soon as they enter we'll take them there -- and it's true: `reload()`
  // keeps the route.
  const [hasDestination, setHasDestination] = useState(false);
  useEffect(() => { setHasDestination(urlPointsToDetail()); }, []);
  // "magic link" was jargon: a test client read "link mágico" and didn't know
  // what to paste, because the only link she had was the one she'd already
  // entered with.
  const enter = () => {
    const hash = link.includes("#") ? link.slice(link.indexOf("#")) : `#key=${link.trim()}`;
    if (!/key=[^&]+/.test(hash)) { setErr("A ese link le falta el código del final. Copialo entero, desde https hasta el último carácter."); return; }
    window.location.hash = hash;
    // A FULL reload, on purpose: changing only the hash leaves the previous
    // build's JS alive, and after a redeploy that runtime requests chunks that
    // no longer exist (404) and the app gets stuck on the spinner. Verified
    // on 8/7.
    window.location.reload();
  };
  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-xl border border-black/[0.07] bg-white p-8">
        <AgentitoAvatar className="mb-3 h-14 w-14" />
        <h1 className="text-xl font-bold tracking-tight text-ink">tuagente</h1>
        {hasDestination && (
          <p className="mt-1 rounded-lg border border-c-violet bg-c-violet/40 px-3 py-2 text-[13px] leading-snug text-c-violet-ink">
            Este link lleva a algo que está adentro de tu portal. Entrá y te dejo
            justo ahí.
          </p>
        )}
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          Pegá acá el link que te dimos para entrar. Es el que te mandamos cuando dimos
          de alta a tu agente — largo y con un código al final.
        </p>
        <input
          value={link}
          onChange={(e) => { setLink(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          placeholder="https://app.tuagente.uy/app#key=…"
          className={inputCls}
        />
        {err && <p className="mt-2 text-sm text-c-coral-ink">{err}</p>}
        <div className="mt-4"><Btn onClick={enter}>Entrar</Btn></div>
        <div className="mt-5 border-t border-black/[0.07] pt-3"><Support /></div>
      </div>
    </main>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /app/avatar is the utility page headless Chrome photographs for the bot's
  // PNG: it goes with NO shell (no sidebar, no onboarding gate -- a headless
  // browser always has virgin localStorage and would land on the welcome
  // screen: exactly the wrong photo we uploaded on 8/7).
  if (pathname.startsWith("/app/avatar")) return <>{children}</>;
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [state, setState] = useState<"loading" | "login" | "error" | "ok" | "other">("loading");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  // Name and look the client gave their agent during onboarding.
  // The look is read lazily and not in an effect: otherwise the first frame
  // paints the default violet agentito and the flash shows.
  const [name, setName] = useState<string | null>(null);
  const [agentLook, setAgentLook] = useState(loadAgentLook);
  // "Más" starts closed: the workshop views don't compete with the flows.
  // But it REMEMBERS: the QA client opened it, went into Actividad, and found
  // it folded again on every tab change -- the tab she was on hidden under a
  // closed menu. The last state is kept (per agent, under the `tuagente_`
  // prefix), and being inside one of its tabs opens it.
  const [showMore, setShowMore] = useState(loadMoreOpen);
  const toggleMore = () => setShowMore((v) => { saveMoreOpen(!v); return !v; });
  useEffect(() => { setName(loadAgentName()); }, []);
  const { seen, dismiss } = useIntroGate();

  // ALL HOOKS GO UP HERE, before any conditional `return`. Placed further
  // down -- after the loading/login/error returns -- the number of hooks
  // changes between renders and React throws #310, which in production is a
  // blank screen with "Application error". Happened to me on 8/11 and left
  // the chat unusable.
  //
  // Read from window and not with useSearchParams: that hook forces wrapping
  // the whole layout in a <Suspense> for Next to prerender, and it isn't
  // worth it for a param that only matters after mounting.
  // `useUrlPointsToDetail` does exactly that, and it also learns about URL
  // changes.
  //
  // ANY link to something concrete counts as intent, not just the chat's
  // `?p=`: if the agent sends you the link to a deliverable and you've never
  // opened that tab, the module's welcome screen puts itself in front of what
  // you came to see. A shared link has to open the thing, not the home screen.
  //
  // It STAYS SET as long as you don't switch tabs, and that's the important
  // part: the chat clears its own `?p=` from the URL the moment it sends the
  // message, and if this followed suit, the welcome screen would pop back up
  // over the conversation the client just started (the 8/11 bug).
  const pointsToDetail = useUrlPointsToDetail(pathname);
  const [withIntent, setWithIntent] = useState(false);
  useEffect(() => { setWithIntent(false); }, [pathname]);
  useEffect(() => { if (pointsToDetail) setWithIntent(true); }, [pointsToDetail, pathname]);
  const currentModule = MODULES.find((m) => pathname.startsWith(m.path));
  useEffect(() => {
    if (currentModule?.sec) { setShowMore(true); saveMoreOpen(true); }
  }, [currentModule?.sec]);

  // The credential travels in the hash and stays stuck in the address bar.
  // With "copy link" on every screen, that goes from ugly to dangerous: the
  // client copies the URL by hand and shares their key. It gets cleaned up as
  // soon as it's saved. On a timeout because Next's history patch installs in
  // one of the router's own effects, which run AFTER its children's effects:
  // without waiting a tick, the original replaceState would eat this one.
  useEffect(() => {
    const t = setTimeout(stripCredentialFromUrl, 0);
    return () => clearTimeout(t);
  }, []);

  // PASTING A SECOND MAGIC LINK WHILE ALREADY INSIDE. If the route is the same
  // as the one open, the browser treats it as a FRAGMENT navigation: nothing
  // reloads, `loadConfig()` -- which runs once when the JS loads -- already
  // ran, and the new credential sits decorating the address bar with no
  // effect until the client refreshes by hand. It's the most natural way to
  // switch agents (or re-enter with a rotated key) and it used to fail
  // silently: the portal kept showing the previous agent as if the link
  // didn't work.
  //
  // We just reload: on startup `loadConfig()` saves it, forgets the previous
  // agent's stuff, and the portal goes straight into the new one. If the link
  // is the one already set, nothing reloads -- only the key gets cleared from
  // the bar. (`replaceState` doesn't fire `hashchange`, so this doesn't call
  // itself.)
  useEffect(() => {
    if (!cfg) return;
    const onAnotherLinkPasted = () => {
      const incoming = credentialInUrl();
      if (!incoming?.key) return;
      const effective = {
        endpoint: incoming.endpoint ?? cfg.endpoint,
        adapter: incoming.adapter ?? cfg.adapter,
        key: incoming.key,
      };
      if (sameSession(effective, cfg)) { stripCredentialFromUrl(); return; }
      window.location.reload();
    };
    window.addEventListener("hashchange", onAnotherLinkPasted);
    return () => window.removeEventListener("hashchange", onAnotherLinkPasted);
  }, [cfg]);

  // A Next `<Link>` to the tab you're already on doesn't fire popstate, so
  // screens would never learn the URL changed.
  useEffect(() => { notifyRouteChange(); }, [pathname]);
  // A TAB THE CLIENT ALREADY USED DOES NOT INTRODUCE ITSELF. Arriving through
  // a link to something in it (`withIntent`) used to only skip the welcome
  // screen, on the reasoning that she would still want to see it later. QA
  // (2026-09-23) read it the other way: she opened a file from Inicio, worked
  // in Archivos, and the next time she tapped the tab its welcome screen was
  // there «again» — the same on Actividad and Uso. Having used the tab is
  // having met it.
  useEffect(() => {
    if (withIntent && currentModule && seen && !seen[currentModule.key]) dismiss(currentModule.key);
  }, [withIntent, currentModule, seen]);

  // THE AGENT IS WHO KNOWS WHAT IT IS CALLED AND WHAT IT LOOKS LIKE; the
  // browser keeps a copy so the half dozen screens that have no manifest at
  // hand (`loadAgentName() || "Tu agente"`) can still name it. Every change
  // made from the portal is written to the agent first (`saveIdentity`), so
  // when the two disagree the browser's copy is the stale one: renamed from
  // another machine, or by whoever operates the agent.
  //
  // It used to be copied only when the browser had NOTHING, which meant the
  // first name a browser ever saw was the one it showed forever. Measured on
  // our own agent on 2026-09-20: renamed and redrawn on the agent, and the
  // portal went on greeting «Tu Agente» in violet.
  //
  // An agent with no name yet is the onboarding's to fill in: nothing to adopt.
  const learnFromAgent = (m: Manifest) => {
    if (!m.named || !m.agent) return;
    if (m.agent !== loadAgentName()) {
      saveAgentName(m.agent);
      setName(m.agent);
    }
    const theirs = lookFromAgent(m.look);
    if (theirs && JSON.stringify(theirs) !== JSON.stringify(loadAgentLook())) {
      saveAgentLook(theirs);
      setAgentLook(theirs);
    }
  };

  // WHAT CLOCK THE BUSINESS LIVES ON, BEFORE PAINTING ANYTHING. Every screen
  // shows dates in the agent's own offset, but only three used to learn it:
  // landing straight on any of the other eight -- a client's first day, or
  // with Home down -- left the portal counting hours on the browser's clock
  // with no warning. Requested once, at startup, and it's good for all of them.
  const learnTheClock = (c: PortalConfig, m: Manifest) => {
    learnAgentUtcOffset(c, m).catch(() => { /* with no offset, it carries on as before */ });
  };

  // DOES THIS AGENT STILL OWE ONBOARDING? Decided ONCE, with the first
  // manifest of the session; `null` while it hasn't arrived.
  //
  // It used to be read straight off `manifest` in the gate below -- the same
  // `manifest` the poll refreshes every minute. And onboarding WRITES to the
  // agent as it advances: naming saves the name, the channel step saves
  // `contact`. One minute in, the poll brought back a manifest that already
  // said `named` + `notify_channel`, the gate closed, and <Onboarding>
  // UNMOUNTED mid-flow: the client lost the automations carousel and the chat
  // step, and `onDone` never ran, so no welcome screen was ever marked as
  // seen. A slow client lost the last two screens; a fast one never noticed.
  //
  // Onboarding owns its own completion: it calls `onDone` when ITS flow ends
  // and only then does the layout put it away.
  const [agentNeedsOnboarding, setAgentNeedsOnboarding] = useState<boolean | null>(null);

  // The first manifest of the session: everything the portal decides on
  // arrival, in one place, because two paths get here (startup and the manual
  // retry from the error screen).
  const arrived = (c: PortalConfig, m: Manifest) => {
    setManifest(m); learnFromAgent(m); learnTheClock(c, m);
    setOnline(true); setState("ok");
    // The first manifest decides; one arriving after it never re-decides.
    setAgentNeedsOnboarding((decided) => decided ?? !onboardingAlreadyAnswered(m));
  };

  const boot = () => {
    const c = loadConfig();
    if (!c) { setState("login"); return; }
    setCfg(c);
    getManifest(c)
      .then((m) => arrived(c, m))
      .catch(() => setState("error"));
  };
  useEffect(boot, []);

  // Manual retry: without this the button gives NO signal that it did
  // anything (same screen, same text) and the client concludes the button
  // doesn't work. The 600ms floor is so the change is actually visible.
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    const since = Date.now();
    const done = () => setTimeout(() => setRetrying(false), Math.max(0, 600 - (Date.now() - since)));
    const c = loadConfig();
    if (!c) { setState("login"); done(); return; }
    setCfg(c);
    getManifest(c)
      .then((m) => arrived(c, m))
      .catch(() => setState("error"))
      .finally(done);
  };

  // The credential lives in localStorage, which belongs to the ORIGIN and not
  // the tab: if another tab enters with a DIFFERENT agent's link, this one
  // keeps the old agent in memory (the shell, the manifest, whatever tab was
  // already open) while the new one sits on disk -- and from there every
  // screen that mounts reads the new one. The result is one window showing
  // two clients at once: the sidebar with one's approvals and the chat with
  // the other's conversations. (Reproduced on 8/12 with two test agents.)
  //
  // We don't reload on our own: there could be a message half-typed. We
  // freeze the tab -- the modules don't even paint -- and let the client decide.
  useEffect(() => {
    if (!cfg) return;
    const onStorageChange = (e: StorageEvent) => {
      // `key === null` is a `localStorage.clear()` from another tab.
      if (e.key !== null && e.key !== CONFIG_KEY) return;
      if (!sameSession(savedConfig(), cfg)) setState("other");
    };
    window.addEventListener("storage", onStorageChange);
    return () => window.removeEventListener("storage", onStorageChange);
  }, [cfg]);

  // The indicator has to tell the truth: if the agent goes down while the
  // portal is open, a lying green dot is worse than not having one.
  useEffect(() => {
    if (state !== "ok" || !cfg) return;
    const tick = () => {
      getManifest(cfg).then((m) => { setManifest(m); setOnline(true); })
        .catch(() => setOnline(false));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [state, cfg]);

  // THE ONE POLLER of the whole portal (`lib/live.ts`): every tab listens to
  // it instead of running a timer of its own. Here because the layout is the
  // one thing mounted for as long as the portal is open.
  useEffect(() => {
    if (state !== "ok" || !cfg) return;
    return startChangeFeed(cfg);
  }, [state, cfg]);

  // The badge counts what's WAITING ON YOUR OK, and moves the moment the
  // queue does: an approval the agent asks for, or one another tab decided.
  const loadPending = useCallback(() => {
    if (state !== "ok" || !cfg) return;
    getApprovals(cfg)
      .then((r) => setPending((r.approvals ?? []).length))
      .catch(() => setPending(0));
  }, [state, cfg]);
  useEffect(loadPending, [loadPending]);
  useChanges(["approvals"], loadPending);
  // THE AMBER DOT: a tab with something that needs the OWNER (Luis, 9/26). Not
  // a count — Aprobaciones has the count — and not «something new»: only what
  // waits on her. The Bandeja, a conversation the agent left for her (a
  // WhatsApp or Instagram ticket `blocked`; a mail one is waiting on her ok and
  // Aprobaciones already counts it). Flujos, a flow that cannot run — a
  // connection missing — or whose last run failed.
  const [needs, setNeeds] = useState<Record<string, boolean>>({});
  const loadInboxNeed = useCallback(() => {
    if (state !== "ok" || !cfg || !manifest?.modules?.inbox) return;
    getTickets(cfg, "channels")
      .then((r) => setNeeds((n) => ({
        ...n, inbox: r.tickets.some((t) => t.status === "blocked" && t.source !== "mail"),
      })))
      .catch(() => {});
  }, [state, cfg, manifest]);
  const loadFlowsNeed = useCallback(() => {
    if (state !== "ok" || !cfg || !manifest?.modules?.flows) return;
    getFlows(cfg)
      .then((r) => setNeeds((n) => ({
        ...n, flows: (r.flows ?? []).some((f) => f.status === "incomplete"
          || (f.status === "active" && f.last_run?.status === "failed")),
      })))
      .catch(() => {});
  }, [state, cfg, manifest]);
  useEffect(loadInboxNeed, [loadInboxNeed]);
  useEffect(loadFlowsNeed, [loadFlowsNeed]);
  useChanges(["tickets"], loadInboxNeed);
  useChanges(["flows"], loadFlowsNeed);

  // And this tab's own click: the feed asks now instead of at its next tick,
  // or the "1" stays up a few seconds and the client thinks the click didn't
  // land.
  useEffect(() => {
    window.addEventListener(APPROVALS_EVENT, pollNow);
    return () => window.removeEventListener(APPROVALS_EVENT, pollNow);
  }, []);

  if (state === "loading") return <main className="app-shell min-h-screen bg-surface"><Spinner /></main>;
  if (state === "login") return <Login onReady={boot} />;
  // Another agent was entered in this browser. Rather than mix two clients on
  // one screen, this tab freezes.
  if (state === "other") {
    return (
      <main className="app-shell flex min-h-screen flex-col items-center justify-center bg-surface p-6 text-center">
        <AgentitoAvatar look={agentLook} asleep className="mb-2 h-20 w-20 opacity-45 grayscale" />
        <p className="text-sm font-semibold text-ink">Se abrió otro portal en este navegador</p>
        <p className="mb-4 mt-1 max-w-sm text-sm text-ink-soft">
          En otra pestaña se entró con un link distinto. Para no mezclar el trabajo
          de dos agentes, esta pestaña se quedó quieta: recargá y seguís con el que
          está activo ahora.
        </p>
        <Btn size="sm" onClick={() => window.location.reload()}>Recargar</Btn>
        <Support className="mt-5" />
      </main>
    );
  }
  if (state === "error" || !manifest || !cfg) {
    return (
      <main className="app-shell flex min-h-screen flex-col items-center justify-center bg-surface p-6 text-center">
        {/* Asleep: the same agentito, dozing off and colorless. */}
        <AgentitoAvatar look={agentLook} asleep className="mb-2 h-20 w-20 opacity-45 grayscale" />
        <p className="text-sm font-semibold text-ink">No pude conectar con tu agente</p>
        <p className="mb-4 mt-1 max-w-sm text-sm text-ink-soft">
          Puede estar apagado un rato, o puede ser tu conexión a internet. No perdiste nada:
          el trabajo de tu agente sigue guardado.
        </p>
        <div className="flex gap-2">
          <Btn size="sm" disabled={retrying} onClick={retry}>
            {retrying ? "Probando…" : "Probar de nuevo"}
          </Btn>
          <Btn kind="secondary" size="sm" onClick={() => { clearConfig(); setState("login"); }}>Cambiar link</Btn>
        </div>
        <Support className="mt-5" />
      </main>
    );
  }

  // Onboarding: before any module, the client names their agent and the agent
  // introduces itself. It completes the general welcome screen, so it also
  // marks the "home" intro (otherwise there'd be two welcome screens back to back).
  //
  // WHO DECIDES WHETHER ONBOARDING RUNS IS THE AGENT, NOT THE BROWSER. It used
  // to be decided only by what this browser remembered, and switching agents
  // wipes everything from the previous one (`forgetAgent`): entering with the
  // link to an already-named, already-configured agent ran the whole flow
  // again -- including "Where do I notify you?" -- and answering it WRITES to
  // the agent, overwriting the channel it already had. It happened to an
  // auditor with an agent configured a while back: he had to skip the
  // question by hand to avoid writing to it. The manifest already says
  // `named` and `notify_channel`: if the agent answered, it doesn't get asked
  // again. A brand-new (unnamed) agent still sees the full flow, and a named
  // one missing a channel sees it starting from the overview -- which is
  // where `Onboarding` starts when `named` is true.
  //
  // THE AGENT DECIDES ONCE, ON ARRIVAL (`agentNeedsOnboarding`), and not on
  // every poll: the flow answers those very questions as it runs. What closes
  // this gate is the browser's `seen.onboarding`, which only `onDone` sets.
  if (seen && !seen.onboarding && agentNeedsOnboarding) {
    return (
      <Onboarding
        manifest={manifest}
        cfg={cfg}
        onDone={(n) => {
          setName(n);
          setAgentLook(loadAgentLook());
          dismiss("onboarding");
          dismiss("home");
        }}
      />
    );
  }

  const enabled = MODULES.filter(
    (m) => !HIDDEN_MODULES.has(m.key)
      && (m.key === "home" || manifest.modules[m.key]));
  // Welcome screen per module: shown once, until the client says "Ok".
  const current = currentModule;
  const Intro = current ? INTROS[current.key] : undefined;
  // The module's welcome screen does NOT show if the client arrived with an
  // explicit intent (/app/chat?p=…): they came from tapping "build this" and
  // their message is already sent. Showing them the chat's home screen on top
  // of that is a door that opens after they've already come in -- and it
  // hides the conversation they themselves asked for. It gets marked as seen
  // so it doesn't reappear later, in the middle of that conversation.
  const showIntro = Boolean(
    current && Intro && seen && !seen[current.key] && !withIntent);

  const item = (m: (typeof MODULES)[number]) => {
    const active = pathname.startsWith(m.path);
    const Icon = m.icon;
    return (
      <Link
        key={m.key}
        href={m.path}
        // Tapping the tab you're already on closes the open detail. Without
        // this the `<Link>` changes the URL, Next doesn't navigate anywhere
        // (same path) and the modal stays open over a URL that no longer names it.
        onClick={(e) => {
          if (pathname === m.path && window.location.search) {
            e.preventDefault();
            backToTab();
          }
        }}
        // relative: the badge positions itself over the icon on the rail.
        title={m.label}
        className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition max-md:justify-center max-md:px-0 ${
          active
            ? "bg-c-violet/60 font-semibold text-primary"
            : "text-ink-soft hover:bg-black/[0.04] hover:text-ink"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 md:inline">{m.label}</span>
        {needs[m.key] && (
          <span
            aria-label="Necesita que lo veas"
            className="h-2 w-2 shrink-0 rounded-full bg-[#F0B429] max-md:absolute max-md:right-2 max-md:top-2"
          />
        )}
        {m.key === "approvals" && pending > 0 && (
          <span className={`rounded-full text-[10px] font-bold max-md:absolute max-md:right-1 max-md:top-1 max-md:h-4 max-md:w-4 max-md:leading-4 md:px-1.5 md:py-0.5 ${
            active ? "bg-white/25 text-white" : "bg-c-coral text-c-coral-ink"
          }`}>
            {pending}
          </span>
        )}
      </Link>
    );
  };
  return (
    <div className="app-shell flex min-h-screen bg-surface">
      {/* On small screens the bar shrinks to an icon rail: a fixed 224px left
          the content cramped. */}
      <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-black/[0.07] px-2 py-4 md:w-56 md:px-3">
        <div className="mb-4 flex items-center gap-2.5 px-1 md:px-2">
          {/* The agent with its own look, not a generic logo: this portal is ITS home. */}
          <AgentitoAvatar look={agentLook} className="h-9 w-9 shrink-0" />
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-bold tracking-tight text-ink">{name || manifest.agent}</p>
            <p className="flex items-center gap-1 text-[11px] text-ink-soft">
              <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-c-green-ink" : "bg-c-coral-ink"}`} />
              {online ? "conectado" : "sin conexión"}
            </p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {enabled.filter((m) => !m.sec).map(item)}

          {/* "Más": the workshop views. */}
          {enabled.some((m) => m.sec) && (
            <>
              <button
                onClick={toggleMore}
                aria-expanded={showMore}
                title="Más"
                className="relative mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-black/[0.04] hover:text-ink max-md:justify-center max-md:px-0"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${showMore ? "" : "-rotate-90"}`} />
                <span className="hidden flex-1 text-left md:inline">Más</span>
                {!showMore && enabled.some((m) => m.sec && needs[m.key]) && (
                  <span
                    aria-label="Hay algo que necesita que lo veas"
                    className="h-2 w-2 shrink-0 rounded-full bg-[#F0B429] max-md:absolute max-md:right-2 max-md:top-2"
                  />
                )}
              </button>
              {showMore && enabled.filter((m) => m.sec).map(item)}
            </>
          )}
        </nav>
        {/* Support always in view: when something breaks, the client
            shouldn't have to go dig up a phone number from an old email. */}
        <div className="mt-auto flex flex-col gap-0.5 px-1">
          <a
            href={SUPPORT.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            title="Escribinos"
            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] text-ink-soft transition hover:text-primary max-md:justify-center"
          >
            <LifeBuoy className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Escribinos</span>
          </a>
          <button
            onClick={() => { clearConfig(); setState("login"); }}
            title="Salir"
            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] text-ink-soft transition hover:text-ink max-md:justify-center"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Salir</span>
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {showIntro && current && Intro ? (
          <Intro onOk={() => dismiss(current.key)} />
        ) : (
          <>
            {/* Onboarding let them through with no notify channel: it gets
                offered again here. Only drawn when the client answered "not
                now"; the rest of the time it doesn't take up a single pixel. */}
            <NoChannelNotice
              cfg={cfg}
              manifest={manifest}
              onSaved={() => getManifest(cfg).then(setManifest).catch(() => {})}
            />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
