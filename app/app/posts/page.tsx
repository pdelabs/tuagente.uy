"use client";

// Posteos — what the agent left ready to publish: the image, the text and the
// hashtags. IT DOES NOT PUBLISH. The client reviews it, copies the caption,
// downloads the images and posts them from their own account; that is the
// whole promise of the tab and the copy repeats it wherever it could be
// misread.
//
// IT IS DRAWN AS THE FEED IT IS GOING INTO: one centred 470px column, newest
// first, the header with the agent's face and the account's handle, the image
// at its real shape, the row of icons, the caption clamped to two lines with
// a «más». The client is deciding whether this goes up on THEIR Instagram,
// and a three-column grid of thumbnails answers a different question (how
// many are there) than the one they came with (how is this going to look).
// The row of icons is INERT and carries no counts: a number there would be an
// invented fact about a post that nobody has published yet. The header of the
// tab says out loud that nothing here is published, precisely because the
// card now looks like something that is.
//
// Contract (the social plugin's router, shown when the manifest flips `posts`):
//   GET {adapter}/portal/posts           → { available, posts: Post[] }  newest first
//   GET {adapter}/portal/posts/{id}      → Post  (404 once it no longer exists)
//   GET {adapter}/portal/posts/{id}/{f}  → the image's bytes, bearer required
//
// THE IMAGES NEVER GO INTO AN `<img src="{adapter}/…">`. Every byte needs the
// bearer and an `<img>` tag carries no header; putting the key in the URL is
// the one thing the portal never does (`docs/portal-routes.md`). Same
// mechanism as the Files tab: bytes → Blob → object URL, revoked on unmount.
//
// FIXING ONE SLIDE GOES THROUGH THE CHAT, never through a call of this tab's
// own: the portal talks to the agent by talking to the agent. «Arreglar esta
// imagen» writes «Arreglá la slide N del posteo «<id>»: <what the client
// says>» and opens `/app/chat?p=…`, and that param SENDS the message on
// arrival (`app/app/chat/page.tsx`) instead of leaving it in the box — which
// is why the sentence is finished HERE, in one line of input, and not left
// hanging on a colon for the client to complete in a screen they have just
// landed on. The face delegates it to the creator, and the creator is the one
// with `replace_slide`.
//
// AND A FIX DELETES NOTHING: the slide that was there is kept, and the tab
// draws it under the one that replaced it («Versiones anteriores»), with what
// the client said was wrong and when. Which of the two is the good one is
// their call — so the picture they did not keep has to stay where they can
// look at it, download it, and read the brief it was made from.
//
// AND THE BRIEF IS ON THE SCREEN. `prompts` carries what each slide was asked
// of the model, one per image; «Ver brief» shows it. Everything that was used
// to make the piece is stored with it, and this is the half that makes it
// visible — the client reads what was asked for, and that is what they are
// correcting.
//
// THE CAPTION IS NOT MARKDOWN and does not go through `lib/Markdown.tsx`. It
// is the literal text that gets pasted into the network: its line breaks are
// the post's line breaks and its `#` are hashtags, not headings. Rendered it
// would come out with a title where the client wrote a hashtag. Plain text
// with `whitespace-pre-wrap`.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Bookmark, Check, ChevronLeft, ChevronRight, Copy, Download,
  Ellipsis, Heart, History, ImageOff, Images, Link2, Maximize2, MessageCircle,
  RefreshCw, Send, Wand2, X,
} from "lucide-react";
import {
  getFlows, getManifest, getPost, getPostImage, getPosts, loadConfig,
  type Flow, type HttpError, type Manifest, type Post, type PortalConfig,
  type PostVersion,
} from "../lib/agent";
import { PARAM, closeInRoute, openInRoute, urlFor, useRouteParam } from "../lib/routes";
import { AgentitoAvatar, loadAgentLook, type AgentitoLook } from "../lib/agentito";
import { buildChatLink } from "../lib/flowExamples";
import { moment, whenItHappened } from "../lib/labels";
import { loadAgentName } from "../lib/onboarding";
import {
  Btn, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner,
  StaleLinkNotice, inputCls,
} from "../lib/ui";

// Instagram's web feed is a 470px column and the post is read at that width:
// the same picture two columns wide reads as a gallery of stock photos. The
// detail — someone who arrived from a link and wants the whole thing — goes
// to 600 and no further, which is where the image stops being a poster.
const FEED = "mx-auto w-full max-w-[502px] px-4 py-6";
const DETAIL = "mx-auto w-full max-w-[632px] px-4 py-6";
const REFRESH_MS = 60_000;

