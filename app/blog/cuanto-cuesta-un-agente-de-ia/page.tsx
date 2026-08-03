import type { Metadata } from "next";
import { ArticleLayout, P, H2, B, Ul, Callout, PostLink } from "../ui";
import { POSTS } from "../posts";

const post = POSTS.find((p) => p.slug === "cuanto-cuesta-un-agente-de-ia")!;

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
        Es la primera pregunta de toda reunión y la que casi nadie responde en su página. Nosotros
        la publicamos con números — los del mercado y los nuestros — porque si el precio te
        espanta, mejor ahorrarte la reunión, y si te cierra, mejor llegar sabiéndolo.
      </P>

      <H2>Qué cobra el mercado en LATAM</H2>
      <Ul>
        <li>
          <B>Agencias de chatbots:</B> entre USD 1.500 y 3.000 de armado, más mensualidades de
          USD 100 a 500. Ojo: la mayoría vende{" "}
          <PostLink slug="agente-de-ia-vs-chatbot">chatbots con etiqueta de agente</PostLink> — leé
          bien qué te están dando por ese precio.
        </li>
        <li>
          <B>Consultoras enterprise:</B> proyectos de IA a medida desde USD 30.000 hacia arriba,
          pensados para corporaciones con departamento de IT. Excelente trabajo, otra liga, otro
          presupuesto.
        </li>
        <li>
          <B>Hacerlo vos con herramientas no-code:</B> barato en licencias, carísimo en tiempo
          tuyo — y el resultado suele ser frágil: nadie lo monitorea, nadie lo arregla cuando se
          rompe un martes a las 22.
        </li>
      </Ul>

      <H2>Qué cobramos nosotros</H2>
      <P>
        Nuestros planes están publicados en la <a href="/#planes" className="font-semibold text-primary underline decoration-2 underline-offset-2 hover:text-primary-dark">página principal</a>, pero el resumen:
      </P>
      <Ul>
        <li>
          <B>Starter — USD 990 de setup + desde USD 190/mes:</B> tu primer agente, un flujo
          automatizado, conectado a WhatsApp o mail. La forma de probar esto sin comprometerte.
        </li>
        <li>
          <B>Pro — USD 2.900 de setup + desde USD 490/mes:</B> el agente conectado a tus sistemas
          (CRM, ERP, base de datos), corriendo flujos autónomos 24/7, con chat directo para que lo
          dirijas vos.
        </li>
        <li>
          <B>Flota — a medida:</B> varios agentes trabajando en conjunto. Acá el precio depende de
          tu operación, por eso no inventamos un número.
        </li>
      </Ul>
      <P>
        Los precios son “desde” porque la variable real es <B>cuántas integraciones</B> hay que
        escribir: conectar un Google Sheets no cuesta lo mismo que conectar un ERP de 2009 que
        solo entiende el contador. En la demo te damos el número exacto para tu caso — gratis.
      </P>

      <H2>Qué estás pagando, exactamente</H2>
      <P>El precio de un agente serio se compone de tres cosas:</P>
      <Ul>
        <li>
          <B>La construcción (el setup):</B> escribir las herramientas que conectan el agente a tus
          sistemas, diseñar permisos y aprobaciones, y enseñarle tu proceso. Es trabajo de
          ingeniería de verdad — por eso el que te cobra USD 300 de setup te está vendiendo otra
          cosa.
        </li>
        <li>
          <B>El combustible (los tokens):</B> el agente le paga a los modelos de IA por cada
          “pensamiento”. Para un agente típico son decenas de dólares por mes, no cientos — está
          incluido en la mensualidad.
        </li>
        <li>
          <B>La operación:</B> monitoreo, ajustes y mejoras continuas. Un agente sin operación es
          como un empleado sin jefe: arranca bien y termina quién sabe dónde.
        </li>
      </Ul>

      <H2>La comparación que de verdad importa</H2>
      <Callout>
        Un administrativo en Uruguay cuesta entre USD 800 y 1.200 por mes, trabaja 8 horas, se
        toma licencia y — con todo derecho — renuncia. Un agente Pro cuesta desde USD 490 por mes,
        trabaja 24/7 y hace las tareas repetitivas sin quejarse. No reemplaza a tu equipo: le saca
        de encima el trabajo que nadie quiere hacer.
      </Callout>

      <H2>Cuándo NO te conviene (sí, en serio)</H2>
      <P>Un poco de anti-venta, porque la confianza vale más que una factura:</P>
      <Ul>
        <li>
          Si tu proceso <B>cambia todas las semanas</B> y no está definido ni en la cabeza de
          nadie — primero ordenalo, después automatizalo.
        </li>
        <li>
          Si el volumen es muy bajo (cinco facturas por mes se cobran a mano más barato que con
          cualquier software).
        </li>
        <li>
          Si esperás magia: un agente automatiza trabajo real con reglas reales. El que te promete
          “resultados garantizados sin definir nada” te está vendiendo humo — huí.
        </li>
      </Ul>
      <P>
        Si después de leer esto los números te cierran, el siguiente paso es una demo con tu caso
        concreto. Y si todavía no te queda claro qué es exactamente lo que estarías comprando,
        empezá por{" "}
        <PostLink slug="que-es-un-agente-de-ia">qué es un agente de IA</PostLink>.
      </P>
    </ArticleLayout>
  );
}
