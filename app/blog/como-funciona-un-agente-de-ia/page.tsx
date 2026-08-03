import type { Metadata } from "next";
import { ArticleLayout, P, H2, B, Ul, Callout, PostLink } from "../ui";
import { POSTS } from "../posts";

const post = POSTS.find((p) => p.slug === "como-funciona-un-agente-de-ia")!;

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
        Cuando decimos que un agente “trabaja solo”, la reacción sana es desconfiar: ¿cómo
        exactamente? ¿Qué hace a las 3 de la mañana con acceso a mis sistemas? Este artículo abre
        el capó, sin una línea de código, con un ejemplo real: un agente de cobranzas.
      </P>

      <H2>El loop: mirar, pensar, actuar, verificar</H2>
      <P>
        En el corazón de todo agente hay un ciclo que se repite — en la industria le dicen{" "}
        <B>el loop</B>. Cuatro pasos:
      </P>
      <Ul>
        <li><B>Mirar:</B> lee el estado de tus sistemas. ¿Qué facturas están vencidas? ¿Llegó algún pago nuevo?</li>
        <li><B>Pensar:</B> el modelo de IA decide qué corresponde hacer según las instrucciones que le dimos, con el contexto de tu negocio.</li>
        <li><B>Actuar:</B> ejecuta — manda el recordatorio, registra la gestión, actualiza la planilla.</li>
        <li><B>Verificar:</B> revisa que la acción salió bien, y decide si sigue, si reintenta o si escala a un humano.</li>
      </Ul>
      <P>
        Y vuelta a empezar, cada vez que toca según su cronograma. La diferencia con la
        automatización clásica (esas cadenas de “si pasa X, hacé Y”) es el paso dos: hay un
        cerebro que <B>entiende matices</B>. Si el cliente respondió “te pago la semana que viene,
        estoy complicado”, un sistema clásico manda igual el recordatorio número tres; un agente
        entiende, anota el compromiso y espera.
      </P>

      <H2>Ejemplo real: la mañana de un agente de cobranzas</H2>
      <P>Así se ve una corrida concreta, paso a paso:</P>
      <Ul>
        <li>07:00 — Se despierta según su cronograma. Consulta la facturación: hay 14 facturas vencidas.</li>
        <li>07:01 — Cruza cada una con el historial: 9 son clientes que siempre pagan con atraso corto; les redacta un recordatorio cordial, adaptado a cada caso, y lo manda.</li>
        <li>07:04 — Dos ya tienen compromiso de pago anotado de la semana pasada. No molesta: agenda re-chequeo para el lunes.</li>
        <li>07:05 — Tres son montos grandes con 45+ días. Acá no actúa solo: arma un resumen de cada caso y te lo manda con la pregunta “¿escalo a jurídico o llamás vos?”.</li>
        <li>07:06 — Registra todo lo que hizo, factura por factura, y te deja el resumen en WhatsApp para cuando te levantes.</li>
      </Ul>
      <Callout>
        Fijate el detalle del paso de los montos grandes: el agente sabe qué decisiones son suyas y
        cuáles son tuyas. Eso no es un accidente — es la parte más importante del diseño.
      </Callout>

      <H2>Las herramientas: las manos del agente</H2>
      <P>
        El modelo de IA, solo, no puede tocar nada — nace sabiendo hablar, no sabiendo usar tu
        facturación. Cada cosa que el agente puede hacer existe porque alguien escribió una{" "}
        <B>herramienta</B>: un puente de software entre el cerebro y un sistema tuyo.
        “Consultar facturas vencidas” es una herramienta. “Mandar WhatsApp” es otra. “Registrar
        gestión de cobranza”, otra.
      </P>
      <P>
        Acá está el 80% del trabajo serio de armar un agente — y la diferencia entre un proveedor
        de verdad y uno de humo. Las herramientas definen <B>exactamente</B> qué puede y qué no
        puede hacer el agente: si no le escribimos la herramienta de borrar, no puede borrar, ni
        aunque el modelo tenga un mal día. Es seguridad por diseño, no por promesa.
      </P>

      <H2>Los frenos: por qué no da miedo</H2>
      <Ul>
        <li><B>Permisos acotados:</B> el agente solo ve y toca los sistemas que le habilitaste.</li>
        <li><B>Aprobación humana:</B> las acciones sensibles (pagos, mails delicados, borrados) se frenan y te piden el OK.</li>
        <li><B>Registro total:</B> cada acción queda anotada — qué hizo, cuándo y por qué. Cero cajas negras.</li>
        <li><B>Botón de pausa:</B> lo frenás cuando quieras, al instante.</li>
      </Ul>

      <H2>La memoria: conoce tu negocio</H2>
      <P>
        Un agente bien armado recuerda: que tal cliente pidió que no lo llamen por teléfono, que
        los martes no se factura, que ese proveedor manda los PDFs con otro formato. Esa memoria se
        construye con el tiempo y es lo que hace que el agente número seis meses sea mejor que el
        del primer día.
      </P>
      <P>
        Todo esto — el loop, el enrutado de herramientas, la memoria, los cronogramas — corre
        sobre una base de software que no inventamos nosotros, y eso es una buena noticia: usamos{" "}
        <PostLink slug="hermes-el-motor-de-tus-agentes">Hermes, un motor open-source</PostLink>{" "}
        probado, y nuestro trabajo se concentra en lo que es único de tu empresa: tus herramientas,
        tus permisos, tu proceso.
      </P>
    </ArticleLayout>
  );
}
