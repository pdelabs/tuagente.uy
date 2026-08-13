"use client";

// Render markdown de las respuestas del agente — sobrio, tipografía primero.
// GFM (tablas, tachado, task lists) + matemática (KaTeX) + código con
// highlighting + diagramas mermaid.
//
// Todo esto se dibuja mientras el mensaje streamea, así que el markdown llega
// roto la mayor parte del tiempo: fences a medio abrir, tablas sin cuerpo,
// `$$` sin cerrar. La regla es que nada de eso explote ni parpadee feo.

import { Children, memo, useMemo, type ReactNode } from "react";
import type { Element, ElementContent } from "hast";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  FileText, Image as ImageIcon, LayoutDashboard, Sheet, Ticket as TicketIcon,
} from "lucide-react";
import {
  detectEntity, EntityChip, esImagen, esPlanilla, useOpenEntity, EXT_ARCHIVO, type Entity,
} from "./entities";
import { nombreLegibleDeArchivo } from "./nombres";
import { PARAM } from "./rutas";
import Artifact from "./Artifact";
import CodeBlock from "./CodeBlock";
import Mermaid from "./Mermaid";
import "katex/dist/katex.min.css";

/* ── Parseo ─────────────────────────────────────────────────────────────── */

function nodeText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(nodeText).join("");
  return "";
}

/** Saca `{ code, lang }` del <pre><code class="language-x"> que arma remark. */
function fenceOf(node: Element | undefined): { code: string; lang: string | null } | null {
  const child = node?.children.find((c) => c.type === "element");
  if (!child || child.type !== "element" || child.tagName !== "code") return null;

  // `unknown` a propósito: hast lo tipa como string[], pero según el plugin
  // puede llegar como string suelto.
  const raw: unknown = child.properties?.className;
  const classes = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(/\s+/)
      : [];

  let lang: string | null = null;
  for (const c of classes) {
    const m = /^language-(.+)$/.exec(c);
    if (m) {
      lang = m[1];
      break;
    }
  }
  return { code: nodeText(child), lang };
}

/**
 * Cierra el fence que quedó abierto al final del texto. Sin esto, mientras el
 * agente escribe un bloque de código el markdown tiene ``` impares y remark lo
 * degrada a párrafo suelto: el bloque aparece, desaparece y vuelve. Cerrándolo
 * se dibuja desde el primer token y sólo crece.
 */
export function closeOpenFence(md: string): string {
  const lines = md.split("\n");
  let openChar = "";
  let openLen = 0;

  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const fence = m[1];
    const rest = m[2];
    const ch = fence[0];

    if (!openChar) {
      // El info string de un fence de backticks no puede tener backticks.
      if (ch === "`" && rest.includes("`")) continue;
      openChar = ch;
      openLen = fence.length;
    } else if (ch === openChar && fence.length >= openLen && rest.trim() === "") {
      openChar = "";
      openLen = 0;
    }
  }

  if (!openChar) return md;
  return `${md}${md.endsWith("\n") ? "" : "\n"}${openChar.repeat(openLen)}`;
}

/** ¿La URL se puede pedir de verdad, o es un path del workspace del agente? */
function isFetchable(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src);
}

/* ── Lo que el agente nombró, convertido en algo que se toca ─────────────── */

/** ¿El portal sabe abrir esto?
 *
 *  El adapter sirve SOLO lo que está adentro del workspace del agente
 *  (`GET /portal/files/{ruta}`, con la ruta relativa a él). Medido contra el
 *  adapter del lab (0.36):
 *    /portal/files/entregables%2F…-2026.md          → 200
 *    /portal/files/workspace%2Fentregables%2F…      → 404  (el prefijo se saca acá)
 *    /portal/files/..%2FSOUL.md                     → 404
 *  `detectEntity` acepta cualquier ruta con extensión conocida, así que una
 *  absoluta que no salga del workspace (`/opt/data/skills/x.md`, un archivo de
 *  la máquina del agente) entra como entidad y termina en un chip que promete
 *  abrir algo y contesta "no encontré ese archivo". Un link que no lleva a
 *  ningún lado es peor que texto: eso se queda como texto. */
