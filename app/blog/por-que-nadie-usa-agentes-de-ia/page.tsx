import type { Metadata } from "next";
import { ArticleLayout, P, H2, B, Ul, Callout, PostLink } from "../ui";
import { POSTS } from "../posts";

const post = POSTS.find((p) => p.slug === "por-que-nadie-usa-agentes-de-ia")!;

export const metadata: Metadata = {
  title: `${post.title} | tuagente.uy`,
  description: post.description,
  alternates: { canonical: `/blog/${post.slug}` },
  openGraph: { title: post.title, description: post.description, url: `https://tuagente.uy/blog/${post.slug}`, type: "article" },
};

const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="font-semibold text-primary underline underline-offset-2 transition hover:text-primary-dark"
  >
    {children}
  </a>
);

export default function Page() {
  return (
    <ArticleLayout slug={post.slug}>
      <P>
        Esta semana WIRED publicó{" "}
        <Ext href="https://www.wired.com/story/why-normal-people-arent-using-ai-agents/">
          &ldquo;Why Normal People Aren&rsquo;t Using AI Agents&rdquo;
        </Ext>{" "}
        (hay{" "}
        <Ext href="https://archive.is/2026.08.07-050158/https://www.wired.com/story/why-normal-people-arent-using-ai-agents/">
          versión archivada
        </Ext>{" "}
        sin paywall), y el título dice todo: la industria tecnológica está convencida de que los
        agentes de IA son el futuro, pero la gente normal ni los tocó. Nos pareció tan buena la
        nota — y tan alineada con lo que pensamos — que vale la pena contarla y sacar las
        conclusiones que le sirven a una empresa de acá.
      </P>

      <H2>Los números que duelen</H2>
      <P>
        Según la nota, los agentes de las grandes empresas de IA juntan <B>unos 10 millones de
        usuarios semanales</B>. Suena a mucho hasta que lo ponés al lado de los chatbots como
        ChatGPT o Gemini: <B>alrededor de mil millones</B> de usuarios mensuales cada uno. Los
        agentes son, en palabras del artículo, &ldquo;un error de redondeo&rdquo;. Y eso que la
        tecnología funciona — el problema es otro.
      </P>

      <H2>El diagnóstico de Josh Miller</H2>
      <P>
        El protagonista de la nota es Josh Miller, fundador de The Browser Company (la empresa del
        navegador Arc, vendida por 610 millones de dólares). Su tesis, que incendió Twitter:
      </P>
      <Callout>
        &ldquo;Nadie quiere agentes de IA, porque los agentes de IA no son una cosa. Es un marco
        inventado por nuestra industria. [...] ¿A quién le importa si por abajo hay un
        &lsquo;agente&rsquo;? Nadie necesita saberlo.&rdquo;
      </Callout>
      <P>
        Su mejor ejemplo es de su propio producto: la funcionalidad más querida de su navegador no
        es &ldquo;un agente&rdquo; — es un <B>resumen de la mañana</B>. Abrís la laptop y te espera
        un saludo, tu lista del día armada desde el calendario y el mail, y algo lindo para
        arrancar. Técnicamente eso lo hace un agente de IA. El usuario no lo sabe, y no le importa.
        Le importa que su mañana empieza ordenada.
      </P>
      <P>
        Miller también señala el porqué: las empresas de IA están enviando <B>demos de lo que sus
        modelos pueden hacer</B> — navegar una web, escribir código — en vez de productos pensados
        desde lo que la gente necesita. Y acusa un pensamiento de manada: casi todos los
        laboratorios le describieron su visión citando la misma película de ciencia ficción.
      </P>

      <H2>La lectura equivocada (y la correcta)</H2>
      <P>
        La lectura fácil del artículo sería &ldquo;los agentes no sirven&rdquo;. No es eso. La
        tecnología está lista — lo que está roto es <B>cómo se la vende</B>: como una herramienta
        que vos tenés que aprender a operar. Y ahí está el punto que nosotros agregaríamos a la
        nota, porque Miller se queda a mitad de camino:
      </P>
      <Callout>
        La gente normal no va a <B>usar</B> agentes de IA. Los va a <B>contratar</B>.
      </Callout>
      <P>
        Pensalo con tu contador. Vos no &ldquo;usás&rdquo; a tu contador: le mandás las cosas por
        WhatsApp y esperás resultados. No sabés qué software usa, ni te importa. Lo que comprás es
        el trabajo hecho y alguien que responde por él. Con los agentes va a pasar lo mismo: el
        dueño de una empresa chica no va a abrir una consola de IA a escribir instrucciones — va a
        recibir el trabajo terminado por el canal donde ya vive.
      </P>

      <H2>Cómo se ve eso en la vida real</H2>
      <P>
        Un caso nuestro, de estos días. Una productora de contenidos de Punta del Este recibe
        entrevistas en video para un programa de TV. El proceso manual: descargar el video,
        transcribirlo, releer todo y elegir las frases que van al aire como zócalos. Horas, por
        cada entrevista.
      </P>
      <P>
        Hoy: le suben la entrevista a la carpeta de Drive de siempre — <B>nada cambió para el que
        sube</B> — y a los minutos la dueña recibe un aviso: la transcripción completa y las diez
        frases listas para la edición, en su portal. ¿Ella &ldquo;usa un agente&rdquo;? No. Recibe
        trabajo hecho. El agente, el motor, las conexiones — todo eso es problema nuestro, igual
        que el software del contador es problema del contador.
      </P>
      <P>
        Y el paralelismo con Miller es exacto hasta en el detalle: ¿su funcionalidad más querida es
        el resumen de la mañana? La nuestra también — el <B>resumen diario</B> que el agente manda
        por Telegram: qué llegó, qué quedó listo, qué espera tu ok. Nadie lo llama
        &ldquo;agente&rdquo;. Lo llaman &ldquo;el mensaje de la mañana&rdquo;.
      </P>

      <H2>Qué significa para vos, si tenés una empresa</H2>
      <Ul>
        <li>
          <B>No compres &ldquo;IA&rdquo; ni &ldquo;agentes&rdquo;.</B> Comprá una tarea resuelta.
          Si un vendedor te habla de la tecnología en vez de tu proceso, te está vendiendo el marco
          inventado del que habla WIRED.
        </li>
        <li>
          <B>Empezá por la tarea que te come horas todas las semanas.</B> Pasar pedidos de WhatsApp
          al sistema, perseguir deudores, transcribir, armar el reporte de siempre. Una sola, la
          que más duele. Esa es la pregunta con la que arranca cualquier conversación con nosotros.
        </li>
        <li>
          <B>Exigí resultados medibles, no conversaciones.</B> Al agente se lo mide como a un
          empleado: tareas terminadas, horas devueltas. Si en un mes no te ahorró tiempo real, no
          pagues — así estructuramos nuestros pilotos, y no por generosidad: es la única prueba que
          importa.
        </li>
        <li>
          <B>El que instala tiene que responder por el resultado.</B> La alternativa a
          &ldquo;usar&rdquo; un agente no es magia: es que alguien lo opere, lo supervise y dé la
          cara. Eso es un servicio con forma de producto, no un software que te tiran por mail.
        </li>
      </Ul>

      <P>
        Si querés entender qué es de verdad esta tecnología antes de hablar con nadie — nosotros
        incluidos — está explicado sin humo en{" "}
        <PostLink slug="que-es-un-agente-de-ia">qué es un agente de IA</PostLink> y en{" "}
        <PostLink slug="agente-de-ia-vs-chatbot">agente vs chatbot</PostLink>. Y si ya sabés cuál
        es la tarea que te come las horas, mejor: contánosla, que la demo se hace con tu caso.
      </P>
    </ArticleLayout>
  );
}
