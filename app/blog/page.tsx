import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { POSTS } from "./posts";
import { BlogHeader, BlogFooter } from "./ui";

export const metadata: Metadata = {
  title: "Blog — Agentes de IA explicados sin humo | tuagente.uy",
  description:
    "Qué es un agente de IA, cuánto cuesta, cómo funciona por dentro y en qué se diferencia de un chatbot. Explicado para dueños de empresas de LATAM.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog de tuagente.uy — Agentes de IA explicados sin humo",
    description: "Guías claras sobre agentes de IA para empresas de LATAM.",
    url: "https://tuagente.uy/blog",
  },
};

const TONES = [
  ["bg-c-violet", "text-c-violet-ink"],
  ["bg-c-green", "text-c-green-ink"],
  ["bg-c-coral", "text-c-coral-ink"],
  ["bg-c-amber", "text-c-amber-ink"],
  ["bg-c-violet", "text-c-violet-ink"],
];

export default function BlogIndex() {
  return (
    <main className="overflow-x-hidden">
      <BlogHeader />
      <section className="mx-auto max-w-5xl px-5 pb-16 pt-10 sm:px-8">
        <h1 className="text-5xl font-extrabold tracking-tight text-ink sm:text-6xl">
          El blog<span className="text-primary">.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft">
          Agentes de IA explicados sin humo, para gente que maneja una empresa y no tiene tiempo
          para tecnicismos.
        </p>

        <div className="mt-10 space-y-5">
          {POSTS.map((p, i) => {
            const [bg, ink] = TONES[i % TONES.length];
            return (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className={`${bg} ${ink} group block rounded-card p-7 transition duration-300 hover:-translate-y-1 sm:p-9`}
              >
                <p className="text-xs font-bold uppercase tracking-wider opacity-60">
                  {p.dateHuman} · {p.readingMin} min
                </p>
                <h2 className="mt-3 max-w-2xl text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">
                  {p.title}
                </h2>
                <p className="mt-3 max-w-2xl text-base opacity-80">{p.description}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-extrabold">
                  Leer <ArrowRight size={15} className="transition group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
      <BlogFooter />
    </main>
  );
}