function abrible(entity: Entity): boolean {
  if (entity.kind !== "file") return true;
  return !entity.path.startsWith("/") && !entity.path.split("/").includes("..");
}

// Mismo encodeado que `lib/rutas.tsx`: la barra se deja legible en la URL.
const enRuta = (s: string) => encodeURIComponent(s).replace(/%2F/gi, "/");

/** Dónde vive la cosa, como link común y corriente. RELATIVO a propósito: con
 *  `window.location.origin` el href saldría distinto en el prerender y en el
 *  browser, y eso es un desajuste de hidratación en una página estática. */
function urlDeLaCosa(entity: Entity): string {
  if (entity.kind === "ticket") return `/app/pipeline?${PARAM.tarea}=${enRuta(entity.id)}`;
  if (entity.kind === "artifact") {
    return `/app/artefactos?${PARAM.visualizacion}=${enRuta(entity.id)}`;
  }
  if (entity.kind === "file") return `/app/archivos?${PARAM.archivo}=${enRuta(entity.path)}`;
  return `/app/conexiones?${PARAM.conexion}=${enRuta(entity.id)}`;
}

const CLASE_COSA =
  "inline rounded-md border border-c-violet bg-c-violet/40 px-1.5 py-0.5 align-baseline " +
  "text-[0.95em] font-medium text-primary transition hover:border-primary hover:bg-c-violet";

/** Lo que el agente nombró (un archivo suyo, una tarea, una visualización),
 *  dibujado como algo que se abre.
 *
 *  DOS COSAS ESTABAN ROTAS EN EL MISMO RENGLÓN, y las dos las anotó la misma
 *  clienta de prueba sobre el link con el que su agente le entregaba el informe
 *  que acababa de pedir:
 *
 *  1. NO SE PODÍA TOCAR. El chip abre un modal pidiéndoselo al proveedor de
 *     entidades, y afuera del chat —el alta, que ahora tiene el chat adentro—
 *     no hay proveedor: el chip se dibujaba como `<code>`, inerte. "Le hice
 *     click tres veces." Ahora, sin proveedor, es un link a la pestaña donde la
 *     cosa vive, que es exactamente adónde quería ir.
 *  2. DECÍA LA RUTA, EN MONOESPACIADA Y CORTADA.
 *     `workspace/entregables/control-semanal-contratos/2026-08-13-prueba-del-…`
 *     es una dirección, no un nombre. Ahora dice el nombre en criollo
 *     (`lib/nombres.ts`) y con la tipografía del portal; la ruta sigue viajando
 *     en el link. */
function Cosa({ entity, texto }: { entity: Entity; texto?: string }) {
  const abrir = useOpenEntity();

  const etiqueta =
    texto?.trim() ||
    (entity.kind === "file" ? nombreLegibleDeArchivo(entity.path) : entity.id);

  const Icon =
    entity.kind === "ticket" ? TicketIcon
      : entity.kind === "artifact" ? LayoutDashboard
        : entity.kind === "file" && esImagen(entity.path) ? ImageIcon
          : entity.kind === "file" && esPlanilla(entity.path) ? Sheet
            : FileText;

  const titulo =
    entity.kind === "ticket" ? "Ver la tarea"
      : entity.kind === "artifact" ? "Ver la visualización"
        : "Abrir el archivo";

  const adentro = (
    <>
      <Icon className="mr-1 inline h-[1em] w-[1em] -translate-y-[0.1em]" aria-hidden />
      {etiqueta}
    </>
  );

  // Con proveedor se abre acá mismo, sin salir de la conversación.
  if (abrir) {
    return (
      <button onClick={() => abrir(entity)} title={titulo} className={`${CLASE_COSA} text-left`}>
        {adentro}
      </button>
    );
  }
  // Sin proveedor, pestaña nueva. Las dos pantallas que dibujan markdown sin
  // proveedor son el chat del alta y la cola de aprobaciones: en las dos el
  // cliente está a mitad de algo (contestando el alta, decidiendo un pedido) y
  // llevárselo a otra pestaña del portal sería sacarlo de ahí. Así abre el
  // documento y vuelve a lo suyo con cerrar.
  return (
    <a href={urlDeLaCosa(entity)} target="_blank" rel="noopener noreferrer"
      title={titulo} className={CLASE_COSA}>
      {adentro}
    </a>
  );
}

