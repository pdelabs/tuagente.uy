"use client";

// "Files" welcome screen.
// Composition: the agent's workbench on the left (stack of files + an open
// viewer) and the three points on the right. Illustration in divs, no
// external images; the entry animation respects prefers-reduced-motion.
//
// "informe-mensual.md · 14 KB · hace 2 h" has the exact shape of a real
// file -- name, size, when -- so the stack sits inside `Mockup`: three made-up
// files on the screen that promises to show your own would be three files
// someone's going to go looking for.
//
// THIS WELCOME SCREEN USED TO SAY "READ ONLY" AND THAT STOPPED BEING TRUE. The
// tab now has its own upload: a button in the header, you can drop a file
// anywhere on the screen, and whatever lands stays in `entrada/`, the inbox,
// which moved up to second place at the root. It came out of the same blind
// test as everything else: "there's a missing screen: where do I put MY OWN
// papers; if I want to hand it my spreadsheet I have to go find the chat's
// little paperclip."
//
// BUT NOT EVERY AGENT HAS IT, and promising it is worse than not naming it:
// the client looks for a button that isn't there and thinks something broke.
// Upload only shows up if the manifest declares `modules.upload` -- the SAME
// condition the tab itself uses (`canUpload`), so what this screen promises
// and what shows up on the next one can't drift apart. It's Connections'
// welcome-screen solution applied to the same problem: if the portal can know
// the truth, it asks, and while it doesn't know it asserts nothing in either
// direction.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Code2, Download, Eye, FileCode2, FileSpreadsheet, FileText, FolderOpen, Inbox,
  Lock, MessagesSquare, Upload, Wrench, type LucideIcon,
} from "lucide-react";
import { getManifest, loadConfig } from "../agent";
import { IntroPage, Eyebrow, Title, Lead, Mockup, Step, Point, type IntroProps } from "./shell";

const CSS = `
@keyframes tgf-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
.tgf-in { animation: tgf-in .5s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .tgf-in { animation: none; } }
`;

/* ── Does this agent accept you dropping something off? ──────────────────── */

/** `null` while unknown: neither yes nor no gets said there.
 *
 *  If the manifest doesn't answer, the answer is NO: same rule as the tab
 *  (when in doubt, upload isn't offered), and it has to be the same one or
 *  this welcome screen ends up promising a button the real screen won't draw. */
function useDeclaredUpload(): boolean | null {
  const [can, setCan] = useState<boolean | null>(null);

  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) { setCan(false); return; }
    let alive = true;
    getManifest(cfg)
      .then((m) => { if (alive) setCan(m?.modules?.upload === true); })
      .catch(() => { if (alive) setCan(false); });
    return () => { alive = false; };
  }, []);

  return can;
}

/* ── The illustration ─────────────────────────────────────────────────────── */

type Row = { name: string; meta: string; icon: LucideIcon; tone: string; open?: boolean };

// Three very different extensions, each with its own icon and tone.
const ROWS: Row[] = [
  {
    name: "informe-mensual.md",
    meta: "14 KB · hace 2 h",
    icon: FileText,
    tone: "bg-c-violet text-c-violet-ink",
    open: true,
  },
  {
    name: "listado-final.csv",
    meta: "86 KB · ayer",
    icon: FileSpreadsheet,
    tone: "bg-c-green text-c-green-ink",
  },
  {
    name: "procesar.py",
    meta: "4 KB · hace 3 días",
    icon: FileCode2,
    tone: "bg-c-amber text-c-amber-ink",
  },
];

/** One "rendered" line of text in the viewer. */
function Line({ w }: { w: string }) {
  return <div className={`h-1.5 rounded-full bg-black/[0.09] ${w}`} />;
}

/** A token in the code block (dark background, tonal highlight). */
function Tok({ w, tone }: { w: string; tone: string }) {
  return <div className={`h-1.5 rounded-full ${tone} ${w}`} />;
}

