"use client";

// Posts' welcome screen.
//
// The one thing this screen has to land: NOTHING GOES OUT WITHOUT THE CLIENT'S
// YES. The agent leaves the post ready, and it goes up either because the
// client posts it or because they ask the agent to and approve it in
// Aprobaciones. It used to say «Publicás vos» while the tab offered «pedile
// que lo publique» (QA, 2026-09-23): the two have to say the same thing, and
// a screen that opens with "your agent's posts" without saying it invites
// someone to wait for a post that is never going up.
//
// The illustration is one post as it looks in the tab -- the image, the text,
// the hashtags -- drawn in inline SVG and divs. The picture is deliberately
// ABSTRACT (shapes, not a photo of anything): a drawing can never assert a
// fact about the client, and a legible mock image would read as a post the
// agent already made for them. It goes inside `Mockup` for the same reason
// the other screens' do.

import { Copy, Download, Images, PencilLine } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Mockup, Point, Title, type IntroProps } from "./shell";

const HASHTAGS = ["w-14", "w-20", "w-12", "w-16"];

/** The post's picture: brand-coloured shapes, no text, nothing readable. */
function Picture() {
  return (
    <svg viewBox="0 0 160 200" className="h-full w-full" aria-hidden>
      <rect width="160" height="200" rx="10" className="fill-c-violet" />
      <circle cx="112" cy="52" r="26" className="fill-c-amber" />
      <path d="M0 148 L52 96 L104 148 L160 104 L160 200 L0 200 Z" className="fill-c-green" />
      <path d="M0 176 L46 140 L96 176 L160 142 L160 200 L0 200 Z" className="fill-primary opacity-70" />
    </svg>
  );
}

/** A "line" of the caption. */
function Line({ w }: { w: string }) {
  return <span className={`block h-1.5 rounded-pill bg-black/[0.1] ${w}`} />;
}

export default function PostsIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis posteos"
      note="Si tu agente recién arranca, puede estar vacío."
    >
      <Eyebrow icon={Images}>Posteos</Eyebrow>
      <Title>Listos para publicar, cuando vos digas</Title>
      <Lead>
        Acá quedan los posteos que tu agente arma: la imagen, el texto y los hashtags,
        listos para revisar. Nada sale sin tu sí: lo bajás y lo subís vos, o le pedís
        que lo publique y te lo deja en Aprobaciones.
      </Lead>

      <div className="mt-6 grid gap-6 md:grid-cols-2 md:items-start">
        <Mockup
          className="min-w-0 bg-gradient-to-br from-c-violet/60 via-surface to-white"
          note="Un posteo inventado: no es tuyo."
        >
          <div className="overflow-hidden rounded-card border border-black/[0.07] bg-white">
            <div className="h-44 w-full overflow-hidden bg-black/[0.03]">
              <Picture />
            </div>
            <div className="space-y-2 p-3">
              <span className="block h-1.5 w-16 rounded-pill bg-black/[0.16]" />
              <div className="space-y-1.5">
                <Line w="w-full" />
                <Line w="w-[92%]" />
                <Line w="w-[64%]" />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {HASHTAGS.map((w) => (
                  <span key={w} className={`block h-3 rounded-md bg-c-violet ${w}`} />
                ))}
              </div>
            </div>
          </div>
        </Mockup>

        <div className="grid min-w-0 gap-5">
          <Point icon={PencilLine} title="Lo revisás antes que nadie">
            Mirás la imagen, leés el texto y decidís. Si no te gusta, se lo decís por el
            chat y te arma otro.
          </Point>
          <Point icon={Copy} title="El texto se copia entero">
            Un botón te lleva el texto y los hashtags juntos, tal cual van pegados.
          </Point>
          <Point icon={Download} title="Las imágenes te las bajás">
            Cada imagen se descarga como está, con su nombre, para subirla desde el
            teléfono o la computadora.
          </Point>
        </div>
      </div>
    </IntroPage>
  );
}