/** El chip de una entidad, sea del tipo que sea. Las conexiones, los permisos y
 *  las capacidades tienen tarjeta propia (`entities.tsx`); el resto se abre. */
function ChipDeEntidad({ entity, texto }: { entity: Entity; texto?: string }) {
  if (entity.kind === "conexion" || entity.kind === "permisos" || entity.kind === "capacidad") {
    return <EntityChip entity={entity} label={texto?.trim() || entity.id} />;
  }
  return <Cosa entity={entity} texto={texto} />;
}

/* ── Componentes ────────────────────────────────────────────────────────── */

// El agente también nombra tickets, archivos y conexiones en prosa, sin
// backticks. El \b va DENTRO de cada alternativa: si estuviera antes del
// prefijo opcional /opt/data/, nunca casaría (el `/` no es carácter de
// palabra) y el prefijo quedaría suelto como texto al lado del chip.
// `capacidad:` va acá también: el SOUL le enseña al agente a escribirlo solo en
// una línea, pero lo escribe en prosa la mitad de las veces.
//
// Las carpetas de primer nivel del workspace van también sin el prefijo: el
// kit le enseña a citar `workspace/entregables/…` (skills/entregable/SKILL.md),
// pero la mitad de las veces escribe `entregables/…` a secas y ese renglón
// quedaba sin chip — el mismo archivo, entregado dos veces, una clicable y la
// otra no. Son las tres carpetas de la convención (las mismas que separa la
// pestaña Archivos), no cualquier ruta relativa: `informe.md` suelto en una
// frase no es una promesa de que el portal lo pueda abrir.
const INLINE_ENTITY_RE = new RegExp(
  "(\\bt_[0-9a-f]{6,16}\\b" +
  "|\\bconexi[oó]n:[a-z0-9][a-z0-9-]*\\b" +
  "|\\bcapacidad:[a-z0-9][a-z0-9-]*\\b" +
  `|(?:/opt/data/)?\\b(?:workspace|entregables|entrada|interno)/[\\w./-]+\\.(?:${EXT_ARCHIVO})\\b)`,
  "gi");

function linkify(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of Array.from(child.matchAll(INLINE_ENTITY_RE))) {
      const entity = detectEntity(m[0]);
      if (!entity || !abrible(entity) || m.index === undefined) continue;
      if (m.index > last) parts.push(child.slice(last, m.index));
      parts.push(<ChipDeEntidad key={m.index} entity={entity} />);
      last = m.index + m[0].length;
    }
    if (!parts.length) return child;
    if (last < child.length) parts.push(child.slice(last));
    return parts;
  });
}

