import type { Metadata } from "next";
import { ArticleLayout, P, H2, B, Ul, Callout, PostLink } from "../ui";
import { POSTS } from "../posts";

const post = POSTS.find((p) => p.slug === "agente-de-ia-vs-chatbot")!;

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
        Hay decenas de agencias en LATAM vendiendo “agentes de IA” que, cuando mirás abajo del
        capó, son un chatbot con respuestas enlatadas. No es un detalle técnico: es la diferencia
        entre pagar por una conversación y pagar por trabajo hecho. Este artículo es para que no te
        vendan gato por liebre.
      </P>

      <H2>La diferencia en una frase</H2>
      <Callout>
        Un chatbot responde. Un agente trabaja. El chatbot termina la conversación y no pasó nada;
        el agente termina y hay una tarea hecha: un CRM actualizado, una factura conciliada, una
        reunión agendada.
      </Callout>

      <H2>Las tres diferencias que importan</H2>
      <P>
        <B>1. Iniciativa.</B> El chatbot espera a que alguien le escriba. Si nadie le habla, no
        existe. Un agente corre <B>solo, en un cronograma</B>: todas las mañanas revisa las
        facturas vencidas, cada hora mira los leads nuevos, cada noche concilia los pagos. Nadie lo
        empuja.
      </P>
      <P>
        <B>2. Acceso.</B> El chatbot vive en una ventanita de chat, desconectado de tu operación.
        Un agente está <B>enchufado a tus sistemas</B> — el CRM, la base de datos, el mail, la
        facturación — con permisos controlados. Puede leer lo que pasa y puede actuar sobre eso.
      </P>
      <P>
        <B>3. Resultado.</B> Al chatbot lo medís por “cuántas preguntas contestó”. Al agente lo
        medís como a un empleado: <B>cuántas tareas terminó</B>, cuánta plata cobró, cuántas horas
        de trabajo manual eliminó.
      </P>

      <H2>Por qué te venden chatbots como si fueran agentes</H2>
      <P>
        Porque armar un chatbot es fácil: hay herramientas para hacerlo en una tarde, sin saber
        programar. Armar un agente es ingeniería: hay que escribir las integraciones con tus
        sistemas, definir permisos, construir los frenos de seguridad y operarlo en producción.
        Como la palabra “agente” está de moda, muchos le cambiaron la etiqueta al chatbot y
        triplicaron el precio.
      </P>
      <P>Tres preguntas para desenmascarar la diferencia antes de firmar:</P>
      <Ul>
        <li>“¿Qué hace cuando nadie le escribe?” — si la respuesta es “nada”, es un chatbot.</li>
        <li>
          “¿Puede crear o modificar algo en mis sistemas?” — si solo “consulta información”, es un
          chatbot con disfraz.
        </li>
        <li>
          “¿Qué tareas deja terminadas por semana?” — si te hablan de conversaciones en vez de
          tareas, ya sabés.
        </li>
      </Ul>

      <H2>“¿Y no me alcanza con ChatGPT o Claude?”</H2>
      <P>
        Es la pregunta correcta, y la respuesta honesta es: <B>para vos como persona, quizás sí</B>.
        Para tu empresa, no. ChatGPT y Claude son herramientas espectaculares que necesitan un
        humano adelante: vos escribís, ellas responden, y el resultado queda en el chat. Nadie las
        conectó a tu facturación, nadie las puso a correr a las 3 de la mañana, y nadie les enseñó
        tu proceso.
      </P>
      <P>
        Un agente es lo que pasa cuando tomás ese mismo cerebro y le construís alrededor las{" "}
        <B>herramientas, los permisos y el cronograma</B> para que trabaje sin humano adelante.
        Cómo se construye ese “alrededor” — que es justamente nuestro trabajo — está contado en{" "}
        <PostLink slug="como-funciona-un-agente-de-ia">cómo funciona un agente por dentro</PostLink>.
      </P>

      <H2>¿Cuándo alcanza con un chatbot?</H2>
      <P>
        Seamos justos: si tu único problema es responder las mismas 20 preguntas por WhatsApp, un
        chatbot bien hecho te sirve y es más barato. El agente se justifica cuando lo que te come
        el día no son preguntas sino <B>procesos</B>: cobrar, cargar, conciliar, coordinar, hacer
        seguimiento. Ahí el chatbot no llega — y el agente recién empieza.
      </P>
    </ArticleLayout>
  );
}
