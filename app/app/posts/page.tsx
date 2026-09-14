"use client";

// Posteos — what the agent left ready to publish: the image, the text and the
// hashtags. IT DOES NOT PUBLISH. The client reviews it, copies the caption,
// downloads the images and posts them from their own account; that is the
// whole promise of the tab and the copy repeats it wherever it could be
// misread.
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
// THE CAPTION IS NOT MARKDOWN and does not go through `lib/Markdown.tsx`. It
// is the literal text that gets pasted into the network: its line breaks are
// the post's line breaks and its `#` are hashtags, not headings. Rendered it
// would come out with a title where the client wrote a hashtag. Plain text
// with `whitespace-pre-wrap`.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, Copy, Download, ImageOff, Images, RefreshCw, Workflow,
} from "lucide-react";
import {
  getFlows, getPost, getPostImage, getPosts, loadConfig,
  type Flow, type HttpError, type Post, type PortalConfig,
} from "../lib/agent";
import { CopyLink, PARAM, closeInRoute, openInRoute, useRouteParam } from "../lib/routes";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner, StaleLinkNotice,
} from "../lib/ui";

const WRAP = "mx-auto max-w-4xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

/* ── Words ───────────────────────────────────────────────────────────────── */

// «lunes 15 de septiembre». `date` is a bare calendar day with no offset — it
// is the day the post is FOR, not an instant — so it gets formatted in UTC:
// the same trick `lib/labels.ts` uses to draw a clock that isn't the viewer's
// without inventing a timezone.
const DAY = { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } as const;
const DAY_FMT = new Intl.DateTimeFormat("es-UY", DAY);
// The year only shows when it isn't this one: on an old post "lunes 15 de
// septiembre" alone reads as a date from this week.
const DAY_YEAR_FMT = new Intl.DateTimeFormat("es-UY", { ...DAY, year: "numeric" });

function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const fmt = d.getUTCFullYear() === new Date().getUTCFullYear() ? DAY_FMT : DAY_YEAR_FMT;
  // es-UY writes "lunes, 15 de septiembre"; the comma is extra on its own line.
  return fmt.format(d).replace(",", "");
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

/** The first lines of the caption, for the card. WITHOUT the blank lines a
 *  caption is full of: clamped to three lines, the first blank one eats a
 *  third of the preview and the card ends on an ellipsis having said almost
 *  nothing. They come back whole in the detail, which is where the text is
 *  read. */
const preview = (caption: string) =>
  caption.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join("\n");

/** What gets pasted into the network: the text, a blank line, and the
 *  hashtags with their `#`. The client copies once and pastes once — copying
 *  the caption and then hunting for the tags was two trips for one post. */
