import type { Metadata } from "next";
import { BlogHeader, BlogFooter } from "../blog/ui";

export const metadata: Metadata = {
  title: "Política de privacidad | tuagente.uy",
  description:
    "Qué datos maneja el agente de tuagente.uy, dónde quedan, quién los ve y cómo pedir que se borren.",
  alternates: { canonical: "/privacidad" },
  robots: { index: true, follow: true },
};

// The page Meta asks for before an app can go Live, and the page a client can
// read before handing the agent a mailbox or an Instagram account. Plain
// rioplatense, no legal boilerplate: what we take, where it lives, who sees it,
// how it goes away. Written 2026-09-16.

const UPDATED = "16 de setiembre de 2026";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-2xl font-extrabold tracking-tight text-ink">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-base leading-relaxed text-ink-soft">{children}</p>;
}

export default function Privacidad() {
  return (
    <main className="overflow-x-hidden">
      <BlogHeader />
      <article className="mx-auto max-w-3xl px-5 pb-20 pt-10 sm:px-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Política de privacidad<span className="text-primary">.</span>
        </h1>
        <p className="mt-3 text-sm text-ink-soft">Última actualización: {UPDATED}.</p>

        <P>
          tuagente.uy instala un agente de inteligencia artificial adentro de una empresa. El
          agente trabaja con los datos que esa empresa le da y con lo que le llega por los canales
          que la empresa conecta. Esta página dice qué datos son, dónde quedan, quién los ve y cómo
          se borran. Está escrita para que la entienda quien contrata, no un abogado.
        </P>

        <H2>Quiénes somos</H2>
        <P>
          tuagente.uy es un producto de pdelabs, Montevideo, Uruguay. El contacto para todo lo que
          diga esta página es <a className="text-primary underline" href="mailto:info@tuagente.uy">info@tuagente.uy</a>.
        </P>

        <H2>Qué datos maneja el agente</H2>
        <P>
          Solo los que hacen falta para el trabajo que la empresa le pidió. Según los canales que
          conecte, pueden ser: mensajes y comentarios que llegan a la cuenta de Instagram de la
          empresa, mails que llegan a la casilla que la empresa conectó, los archivos y textos que
          la empresa le deja en su espacio de trabajo, y lo que la empresa le escribe por el chat
          del portal. Cuando el agente publica un posteo, lo hace en la cuenta de la empresa y solo
          después de que una persona lo aprobó.
        </P>
        <P>
          De las personas que le escriben a la empresa, el agente ve lo que esas personas
          mandaron: su nombre de usuario o dirección, el texto del mensaje y la fecha. No busca
          nada más sobre ellas.
        </P>

        <H2>Para qué los usa</H2>
        <P>
          Para hacer el trabajo: responder una consulta, dejar un borrador para que la empresa lo
          apruebe, armar un presupuesto, ordenar facturas, preparar un posteo. Nada de lo que sale
          hacia afuera (un mail, una respuesta, una publicación) sale sin que una persona de la
          empresa lo apruebe desde el portal. Los datos no se usan para publicidad, no se venden
          ni se comparten con terceros, y no se usan para entrenar modelos.
        </P>

        <H2>Dónde quedan</H2>
        <P>
          Cada empresa tiene su propio agente, aislado, con su propia clave y su propio espacio.
          Lo que el agente lee y produce queda en ese espacio, en los servidores que operamos para
          esa empresa. Para generar las respuestas usamos proveedores de modelos de lenguaje; les
          mandamos el texto necesario para cada pedido y ellos no lo guardan para entrenar. No hay
          una base de datos compartida entre empresas.
        </P>

        <H2>Instagram y Meta</H2>
        <P>
          Si la empresa conecta su cuenta profesional de Instagram, el agente usa la API oficial
          de Meta con el permiso que la empresa le da al conectar. Con eso puede leer los
          comentarios y los mensajes que llegan a esa cuenta, contestarlos cuando la empresa
          aprueba la respuesta, y publicar los posteos que la empresa aprobó. La empresa puede
          quitar ese permiso en cualquier momento desde la configuración de su cuenta de
          Instagram, y el agente deja de ver la cuenta al instante.
        </P>

        <H2>Cuánto tiempo</H2>
        <P>
          Mientras la empresa tenga el agente. Cuando lo da de baja, su espacio de trabajo y sus
          registros se borran dentro de los 30 días. Los mensajes de terceros que el agente leyó
          se borran junto con eso.
        </P>

        <H2>Cómo pedir que se borren tus datos</H2>
        <P>
          Si le escribiste a una empresa que usa tuagente.uy y querés que lo que mandaste se
          borre del agente, escribinos a <a className="text-primary underline" href="mailto:info@tuagente.uy">info@tuagente.uy</a>{" "}
          diciendo a qué empresa le escribiste y desde qué cuenta o dirección. Lo borramos y te
          confirmamos por el mismo medio, dentro de los 10 días hábiles. Si sos la empresa,
          podés pedir la baja completa del agente por el mismo mail.
        </P>

        <H2>Cambios</H2>
        <P>
          Si esta página cambia, cambia la fecha de arriba y avisamos a las empresas que tienen un
          agente. Lo que no va a cambiar: nada sale sin aprobación, nada se vende, y cada empresa
          tiene lo suyo aparte.
        </P>
      </article>
      <BlogFooter />
    </main>
  );
}