function makeComponents(streaming: boolean): Components {
  return {
    p: ({ children }) => (
      <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{linkify(children)}</p>
    ),
    // Un href que no se puede pedir NO puede ser un link.
    //
    // El agente escribe rutas de su propio workspace y remark las convierte en
    // `<a href="workspace/entregables/cartel.jpg">`. Tocarlo navegaba a
    // /app/workspace/… y el cliente recibía "404: This page could not be
    // found" por un archivo que su agente acababa de hacer bien. Si la ruta es
    // una entidad conocida se dibuja el chip que la abre de verdad; si no,
    // queda como texto — feo, pero nunca miente.
    a: ({ href, children }) => {
      const url = typeof href === "string" ? href : "";
      // `/opt/…` entra acá aunque empiece con barra: es la ruta absoluta del
      // workspace, la que el agente usa para releer sus archivos, y como link
      // del portal daba 404. El resto de las rutas absolutas (`/app/…`,
      // `/blog/…`) son del sitio y siguen siendo links comunes.
      const delAgente = !url.startsWith("/") || url.startsWith("/opt/");
      if (url && !isFetchable(url) && delAgente && !url.startsWith("#")) {
        const entity = detectEntity(url);
        const texto = Children.toArray(children).every((c) => typeof c === "string")
          ? Children.toArray(children).join("")
          : "";
        // El texto del link sirve como etiqueta sólo si el agente escribió uno:
        // cuando repite la ruta (que es lo que hace remark con un link
        // automático) vuelve a ser una dirección, y ahí manda el nombre.
        const etiqueta = texto.trim() === url.trim() ? "" : texto.trim();
        if (entity && abrible(entity)) {
          return <ChipDeEntidad entity={entity} texto={etiqueta} />;
        }
        return <>{children}</>;
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:text-primary-dark"
        >
          {children}
        </a>
      );
    },
    ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
    li: ({ children, className }) => (
      <li
        className={
          className?.includes("task-list-item")
            ? "-ml-5 list-none leading-relaxed"
            : "leading-relaxed"
        }
      >
        {linkify(children)}
      </li>
    ),
    input: ({ type, checked }) =>
      type === "checkbox" ? (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          disabled
          className="mr-2 h-3.5 w-3.5 translate-y-[1px] accent-primary"
        />
      ) : null,
    h1: ({ children }) => (
      <h1 className="mb-2 mt-4 text-lg font-bold tracking-tight text-ink first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-base font-bold tracking-tight text-ink first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-[15px] font-semibold text-ink first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1.5 mt-3 text-[15px] font-semibold text-ink-soft first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mb-1 mt-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-soft first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mb-1 mt-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-soft first:mt-0">
        {children}
      </h6>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-black/15 pl-3 text-ink-soft">
        {children}
      </blockquote>
    ),

    // El bloque de código se dibuja desde <pre>, así `code` sólo ve el inline.
    pre: ({ children, node }) => {
      const fence = fenceOf(node);
      if (!fence) {
        return (
          <pre className="my-3 overflow-x-auto rounded-lg border border-black/[0.07] bg-black/[0.03] p-3.5 text-[13px] leading-relaxed text-ink [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-normal [&_code]:text-inherit">
            {children}
          </pre>
        );
      }
      const lang = fence.lang?.trim().toLowerCase() ?? "";
      if (lang === "mermaid") {
        return <Mermaid chart={fence.code} streaming={streaming} />;
      }
      // HTML/SVG completo: mostrarlo como código no sirve de nada, se dibuja.
      if (lang === "html" || lang === "svg") {
        return <Artifact code={fence.code} lang={lang} streaming={streaming} />;
      }
      return <CodeBlock code={fence.code} lang={fence.lang} />;
    },
    // El agente nombra sus tickets y archivos en código inline: los volvemos
    // chips que abren el detalle sin salir del chat.
    code: ({ children }) => {
      const raw = Array.isArray(children) ? children.join("") : String(children ?? "");
      const entity = detectEntity(raw);
      if (entity && abrible(entity)) return <ChipDeEntidad entity={entity} />;
      return (
        <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
          {children}
        </code>
      );
    },

    hr: () => <hr className="my-4 border-black/[0.08]" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-black/[0.08]">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-black/[0.08] bg-black/[0.03] px-3 py-2 text-left font-semibold text-ink">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-t border-black/[0.06] px-3 py-2 align-top">{children}</td>
    ),

    img: ({ src, alt, title }) => {
      const url = typeof src === "string" ? src : "";
      if (!url) return null;

      // El agente escribe paths de su propio workspace (./out/plot.png): pedir
      // eso al portal da 404 e ícono roto. La imagen SÍ se puede abrir —el
      // visor la muestra pidiéndole los bytes al adapter—, así que va el mismo
      // chip que el resto: antes era una cajita muerta con la ruta adentro, o
      // sea el cartel que el agente acababa de hacer, a la vista y sin manera
      // de mirarlo.
      if (!isFetchable(url)) {
        const entity = detectEntity(url);
        if (entity && abrible(entity)) {
          return <ChipDeEntidad entity={entity} texto={alt?.trim()} />;
        }
        return (
          <span className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/[0.07] bg-black/[0.03] px-2 py-1 align-middle text-ink-soft">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate text-[12px]">{alt?.trim() || url}</span>
          </span>
        );
      }

      return (
        <span className="my-2 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt ?? ""}
            title={title}
            loading="lazy"
            className="block h-auto max-w-full rounded-lg border border-black/[0.07]"
          />
          {alt?.trim() ? (
            <span className="mt-1 block text-[12px] leading-snug text-ink-soft">{alt}</span>
          ) : null}
        </span>
      );
    },
  };
}