/* ── Words ───────────────────────────────────────────────────────────────── */

// «14 de setiembre». `date` is a bare calendar day with no offset — it is the
// day the post is FOR, not an instant — so it gets formatted in UTC: the same
// trick `lib/labels.ts` uses to draw a clock that isn't the viewer's without
// inventing a timezone.
const DAY = { day: "numeric", month: "long", timeZone: "UTC" } as const;
const DAY_FMT = new Intl.DateTimeFormat("es-UY", DAY);
// The year only shows when it isn't this one: on an old post "14 de
// setiembre" alone reads as a date from this week.
const DAY_YEAR_FMT = new Intl.DateTimeFormat("es-UY", { ...DAY, year: "numeric" });

function dayLine(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const fmt = d.getUTCFullYear() === new Date().getUTCFullYear() ? DAY_FMT : DAY_YEAR_FMT;
  return fmt.format(d);
}

/** What goes next to the handle: «hace 3 h», «ayer», «14 set». Instagram's
 *  own scale — minutes, hours, days, and then the plain date. On the
 *  business's clock, like every other date in the portal (`moment`). */
function relative(iso: string): string {
  const m = moment(iso);
  if (!m) return "";
  const minutes = Math.floor((Date.now() - m.ms) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  if (m.days === -1) return "ayer";
  if (m.days > -7) return `hace ${-m.days} d`;
  return m.date;
}

type Tone = "violet" | "green" | "amber" | "neutral";

// What each shape is called. An unknown one shows raw rather than hiding:
// the plugin can add a format tomorrow and the chip still says something.
const FORMATS: Record<string, { label: string; tone: Tone }> = {
  feed: { label: "Feed", tone: "violet" },
  square: { label: "Cuadrado", tone: "green" },
  story: { label: "Historia", tone: "amber" },
};
const formatLabel = (f: string) => FORMATS[f] ?? { label: f, tone: "neutral" as const };

// A flow whose name we couldn't resolve (it was deleted, or the list didn't
// arrive) still gets a readable word: the slug is half-human already, and an
// id never reaches the client's eyes (`docs/portal-routes.md`).
const humanizeSlug = (slug: string) => {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** WHOSE ACCOUNT THIS IS, WRITTEN THE WAY A HANDLE IS WRITTEN. Derived, not
 *  declared: nothing in the identity carries the client's Instagram handle
 *  today (see the report), so the company's name gets lowercased and stripped
 *  of spaces and accents — «Ferretería Demo» → `ferreteriademo`. The day the
 *  identity grows a `handle`, this reads it instead of guessing. */
function handleOf(company: string | null | undefined, agent: string): string {
  const source = (company || agent || "").trim();
  const flat = source
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "");
  return flat || "tuagente";
}

/** The caption WITHOUT the blank lines a caption is full of, for the two
 *  clamped lines of the card: the first blank one eats a whole line and the
 *  card ends on an ellipsis having said almost nothing. It comes back whole
 *  the moment «más» is clicked, and in the detail, which is where the text is
 *  read. */
const compact = (caption: string) =>
  caption.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");

/** What gets pasted into the network: the text, a blank line, and the
 *  hashtags with their `#`. The client copies once and pastes once — copying
 *  the caption and then hunting for the tags was two trips for one post. */
function forPublishing(p: Post): string {
  if (p.hashtags.length === 0) return p.caption;
  return `${p.caption}\n\n${p.hashtags.map((h) => `#${h}`).join(" ")}`;
}

/** Copies a piece of text and says it did. `navigator.clipboard` doesn't
 *  exist outside a secure context (plain http), and there it falls back to
 *  the browser's prompt — ugly, but a button that does nothing is worse. The
 *  same reasoning as `CopyUrl` in `lib/routes.tsx`. */
function copyText(value: string, done: () => void, ask = "Copiá el texto:") {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(done).catch(() => window.prompt(ask, value));
    return;
  }
  window.prompt(ask, value);
}

/* ── The bytes ───────────────────────────────────────────────────────────── */

// The type is derived from the name and not read off the response, because
// `getPostImage` hands back the raw bytes (same as `getFileBytes`): a Blob
// with no type doesn't render in an `<img>`.
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif",
};
const mimeOf = (name: string) => MIME[(name.split(".").pop() ?? "").toLowerCase()];

