import type { Metadata } from "next";
import { ArticleLayout, P, H2, B, Ul, Callout, PostLink } from "../ui";
import { POSTS } from "../posts";

const post = POSTS.find((p) => p.slug === "que-es-un-agente-de-ia")!;

export const metadata: Metadata = {
  title: `${post.title} | tuagente.uy`,
  description: post.description,
  alternates: { canonical: `/blog/${post.slug}` },
  openGraph: { title: post.title, description: post.description, url: `https://tuagente.uy/blog/${post.slug}`, type: "article" },
};

export default function Page() {
  return (
    <ArticleLayout slug={post.slug}>
      <P>
        Escuchaste “agentes de IA” en un almuerzo, en LinkedIn, en una charla — y todo el mundo lo
        dice como si fuera obvio. No lo es. La mayoría de las explicaciones son para programadores,
        o son puro marketing. Esta es para vos, que manejás una empresa y querés saber si esto es
        real o es la moda del mes.
      </P>

      <H2>Empecemos por lo que ya conocés</H2>
      <P>
        Seguro probaste ChatGPT o Claude: le escribís una pregunta, te responde. Impresionante,
        pero pasivo. Es un <B>cerebro en un frasco</B>: sabe muchísimo, redacta bárbaro, pero no
        puede <B>hacer</B> nada. No puede mirar tus ventas de ayer, no puede mandar un mail, no
        puede cargar una factura. Solo habla.
      </P>
      <P>
        Un agente de IA es ese mismo cerebro, pero <B>con manos y con agenda</B>. Es software que
        usa un modelo de IA para ejecutar trabajo de verdad: se conecta a tus sistemas, mira lo que
        está pasando, decide qué corresponde hacer y lo hace. Solo, sin que nadie le escriba nada.
      </P>

      <Callout>
        La forma más corta de entenderlo: ChatGPT es un asistente al que le tenés que hablar. Un
        agente es un empleado que trabaja aunque vos no estés.
      </Callout>

      <H2>La analogía del empleado nuevo</H2>
      <P>
        Pensá en cómo incorporás a una persona nueva al equipo. Le das accesos (el mail, el
        sistema de facturación, el CRM), le explicás el proceso (“cuando llega un pedido, hacés
        esto; si pasa tal cosa, me avisás”), y al principio le revisás el trabajo hasta que le
        agarrás confianza.
      </P>
      <P>
        Configurar un agente es exactamente eso. Se le dan <B>accesos acotados</B> a tus sistemas,
        se le escriben las <B>instrucciones</B> de tu proceso, y se definen los casos en los que
        tiene que <B>pedir permiso</B> antes de actuar. La diferencia: trabaja las 24 horas, no se
        enferma, no renuncia, y hace la tarea número diez mil con el mismo cuidado que la primera.
      </P>

      <H2>¿Qué puede hacer, concretamente?</H2>
      <P>Cosas que hoy hace una persona con una computadora y mucha paciencia:</P>
      <Ul>
        <li>
          <B>Ventas:</B> responder consultas que llegan por WhatsApp, calificar cuáles valen la
          pena, agendar reuniones y dejar el CRM al día.
        </li>
        <li>
          <B>Cobranzas:</B> detectar facturas vencidas, mandar recordatorios con buen tono,
          conciliar los pagos que van llegando.
        </li>
        <li>
          <B>Back-office:</B> leer PDFs, facturas y mails, extraer los datos y cargarlos en tus
          sistemas sin tipeo manual.
        </li>
        <li>
          <B>Operaciones:</B> controlar stock, generar órdenes de compra, avisar antes de que algo
          se rompa.
        </li>
      </Ul>
      <P>
        Si querés ver el mecanismo por dentro — cómo “piensa”, cómo se conecta, qué frenos tiene —
        lo contamos paso a paso en{" "}
        <PostLink slug="como-funciona-un-agente-de-ia">cómo funciona un agente de IA</PostLink>.
      </P>

      <H2>Lo que un agente NO es</H2>
      <P>
        Acá es donde nos diferenciamos del humo. Un agente <B>no es magia</B> y no reemplaza tu
        criterio. No va a definir tu estrategia comercial ni decidir a quién contratar. Y no
        funciona bien si el proceso que le das está roto: la IA automatiza lo que existe — si lo
        que existe es un lío, automatizás un lío.
      </P>
      <P>
        Tampoco es un chatbot con otro nombre. Esa confusión es tan común (y tan conveniente para
        algunos vendedores) que le dedicamos un artículo entero:{" "}
        <PostLink slug="agente-de-ia-vs-chatbot">agente de IA vs chatbot</PostLink>.
      </P>

      <H2>¿Y por qué ahora?</H2>
      <P>
        Porque los modelos de IA cruzaron un umbral hace poco: ya no solo redactan bien — pueden
        seguir procesos largos, usar herramientas y recuperarse de errores. Eso convirtió “la IA
        que chatea” en “la IA que trabaja”. Las empresas grandes ya lo están aprovechando con
        equipos internos. La novedad es que hoy una empresa mediana de LATAM puede tener lo mismo,{" "}
        <B>sin equipo técnico propio</B> — que es exactamente lo que hacemos nosotros.
      </P>
    </ArticleLayout>
  );
}