const STATIC_COMPONENTS = makeComponents(false);
const STREAMING_COMPONENTS = makeComponents(true);

// `singleDollarTextMath: false` NO es un detalle: acá se habla de plata en
// pesos y en dólares, y con el default de remark-math un "$ 5.100 … $ 31.500"
// se lee como una fórmula — KaTeX se come el texto del medio, junta las
// palabras y lo deja en itálica de matemática. Una lista de clientes con
// montos quedaba ilegible en el chat aunque el archivo estuviera perfecto.
// La matemática de verdad sigue andando con `$$…$$`.
const remarkPlugins: Options["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];

// El agente a veces escribe HTML dentro del markdown (una tabla, un <details>).
// Sin rehype-raw se ve escapado como texto; con raw a secas sería XSS. Va raw +
// sanitize con allowlist: se permite marcado de contenido, jamás script, iframe,
// style, event handlers ni javascript: en href. El HTML "de verdad" (una página
// entera) llega como bloque ```html y se dibuja aislado en Artifact.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "figure", "figcaption", "mark"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    details: ["open"],
  },
};

// rehype-katex ya fuerza throwOnError:false; el errorColor apagado evita el
// rojo chillón mientras una fórmula está a medio escribir.
const rehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, schema],
  [rehypeKatex, { errorColor: "#4B4A5C", strict: "ignore" }],
];

/* ── Lo que el portal le escribe AL AGENTE ───────────────────────────────── */

/** La orden que el portal mete adentro del cuerpo del ticket cuando el cliente
 *  pide una conexión. NO SE PUEDE BORRAR: es lo único que evita que el agente
 *  salga a conectar WhatsApp por su cuenta (el ticket nace bloqueado, pero el
 *  cuerpo es lo que lee cuando alguien lo desbloquea). Y no la puede leer el
 *  cliente: está escrita en imperativo y en segunda persona, así que la clienta
 *  de prueba la leyó como una orden PARA ELLA — "me quedé sin saber si podía
 *  tocar algo".
 *
 *  Se exporta para que la escriba un solo lado. Hoy la arman por su cuenta
 *  `conexiones/page.tsx` y el alta; el arreglo de fondo es que la ponga
 *  `crearPedidoDeConexion` adentro de un comentario HTML —el mismo mecanismo
 *  que ya usa `MARCA_PEDIDO`, que el sanitizador no muestra— y entonces todo
 *  este bloque se borra. Mientras tanto se reconoce por su primera frase, que
 *  es feo y está atado a un texto: por eso está acá y no repartido. */
export const INSTRUCCION_AL_AGENTE =
  "No hagas nada por tu cuenta con esto: avisale al equipo de tuagente " +
  "que hay que conectarlo y dejá el ticket esperando.";

/** Convención para lo nuevo: lo que va entre estas marcas es para el agente y
 *  el cliente no lo ve. Van como comentario HTML para que el agente —que lee el
 *  cuerpo crudo— las tenga igual. */
const BLOQUE_PARA_EL_AGENTE = /<!--\s*para-el-agente\s*-->[\s\S]*?<!--\s*\/para-el-agente\s*-->/gi;

// El párrafo entero, desde la frase que lo abre hasta el renglón en blanco.
const PARRAFO_INSTRUCCION = /(?:^|\n)[ \t]*No hagas nada por tu cuenta con esto:[\s\S]*?(?=\n[ \t]*\n|$)/gi;

function sinLoQueEsParaElAgente(md: string): string {
  if (!md.includes("<!--") && !md.includes("No hagas nada por tu cuenta")) return md;
  return md
    .replace(BLOQUE_PARA_EL_AGENTE, "")
    .replace(PARRAFO_INSTRUCCION, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function MarkdownImpl({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const source = useMemo(
    () => closeOpenFence(sinLoQueEsParaElAgente(children ?? "")), [children]);

  return (
    <div className="break-words text-[15px] text-ink [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1 [&_.katex-error]:font-mono [&_.katex-error]:text-[0.9em]">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={streaming ? STREAMING_COMPONENTS : STATIC_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownImpl);
