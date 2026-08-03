import Link from "next/link";
import { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bot, Clock } from "lucide-react";
import { POSTS } from "./posts";

export const SITE = "https://tuagente.uy";
export const WHATSAPP = "https://wa.me/59899002835";

export function BlogHeader() {
  return (
    <header className="sticky top-0 z-50 mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
      <Link href="/" className="flex items-center gap-2 rounded-pill bg-white/70 px-4 py-2 backdrop-blur">
        <span className="grid h-7 w-7 place-items-center rounded-xl bg-primary text-white">
          <Bot size={17} />
        </span>
        <span className="text-lg font-extrabold tracking-tight text-ink">
          tuagente<span className="text-primary">.uy</span>
        </span>
      </Link>
      <a
        href={WHATSAPP}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-pill bg-ink px-5 py-2.5 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-primary"
      >
        Agendá una demo
      </a>
    </header>
  );
}

export function BlogFooter() {
  return (
    <footer className="border-t border-ink/5 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-5 py-10 text-center text-sm text-ink-soft sm:px-8">
        <div className="flex items-center gap-4 font-semibold">
          <Link href="/" className="hover:text-primary">Inicio</Link>
          <Link href="/blog" className="hover:text-primary">Blog</Link>
          <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="hover:text-primary">WhatsApp</a>
        </div>
        <p className="text-xs text-ink-soft/70">
          © {new Date().getFullYear()} tuagente.uy · Un producto de pdelabs. Hecho en Uruguay 🇺🇾
        </p>
      </div>
    </footer>
  );
}

/* ── Typography building blocks ─────────────────────────────────────────── */

export const P = ({ children }: { children: ReactNode }) => (
  <p className="mt-5 text-lg leading-relaxed text-ink-soft">{children}</p>
);

export const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-12 text-3xl font-extrabold tracking-tight text-ink">{children}</h2>
);

export const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-bold text-ink">{children}</strong>
);

export const Ul = ({ children }: { children: ReactNode }) => (
  <ul className="mt-5 space-y-3 pl-5 text-lg leading-relaxed text-ink-soft [&>li]:list-disc [&>li]:marker:text-primary">
    {children}
  </ul>
);

export const Callout = ({ children }: { children: ReactNode }) => (
  <div className="mt-8 rounded-card bg-c-violet p-6 text-lg font-semibold leading-relaxed text-c-violet-ink sm:p-7">
    {children}
  </div>
);

export const PostLink = ({ slug, children }: { slug: string; children: ReactNode }) => (
  <Link href={`/blog/${slug}`} className="font-semibold text-primary underline decoration-2 underline-offset-2 hover:text-primary-dark">
    {children}
  </Link>
);

/* ── Article shell ──────────────────────────────────────────────────────── */

export function ArticleLayout({ slug, children }: { slug: string; children: ReactNode }) {
  const post = POSTS.find((p) => p.slug === slug)!;
  const others = POSTS.filter((p) => p.slug !== slug).slice(0, 3);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: "es",
    mainEntityOfPage: `${SITE}/blog/${post.slug}`,
    author: { "@type": "Organization", name: "tuagente.uy", url: SITE },
    publisher: {
      "@type": "Organization",
      name: "tuagente.uy",
      url: SITE,
      logo: { "@type": "ImageObject", url: `${SITE}/tuagente-mark.svg` },
    },
  };

  return (
    <main className="overflow-x-hidden">
      <BlogHeader />
      <article className="mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-8">
        <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:text-primary-dark">
          <ArrowLeft size={15} /> Volver al blog
        </Link>
        <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
          {post.title}
        </h1>
        <p className="mt-4 flex items-center gap-3 text-sm font-medium text-ink-soft">
          {post.dateHuman}
          <span className="inline-flex items-center gap-1"><Clock size={14} /> {post.readingMin} min de lectura</span>
        </p>
        {children}

        <div className="mt-14 rounded-card bg-primary p-8 text-center text-white sm:p-10">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            ¿Querés ver esto funcionando en tu empresa?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-white/80">
            La demo es gratis: te mostramos con tu caso qué puede hacer un agente, antes de que pongas un peso.
          </p>
          <a
            href={WHATSAPP}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-pill bg-white px-7 py-3.5 text-sm font-extrabold text-primary shadow-lift transition hover:-translate-y-0.5"
          >
            Agendá una demo <ArrowRight size={16} />
          </a>
        </div>

        <div className="mt-14">
          <h2 className="text-xl font-extrabold tracking-tight text-ink">Seguí leyendo</h2>
          <div className="mt-4 space-y-3">
            {others.map((o) => (
              <Link
                key={o.slug}
                href={`/blog/${o.slug}`}
                className="group flex items-center justify-between gap-4 rounded-card border border-ink/5 bg-white p-5 shadow-soft transition hover:-translate-y-0.5"
              >
                <span className="font-bold text-ink group-hover:text-primary">{o.title}</span>
                <ArrowRight size={17} className="shrink-0 text-primary" />
              </Link>
            ))}
          </div>
        </div>
      </article>
      <BlogFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </main>
  );
}