// min-w-0 on the root: without it the grid cell grows to fit the longest file
// name (truncate alone isn't enough) and the portal ends up with horizontal
// scroll. For the same reason, the inner widths are in % and not pixels.
//
// `withInbox` draws the `entrada/` folder above the stack, which is where the
// client's files land. It doesn't draw when the agent doesn't declare
// upload: it would be a folder that doesn't exist on their own screen.
function Workspace({ withInbox }: { withInbox: boolean }) {
  return (
    <Mockup
      className="min-w-0 bg-gradient-to-br from-c-violet/70 via-white to-c-green/25"
      note={withInbox
        ? "Carpetas y archivos inventados: no son los tuyos."
        : "Archivos inventados: no son los tuyos."}
    >
      {withInbox && (
        <div className="tgf-in mb-1.5 flex items-center gap-2.5 rounded-xl border border-black/[0.06] bg-white px-2.5 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-c-green text-c-green-ink">
            <Inbox className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-ink">entrada</span>
            <span className="block truncate text-[10px] text-ink-soft">lo que le dejás vos</span>
          </span>
        </div>
      )}

      {/* The stack: .md, .csv and .py told apart by icon and color. */}
      <div className="space-y-1.5">
        {ROWS.map((r, i) => (
          <div
            key={r.name}
            style={{ animationDelay: `${i * 90}ms` }}
            className={`tgf-in flex items-center gap-2.5 rounded-xl border bg-white px-2.5 py-2 ${
              r.open ? "border-primary/30 ring-1 ring-primary/15" : "border-black/[0.06]"
            }`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${r.tone}`}>
              <r.icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-ink">{r.name}</span>
              <span className="block truncate text-[10px] tabular-nums text-ink-soft">{r.meta}</span>
            </span>
            {r.open && <Eye className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </div>
        ))}
      </div>

      {/* The viewer: title, formatted text and the highlighted code block. */}
      <div
        style={{ animationDelay: "300ms" }}
        className="tgf-in mt-2.5 overflow-hidden rounded-xl border border-black/[0.07] bg-white"
      >
        <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-2.5 py-1.5">
          <span className="min-w-0 truncate text-[11px] font-semibold text-ink">informe-mensual.md</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-soft">
            <Code2 className="h-2.5 w-2.5" />
            original
          </span>
        </div>
        <div className="space-y-2.5 px-3 py-3">
          <div className="h-2 w-2/5 rounded-full bg-ink/80" />
          <div className="space-y-1.5">
            <Line w="w-full" />
            <Line w="w-[88%]" />
          </div>
          <div className="space-y-1.5 pl-2">
            {["w-[70%]", "w-[78%]"].map((w) => (
              <div key={w} className="flex items-center gap-1.5">
                <span className="h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                <Line w={w} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5 rounded-lg bg-ink px-2.5 py-2">
            <div className="flex gap-1.5">
              <Tok w="w-[8%]" tone="bg-c-violet/80" />
              <Tok w="w-[17%]" tone="bg-c-green" />
              <Tok w="w-[6%]" tone="bg-white/25" />
            </div>
            <div className="flex gap-1.5 pl-[8%]">
              <Tok w="w-[12%]" tone="bg-c-amber" />
              <Tok w="w-[19%]" tone="bg-white/25" />
            </div>
            <div className="flex gap-1.5">
              <Tok w="w-[7%]" tone="bg-c-coral" />
              <Tok w="w-[11%]" tone="bg-white/20" />
            </div>
          </div>
        </div>
      </div>
    </Mockup>
  );
}

/* ── What changes depending on the agent ──────────────────────────────────── */

function Box({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded-card border border-black/[0.07] bg-white px-4 py-3">
      {children}
    </div>
  );
}

function Header({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
      {children}
    </p>
  );
}

/** With upload: where the client's papers go and what happens next.
 *
 *  The three steps use `Step` -- icon and text -- and not pills: "Lo soltás
 *  acá" and "Se lo pedís por el chat" are things that happen on OTHER
 *  screens, and drawing them shaped like a button promises a click that does
 *  nothing here. */
function WithInbox() {
  return (
    <Box>
      <Header icon={Inbox}>Y acá le dejás lo tuyo</Header>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Una planilla, un listado, un PDF: soltalo en cualquier parte de esta pantalla —o usá el
        botón de arriba— y queda en <span className="font-semibold text-ink">Entrada</span>, el
        buzón de tu agente. No hace falta ir a buscar el clip del chat.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Step icon={Upload}>Lo soltás acá</Step>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Step icon={Inbox}>Queda en Entrada</Step>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Step icon={MessagesSquare}>Se lo pedís por el chat</Step>
      </div>
      {/* DROPPING IT OFF ISN'T ASKING IT FOR ANYTHING: the file sits in its
          inbox and it'll find it there, but nobody told it. The tab already
          says as much above the acknowledgment; saying it here too avoids the
          "I left it there and it didn't do anything". */}
      <p className="mt-2 text-[12px] leading-snug text-ink-soft">
        Dejárselo no lo pone a trabajar: el archivo lo espera ahí hasta que se lo pidas.
      </p>
    </Box>
  );
}

/** With no declared upload: the screen is read-only, and it says so. */
function ReadOnly() {
  return (
    <Box>
      <Header icon={Lock}>Solo lectura</Header>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
        Es una ventana al workspace de tu agente: los archivos se miran y se bajan, pero desde el
        portal no se modifica nada. Si le querés pasar algo tuyo, mandáselo por el chat.
      </p>
    </Box>
  );
}

/** While it's being asked. Asserts nothing in either direction. */
function Checking() {
  return (
    <Box>
      <p className="text-[12px] text-ink-soft">Viendo si a este agente le podés dejar archivos…</p>
      <div className="mt-2 space-y-1.5" aria-hidden>
        <div className="h-2 w-2/3 rounded-pill bg-black/[0.06]" />
        <div className="h-2 w-1/3 rounded-pill bg-black/[0.05]" />
      </div>
    </Box>
  );
}

/* ── The screen ────────────────────────────────────────────────────────────── */

export default function FilesIntro({ onOk }: IntroProps) {
  const canUpload = useDeclaredUpload();

  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis archivos"
      // Without knowing yet, nothing gets promised: the note shows up once
      // the manifest answered.
      note={canUpload === null
        ? undefined
        : canUpload
          ? "Le podés dejar archivos; editar o borrar los suyos, no."
          : "Solo lectura: desde acá no se modifica nada."}
    >
      <style>{CSS}</style>
      <Eyebrow icon={FolderOpen}>Archivos</Eyebrow>
      <Title>Los papeles de tu agente</Title>
      <Lead>
        Informes, listados, borradores: lo que fue dejando armado mientras trabajaba. Acá los abrís
        y los leés, sin bajar nada ni salir del portal.
      </Lead>

      {canUpload === null ? <Checking /> : canUpload ? <WithInbox /> : <ReadOnly />}

      <div className="mt-6 grid gap-6 md:grid-cols-2 md:items-start">
        <Workspace withInbox={canUpload === true} />
        <div className="grid min-w-0 gap-5">
          <Point icon={Eye} title="Se leen como corresponde">
            Los .md se ven formateados, las planillas como planilla y el código con resaltado. Si lo
            querés copiar tal cual, un botón te muestra el original crudo.
          </Point>
          <Point icon={Download} title="Y te los llevás">
            Cualquier archivo se baja tal cual está, incluso los que no se pueden mostrar acá
            adentro.
          </Point>
          <Point icon={Wrench} title="Sin el andamiaje">
            Lo que tu agente usa por dentro para trabajar —pruebas, archivos temporales— queda
            aparte, así acá ves solo lo que te sirve.
          </Point>
        </div>
      </div>
    </IntroPage>
  );
}