/** One image, fetched with the bearer and held as an object URL for as long
 *  as it is on screen. */
function usePostImage(cfg: PortalConfig | null, id: string, name: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    setFailed(false);
    getPostImage(cfg, id, name)
      .then((bytes) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([bytes], { type: mimeOf(name) }));
        setUrl(made);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [cfg, id, name]);

  return { url, failed };
}

function PostImage({ cfg, id, name, alt, onRatio }: {
  cfg: PortalConfig | null;
  id: string;
  name: string;
  alt: string;
  /** The image's real shape, as soon as the browser knows it. */
  onRatio?: (ratio: number) => void;
}) {
  const { url, failed } = usePostImage(cfg, id, name);
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ImageOff className="h-5 w-5 text-ink-soft/40" />
      </div>
    );
  }
  if (!url) {
    // It reads as "on its way" and not as an empty box: on white, a 3% gray
    // rectangle is indistinguishable from a card that came up broken.
    return <div className="h-full w-full animate-pulse bg-black/[0.06]" aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- next/image can't
    // carry the bearer, and these bytes only exist as an object URL.
    <img
      src={url}
      alt={alt}
      onLoad={(e) => onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
      className="h-full w-full object-contain"
    />
  );
}

/* ── The frame ───────────────────────────────────────────────────────────── */

// What a feed shows: from 4:5 (the tallest) to 1.91:1 (the widest). A story
// is 9:16, taller than either, and it gets letterboxed into 4:5 over the
// tonal background instead of cropped — the client is looking at the piece to
// decide whether it goes up, and a crop hides exactly what they came to
// check. `object-contain` means nothing is ever cut, whatever the shape.
const TALLEST = 4 / 5;
const WIDEST = 1.91;
const frameRatio = (r: number) => Math.min(WIDEST, Math.max(TALLEST, r));

/** The image's box: the post's real shape until it is taller than a feed. */
function Frame({ ratio, children }: { ratio: number | null; children: ReactNode }) {
  return (
    <div
      className="relative w-full overflow-hidden bg-c-violet/30"
      style={{ aspectRatio: String(ratio ?? TALLEST) }}
    >
      {children}
    </div>
  );
}

function Empty() {
  return (
    <Frame ratio={null}>
      <div className="flex h-full w-full items-center justify-center">
        <ImageOff className="h-5 w-5 text-ink-soft/40" />
      </div>
    </Frame>
  );
}

/** The carousel: one image, or several with dots, chevrons on hover and the
 *  arrow keys — the way a carousel is flipped through on Instagram.
 *
 *  Every image that HAS been looked at stays mounted. Its bytes cost a
 *  request with the bearer, and unmounting the one you just left means paying
 *  for it again on the way back; the first one is the only one that travels
 *  before the client asks for it. */