function forPublishing(p: Post): string {
  if (p.hashtags.length === 0) return p.caption;
  return `${p.caption}\n\n${p.hashtags.map((h) => `#${h}`).join(" ")}`;
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

function PostImage({ cfg, id, name, alt, className }: {
  cfg: PortalConfig | null; id: string; name: string; alt: string; className: string;
}) {
  const { url, failed } = usePostImage(cfg, id, name);
  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-black/[0.03] ${className}`}>
        <ImageOff className="h-5 w-5 text-ink-soft/40" />
      </div>
    );
  }
  if (!url) {
    // It reads as "on its way" and not as an empty box: on white, a 3% gray
    // rectangle is indistinguishable from a card that came up broken.
    return <div className={`animate-pulse bg-black/[0.06] ${className}`} aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- next/image can't
  // carry the bearer, and these bytes only exist as an object URL.
  return <img src={url} alt={alt} className={className} />;
}

/* ── Copying and downloading ─────────────────────────────────────────────── */

/** Copies a piece of text and says it did. `navigator.clipboard` doesn't
 *  exist outside a secure context (plain http), and there it falls back to
 *  the browser's prompt — ugly, but a button that does nothing is worse. The
 *  same reasoning as `CopyUrl` in `lib/routes.tsx`. */
function CopyText({ text, label }: { text: () => string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    const value = text();
    const ok = () => { setDone(true); setTimeout(() => setDone(false), 1800); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(ok).catch(() => window.prompt("Copiá el texto:", value));
      return;
    }
    window.prompt("Copiá el texto:", value);
  };
  return (
    <Btn kind="secondary" size="sm" onClick={copy}>
      {done ? <Check className="h-3.5 w-3.5 text-c-green-ink" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copiado" : label}
    </Btn>
  );
}

/** Downloads one image with the name the agent gave it. The bytes are asked
 *  for again instead of reusing the object URL on screen: the preview is
 *  mounted per component and may not be the one being downloaded. */
function DownloadImage({ cfg, id, name }: { cfg: PortalConfig | null; id: string; name: string }) {
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
      a.download = name;
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

/* ── The flow that made it ───────────────────────────────────────────────── */

function FlowLink({ slug, name, onClick }: {
  slug: string; name: string; onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={`/app/flows/${slug}`}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft underline-offset-4 transition hover:text-primary hover:underline"
    >
      <Workflow className="h-3.5 w-3.5 shrink-0" />
      {name}
    </Link>
  );
}

/* ── The list ────────────────────────────────────────────────────────────── */

function PostCard({ cfg, p, flowName, onOpen }: {
  cfg: PortalConfig | null; p: Post; flowName: string | null; onOpen: () => void;
}) {
  const shape = formatLabel(p.format);
  const cover = p.images[0];
  return (
    // role=button and not <button>: the flow's link lives inside, and a
    // button can't contain a link.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
      }}
      className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-black/[0.07] bg-white text-left transition hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {cover ? (
        // object-contain and not cover: a story is 9:16 and a feed 4:5, and
        // cropping them to the same box hides exactly what the client came to
        // check.
        <PostImage
          cfg={cfg}
          id={p.id}
          name={cover.name}
          alt={p.alt}
          className="h-56 w-full border-b border-black/[0.07] bg-black/[0.03] object-contain"
        />
      ) : (
        <div className="flex h-56 w-full items-center justify-center border-b border-black/[0.07] bg-black/[0.03]">
          <ImageOff className="h-5 w-5 text-ink-soft/40" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-ink-soft">{longDate(p.date)}</span>
          <span className="ml-auto"><Chip tone={shape.tone}>{shape.label}</Chip></span>
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-snug text-ink">
          {preview(p.caption)}
        </p>
        {p.flow && (
          <div className="mt-auto pt-1">
            <FlowLink
              slug={p.flow}
              name={flowName ?? humanizeSlug(p.flow)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── The detail ──────────────────────────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
      {children}
    </p>
  );
}

function PostDetail({ cfg, p, flowName, onClose }: {
  cfg: PortalConfig | null; p: Post; flowName: string | null; onClose: () => void;
}) {
  const shape = formatLabel(p.format);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn kind="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Cerrar
        </Btn>
        <span className="text-[13px] text-ink-soft">{longDate(p.date)}</span>
        <Chip tone={shape.tone}>{shape.label}</Chip>
        {p.flow && <FlowLink slug={p.flow} name={flowName ?? humanizeSlug(p.flow)} />}
        <span className="ml-auto"><CopyLink label="Copiar el link de este posteo" /></span>
      </div>

      {/* The images, in order and at full width: this is what gets looked at
          before deciding whether it goes up. */}
      {p.images.map((img) => (
        <Card key={img.name} className="flex flex-col gap-3">
          {/* Full width, but never taller than the screen: a feed image is
              4:5 and a story 9:16, so at the full width of the column one
              image alone is two screenfuls and the text it goes with ends up
              below the fold. Capped, the whole post is one look. */}
          <PostImage
            cfg={cfg}
            id={p.id}
            name={img.name}
            alt={p.alt}
            className="max-h-[70vh] w-full rounded-lg bg-black/[0.03] object-contain"
          />
          <div className="flex flex-wrap items-center gap-2">
            <DownloadImage cfg={cfg} id={p.id} name={img.name} />
            <span className="text-[12px] text-ink-soft">{img.name}</span>
          </div>
        </Card>
      ))}

      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>El texto</Label>
          <CopyText text={() => forPublishing(p)} label="Copiar" />
        </div>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{p.caption}</p>
        {p.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-black/[0.07] pt-3">
            {p.hashtags.map((h) => (
              <Chip key={h} tone="violet">#{h}</Chip>
            ))}
          </div>
        )}
        {/* What "Copiar" actually takes, said once: the button copies the
            text AND the hashtags, and without this the client copies, pastes,
            and goes back looking for the tags they can already see below. */}
        <p className="text-[12px] text-ink-soft">
          «Copiar» te lleva el texto y los hashtags juntos, listos para pegar.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Texto alternativo</Label>
          <CopyText text={() => p.alt} label="Copiar" />
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{p.alt}</p>
        <p className="text-[12px] text-ink-soft/80">
          Es la descripción de la imagen para quien no la puede ver. Va en el campo de
          accesibilidad, no en el texto del posteo.
        </p>
      </Card>
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

  // Which post is open is decided by the URL (`?post=2026-09-15-…`): it can be
  // shared, refreshed, and "back" closes it.
  const openId = useRouteParam(PARAM.post);
  const open = useCallback((id: string) => openInRoute({ [PARAM.post]: id }), []);
  const close = useCallback(() => closeInRoute(PARAM.post), []);
  const [detail, setDetail] = useState<Post | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silent: the background refresh doesn't blank the grid.
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
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [cfg, load]);

  // The detail is ASKED FOR, not taken from the list: a shared link has to
  // open even when the grid hasn't arrived yet.
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
      <div className={WRAP}>
        <PostDetail cfg={cfg} p={detail} flowName={flowName(detail.flow)} onClose={close} />
      </div>
    );
  }
  if (openId && !detailErr) {
    return <div className={WRAP}>{header}<Spinner /></div>;
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) => (
          <PostCard
            key={p.id}
            cfg={cfg}
            p={p}
            flowName={flowName(p.flow)}
            onOpen={() => open(p.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={WRAP}>
      {header}

      {/* A link to a post that no longer exists: it says so and the list
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