function Gallery({ cfg, p, index, onIndex }: {
  cfg: PortalConfig | null; p: Post; index: number; onIndex: (i: number) => void;
}) {
  const n = p.images.length;
  const [ratio, setRatio] = useState<number | null>(null);
  const [seen, setSeen] = useState<number[]>([0]);

  useEffect(() => {
    setSeen((s) => (s.includes(index) ? s : [...s, index]));
  }, [index]);

  const go = (d: number) => onIndex(Math.min(n - 1, Math.max(0, index + d)));

  if (n === 0) return <Empty />;

  return (
    <div>
      <div
        className="group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        tabIndex={n > 1 ? 0 : undefined}
        role={n > 1 ? "group" : undefined}
        aria-label={n > 1 ? `Imagen ${index + 1} de ${n}` : undefined}
        onKeyDown={(e) => {
          if (n < 2) return;
          if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
        }}
      >
        <Frame ratio={ratio}>
          {p.images.map((img, i) => (
            <div
              key={img.name}
              aria-hidden={i !== index}
              className={`absolute inset-0 transition-opacity duration-200 ${
                i === index ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              {seen.includes(i) && (
                <PostImage
                  cfg={cfg}
                  id={p.id}
                  name={img.name}
                  alt={altOf(p, i)}
                  onRatio={i === 0 ? (r) => setRatio(frameRatio(r)) : undefined}
                />
              )}
            </div>
          ))}
        </Frame>

        {n > 1 && index > 0 && (
          <Arrow side="left" label="Imagen anterior" onClick={() => go(-1)} />
        )}
        {n > 1 && index < n - 1 && (
          <Arrow side="right" label="Imagen siguiente" onClick={() => go(1)} />
        )}
      </div>

      {n > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2">
          {p.images.map((img, i) => (
            <span
              key={img.name}
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full transition ${
                i === index ? "bg-primary" : "bg-black/20"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Arrow({ side, label, onClick }: {
  side: "left" | "right"; label: string; onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2" : "right-2"} ` +
        "inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/[0.07] " +
        "bg-white/85 text-ink opacity-0 transition hover:bg-white " +
        "focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " +
        "group-hover:opacity-100 group-focus-within:opacity-100"}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/* ── Copying and downloading ─────────────────────────────────────────────── */

function CopyText({ text, label }: { text: () => string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Btn
      kind="secondary"
      size="sm"
      onClick={() => copyText(text(), () => {
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      })}
    >
      {done ? <Check className="h-3.5 w-3.5 text-c-green-ink" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copiado" : label}
    </Btn>
  );
}

/** Downloads one image with the name the agent gave it. The bytes are asked
 *  for again instead of reusing the object URL on screen: the preview is
 *  mounted per component and may not be the one being downloaded.
 *
 *  `as` is the name the file lands with when the piece lives one folder down
 *  (`anteriores/02-1.png`): a slash in `download` is not a folder, it is a
 *  character the browser rewrites. */
function DownloadImage({ cfg, id, name, as }: {
  cfg: PortalConfig | null; id: string; name: string; as?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    if (!cfg) return;
    setBusy(true);
    setErr(null);
    try {
      const bytes = await getPostImage(cfg, id, name);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = as ?? name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Btn kind="secondary" size="sm" disabled={busy} onClick={download}>
        <Download className="h-3.5 w-3.5" />
        {busy ? "Bajando…" : "Descargar"}
      </Btn>
      {err && <span className="text-[12px] text-c-coral-ink">No pude bajarla ({err}).</span>}
    </div>
  );
}

/* ── One slide: its brief, and asking for it to be fixed ─────────────────── */

/** The sentence that travels to the chat. The id and the number are in it
 *  because they are what the creator's tool needs, and the rest are the
 *  client's own words: what is wrong is the one thing the portal cannot know. */
const fixRequest = (id: string, number: number, what: string) =>
  `Arreglá la slide ${number} del posteo «${id}»: ${what}`;

// The primary button as a LINK: `Btn` only draws a <button>, and this one has
// to be an <a> so middle-click and "open in a new tab" keep working — the same
// shape `flows/FlowStatus.tsx` uses for its own chat links.
const ASK_LINK =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] " +
  "font-semibold text-white transition hover:bg-primary-dark";

/** What the slide was asked of the model, folded away. Monospace because it is
 *  a brief and not prose: the line breaks and the quoted words are the piece's
 *  instructions, and reading it is how the client knows what to correct. */
function Brief({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-ink-soft transition hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 transition group-open:rotate-90" />
        Ver brief
      </summary>
      <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-black/[0.07] bg-black/[0.02] p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-soft">
        {prompt}
      </pre>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Btn
          kind="secondary"
          size="sm"
          onClick={() => copyText(prompt, () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-c-green-ink" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Btn>
        <span className="text-[11px] text-ink-soft/80">
          Es lo que tu agente le pidió al modelo para esta imagen.
        </span>
      </div>
    </details>
  );
}

/** «Arreglar esta imagen»: what is wrong, in one line, and the chat opens with
 *  the request already sent. Nothing is fixed here — the tab has no way to ask
 *  the agent for anything, and the whole product only ever asks through the
 *  conversation. */
function FixSlide({ post, number }: { post: Post; number: number }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const router = useRouter();
  const field = useId();
  const ask = what.trim();
  const href = ask ? buildChatLink(fixRequest(post.id, number, ask)) : null;

  if (!open) {
    return (
      <Btn kind="secondary" size="sm" onClick={() => setOpen(true)}>
        <Wand2 className="h-3.5 w-3.5" />
        Arreglar esta imagen
      </Btn>
    );
  }
  return (
    <div className="w-full">
      <label htmlFor={field} className="block text-[12px] font-semibold text-ink">
        Qué está mal en la imagen {number}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={field}
          autoFocus
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && href) { e.preventDefault(); router.push(href); }
            if (e.key === "Escape") { setOpen(false); setWhat(""); }
          }}
          placeholder="Qué está mal"
          className={`${inputCls} min-w-[180px] flex-1`}
        />
        {href ? (
          <Link href={href} className={ASK_LINK}>
            <Send className="h-3.5 w-3.5" />
            Pedírselo
          </Link>
        ) : (
          <Btn kind="primary" size="sm" disabled>
            <Send className="h-3.5 w-3.5" />
            Pedírselo
          </Btn>
        )}
        <Btn kind="ghost" size="sm" onClick={() => { setOpen(false); setWhat(""); }}>
          Cancelar
        </Btn>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-soft/80">
        Se lo pedís por el chat y cambia sólo esta imagen: las otras y el texto quedan
        como están. Por ejemplo: «sacale el signo de pregunta».
      </p>
    </div>
  );
}

/** One earlier take, open: the whole picture, why it was replaced, when, the
 *  brief it was made from and its own «Descargar». Nothing about it is
 *  second-class — it is a piece the client may well prefer. */
function VersionModal({ cfg, post, number, version, onClose }: {
  cfg: PortalConfig | null;
  post: Post;
  number: number;
  version: PostVersion;
  onClose: () => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-center gap-2 border-b border-black/[0.07] px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
          La imagen {number}, antes de arreglarla
        </p>
        <IconBtn label="Cerrar" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconBtn>
      </div>
      <div className="min-h-0 overflow-auto">
        <Frame ratio={ratio}>
          <PostImage
            cfg={cfg}
            id={post.id}
            name={version.file}
            alt={version.alt}
            onRatio={(r) => setRatio(frameRatio(r))}
          />
        </Frame>
        <div className="space-y-2 px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-ink">
            <b className="font-semibold">Qué pediste cambiar:</b> {version.reason}
          </p>
          <p className="text-[11px] text-ink-soft">
            La cambió {whenItHappened(version.replaced_at)}
          </p>
          <DownloadImage
            cfg={cfg}
            id={post.id}
            name={version.file}
            as={version.file.split("/").pop()}
          />
          <Brief prompt={version.prompt} />
        </div>
      </div>
    </Modal>
  );
}

/** The takes this slide already had, oldest first. A fix keeps the picture it
 *  replaced (`anteriores/NN-k.png`), and this is where the client sees it: the
 *  thumbnail, what they asked to change and when. */
function Versions({ cfg, post, name, number }: {
  cfg: PortalConfig | null; post: Post; name: string; number: number;
}) {
  const list = post.versions?.[name] ?? [];
  const [open, setOpen] = useState<PostVersion | null>(null);
  if (list.length === 0) return null;
  return (
    <div className="px-3 pb-3">
      <p className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-soft">
        <History className="h-3 w-3" />
        Versiones anteriores
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {list.map((version) => (
          <button
            key={version.file}
            onClick={() => setOpen(version)}
            title={version.reason}
            className="w-[92px] rounded-lg text-left transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span
              className="block overflow-hidden rounded-lg border border-black/[0.07] bg-c-violet/30"
              style={{ aspectRatio: String(TALLEST) }}
            >
              <PostImage cfg={cfg} id={post.id} name={version.file} alt={version.alt} />
            </span>
            <span className="mt-1 block truncate text-[11px] text-ink-soft">
              {version.reason}
            </span>
            <span className="block truncate text-[11px] text-ink-soft/70">
              {whenItHappened(version.replaced_at)}
            </span>
          </button>
        ))}
      </div>
      {open && (
        <VersionModal
          cfg={cfg}
          post={post}
          number={number}
          version={open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/* ── The card ────────────────────────────────────────────────────────────── */

/** The «…» of a post: the two things the portal can actually do with it, and
 *  nothing invented. On Instagram this menu is where the post's own link
 *  lives, which is exactly what `?post=` is here. */
function CardMenu({ post, onOpen }: { post: Post; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink transition hover:bg-black/[0.04]";
  return (
    <div className="relative">
      <button
        aria-label="Opciones del posteo"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
      >
        <Ellipsis className="h-[18px] w-[18px]" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-lg border border-black/[0.07] bg-white py-1">
            {onOpen && (
              <button className={item} onClick={() => { setOpen(false); onOpen(); }}>
                <Maximize2 className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                Abrir el posteo
              </button>
            )}
            <button
              className={item}
              onClick={() => copyText(
                urlFor("/app/posts", { [PARAM.post]: post.id }),
                () => { setCopied(true); setTimeout(() => { setCopied(false); setOpen(false); }, 1200); },
                "Copiá el link:",
              )}
            >
              {copied
                ? <Check className="h-3.5 w-3.5 shrink-0 text-c-green-ink" />
                : <Link2 className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
              {copied ? "Link copiado" : "Copiar el link"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The row of icons. PURELY A DRAWING: no counts, no state, nothing to press.
 *  It is what makes the card read as the feed the post is going into, and it
 *  is also the one place where a number would be a lie — nobody has liked
 *  anything, because nothing has been published. */
function Reactions() {
  const icon = "h-6 w-6 text-ink transition group-hover/icons:text-ink";
  return (
    <div className="group/icons flex items-center gap-4 px-3 pt-3" aria-hidden>
      <Heart className={icon} strokeWidth={1.6} />
      <MessageCircle className={icon} strokeWidth={1.6} />
      <Send className={icon} strokeWidth={1.6} />
      <Bookmark className={`${icon} ml-auto`} strokeWidth={1.6} />
    </div>
  );
}

/** `<b>handle</b> el texto`, two lines and a «más» — Instagram's caption. The
 *  hashtags close it in the primary colour, inside the same block: on
 *  Instagram they are part of the caption, so they hide and expand with it. */
function Caption({ handle, p, expandable }: { handle: string; p: Post; expandable: boolean }) {
  const [open, setOpen] = useState(!expandable);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (open) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    // The clamp is measured in lines, and the lines move when Jakarta lands:
    // measured against the fallback font, a caption that does fit can ask for
    // a «más» that expands nothing.
    document.fonts?.ready.then(measure).catch(() => { /* older browser */ });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, p.id]);

  return (
    <div className="px-3 pt-2">
      <p
        ref={ref}
        className={`whitespace-pre-wrap break-words text-[13px] leading-[1.5] text-ink ${
          open ? "" : "line-clamp-2"
        }`}
      >
        <b className="font-bold">{handle}</b>{" "}
        {open ? p.caption : compact(p.caption)}
        {p.hashtags.length > 0 && (open ? "\n\n" : " ")}
        {p.hashtags.map((h, i) => (
          <span key={h} className="text-primary">{i > 0 ? " " : ""}#{h}</span>
        ))}
      </p>
      {!open && long && (
        <button
          onClick={() => setOpen(true)}
          className="mt-0.5 text-[13px] text-ink-soft transition hover:text-ink"
        >
          más
        </button>
      )}
    </div>
  );
}

/** The alt text, folded away: it is the one piece of the post that isn't
 *  pasted with the caption (it goes in the network's accessibility field), so
 *  it stays out of the way until it's asked for. */
/** The alt text of one slide: a carousel carries one per image, a single
 *  image carries the post's. Never slide 1's text on slide 3. */
const altOf = (p: Post, i: number): string => p.alts?.[i] ?? p.alt;

function AltText({ alt }: { alt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-ink-soft transition hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3 w-3 transition group-open:rotate-90" />
        Texto alternativo
      </summary>
      <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-soft">{alt}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Btn
          kind="secondary"
          size="sm"
          onClick={() => copyText(alt, () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          })}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-c-green-ink" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Btn>
        <span className="text-[11px] text-ink-soft/80">
          Es la descripción de la imagen para quien no la puede ver. Va en el campo de
          accesibilidad, no en el texto del posteo.
        </span>
      </div>
    </details>
  );
}

/** One post as it is going to look, plus — quiet, under the caption — the
 *  three things the portal can do with it. `wide` is the detail: every image
 *  stacked instead of a carousel, and the caption already open, because
 *  whoever arrived from a link came for the whole thing. */
function PostCard({ cfg, p, look, handle, flowName, onOpen, wide = false }: {
  cfg: PortalConfig | null;
  p: Post;
  look: AgentitoLook;
  handle: string;
  flowName: string | null;
  onOpen?: () => void;
  wide?: boolean;
}) {
  const shape = formatLabel(p.format);
  const [index, setIndex] = useState(0);
  const current = p.images[Math.min(index, p.images.length - 1)];

  return (
    <article className="overflow-hidden rounded-xl border border-black/[0.07] bg-white">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/[0.07] bg-c-violet/50">
          <AgentitoAvatar look={look} className="h-7 w-7" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] text-ink">
          <b className="font-bold">{handle}</b>
          <span className="text-ink-soft"> · {relative(p.created_at)}</span>
        </p>
        <CardMenu post={p} onOpen={onOpen} />
      </header>

      {wide ? (
        p.images.length === 0 ? <Empty /> : (
          <div className="flex flex-col">
            {p.images.map((img, i) => (
              <StackedImage key={img.name} cfg={cfg} p={p} name={img.name} index={i} />
            ))}
          </div>
        )
      ) : (
        <Gallery cfg={cfg} p={p} index={index} onIndex={setIndex} />
      )}

      <Reactions />
      <Caption handle={handle} p={p} expandable={!wide} />

      {/* The date line, and the shape of the piece on its right: what a feed
          post says under the caption is meta, and that is what the format is.
          It sat in the row of buttons below and at 400px it wrapped onto a
          line of its own, a chip alone in the middle of nothing. */}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1.5 text-[10px] uppercase tracking-wide text-ink-soft/80">
        <span className="min-w-0">
          {onOpen ? (
            // `uppercase` again on the button: Tailwind's preflight resets
            // `text-transform` on every <button>, so it does not inherit.
            <button onClick={onOpen} className="uppercase transition hover:text-ink-soft">
              {dayLine(p.date)}
            </button>
          ) : (
            dayLine(p.date)
          )}
          {p.flow && (
            <>
              {" · "}
              <Link
                href={`/app/flows/${p.flow}`}
                className="underline-offset-4 transition hover:text-primary hover:underline"
              >
                del flujo {flowName ?? humanizeSlug(p.flow)}
              </Link>
            </>
          )}
        </span>
        <span className="ml-auto"><Chip tone={shape.tone}>{shape.label}</Chip></span>
      </div>

      {/* The product's own actions. Small and secondary on purpose: the card
          has to keep reading as a post, and these are what the client
          actually came to do with it. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.07] px-3 py-2.5">
        <CopyText text={() => forPublishing(p)} label="Copiar texto" />
        {!wide && current && <DownloadImage cfg={cfg} id={p.id} name={current.name} />}
      </div>
      <div className="px-3 pb-3">
        <AltText alt={wide ? (p.alts ?? [p.alt]).map((a, i) => (p.images.length > 1 ? `${i + 1}. ${a}` : a)).join("\n") : altOf(p, index)} />
      </div>
    </article>
  );
}

/** One image of the detail: its own shape, its own «Descargar», the name the
 *  file has so the client recognizes it once it lands — and the two things
 *  that are about THIS slide and no other: the brief it was made from and
 *  «Arreglar esta imagen».
 *
 *  The number is the one the client counts and the one the request quotes: the
 *  first slide is 1, and the file is called `01.png` for the same reason. */
function StackedImage({ cfg, p, name, index }: {
  cfg: PortalConfig | null; p: Post; name: string; index: number;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const brief = p.prompts?.[index];
  return (
    <div>
      <Frame ratio={ratio}>
        <PostImage cfg={cfg} id={p.id} name={name} alt={altOf(p, index)} onRatio={(r) => setRatio(frameRatio(r))} />
      </Frame>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <DownloadImage cfg={cfg} id={p.id} name={name} />
        <FixSlide post={p} number={index + 1} />
        <span className="text-[11px] text-ink-soft">
          {p.images.length > 1 ? `Imagen ${index + 1} · ${name}` : name}
        </span>
      </div>
      {/* A post saved before the brief travelled with the slide has none, and
          the control simply isn't there: there is nothing to show. */}
      {brief && <div className="px-3 pb-2"><Brief prompt={brief} /></div>}
      <Versions cfg={cfg} post={p} name={name} number={index + 1} />
    </div>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export default function PostsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  // The flows, only to put their NAME on the card: the post carries the slug.
  const [flows, setFlows] = useState<Flow[] | null>(null);
  // Who signs the posts: the client's company and the face they gave their
  // agent. The look is read lazily, like the layout does, so the first frame
  // doesn't paint the default violet one and flash.
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [look, setLook] = useState<AgentitoLook>(loadAgentLook);

  // Which post is open is decided by the URL (`?post=2026-09-15-…`): it can be
  // shared, refreshed, and "back" closes it.
  const openId = useRouteParam(PARAM.post);
  const open = useCallback((id: string) => openInRoute({ [PARAM.post]: id }), []);
  const close = useCallback(() => closeInRoute(PARAM.post), []);
  const [detail, setDetail] = useState<Post | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  useEffect(() => { setCfg(loadConfig()); setLook(loadAgentLook()); }, []);

  // silent: the background refresh doesn't blank the feed.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) setLoading(true);
    getPosts(cfg)
      .then((r) => { setPosts(r.posts); setErr(null); })
      .catch((e: HttpError) => setErr({ status: e.status, message: e.message }))
      .finally(() => setLoading(false));
  }, [cfg]);

  useEffect(() => {
    if (!cfg) return;
    load();
    getFlows(cfg)
      .then((r) => setFlows(r.flows))
      // Without the names the cards still work: the slug gets humanized.
      .catch(() => setFlows([]));
    getManifest(cfg)
      // Without the manifest the handle falls back to the name this browser
      // knows; the feed doesn't wait for it.
      .then(setManifest)
      .catch(() => setManifest(null));
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [cfg, load]);

  // The detail is ASKED FOR, not taken from the list: a shared link has to
  // open even when the feed hasn't arrived yet.
  useEffect(() => {
    if (!cfg || !openId) { setDetail(null); setDetailErr(null); return; }
    let alive = true;
    setDetail(null);
    setDetailErr(null);
    getPost(cfg, openId)
      .then((p) => { if (alive) setDetail(p); })
      .catch((e: HttpError) => { if (alive) setDetailErr(e.message); });
    return () => { alive = false; };
  }, [cfg, openId]);

  const flowName = useCallback(
    (slug: string | null) => (slug ? flows?.find((f) => f.slug === slug)?.name ?? null : null),
    [flows],
  );

  const handle = useMemo(
    () => handleOf(manifest?.company, manifest?.agent || loadAgentName() || ""),
    [manifest],
  );

  const header = (
    <PageHeader
      title="Posteos"
      subtitle="Lo que tu agente dejó armado para tus redes. Lo publicás vos"
      actions={
        <IconBtn label="Actualizar" disabled={loading} onClick={() => load()}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </IconBtn>
      }
    />
  );

  // The detail takes the whole screen: a post is an image at full width plus
  // its text, and inside a modal both come out squeezed.
  if (openId && detail) {
    return (
      <div className={DETAIL}>
        <div className="mb-3">
          <Btn kind="ghost" size="sm" onClick={close}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Cerrar
          </Btn>
        </div>
        <PostCard
          cfg={cfg}
          p={detail}
          look={look}
          handle={handle}
          flowName={flowName(detail.flow)}
          wide
        />
      </div>
    );
  }
  if (openId && !detailErr) {
    return <div className={FEED}>{header}<Spinner /></div>;
  }

  const body = () => {
    // The agent doesn't have the social capability: that's not a crash.
    // Reachable through a shared link, since the nav only hides the entry.
    if (posts === null && err?.status === 404) {
      return (
        <EmptyState
          icon={Images}
          title="Este agente todavía no arma posteos"
          hint="Es una capacidad que se suma aparte. Si la querés, escribinos y se la instalamos."
        />
      );
    }
    if (posts === null && err) return <ErrorState message={err.message} onRetry={() => load()} />;
    if (posts === null) return <Spinner />;
    if (posts.length === 0) {
      return (
        <EmptyState
          icon={Images}
          title="Todavía no hay posteos"
          hint="Cuando tu agente arme uno —la imagen, el texto y los hashtags— te va a quedar acá para revisar y bajar."
        />
      );
    }
    return (
      <div className="flex flex-col gap-5">
        {posts.map((p) => (
          <PostCard
            key={p.id}
            cfg={cfg}
            p={p}
            look={look}
            handle={handle}
            flowName={flowName(p.flow)}
            onOpen={() => open(p.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={FEED}>
      {header}

      {/* The card looks like something that is already up. It isn't, and the
          one thing this tab cannot let anyone misread is exactly that. */}
      <p className="mb-4 text-[12px] leading-relaxed text-ink-soft">
        Se ve como en Instagram para que sepas cómo va a quedar. Nada de esto está
        publicado: bajás la imagen, copiás el texto y lo subís vos.
      </p>

      {/* A link to a post that no longer exists: it says so and the feed
          stays, which is where the client can carry on. */}
      {openId && detailErr && (
        <StaleLinkNotice>
          Ese posteo ya no está — tu agente lo reemplazó o lo borró. Abajo está todo lo
          que tenés.
        </StaleLinkNotice>
      )}

      {err && posts !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {body()}
    </div>
  );
}
