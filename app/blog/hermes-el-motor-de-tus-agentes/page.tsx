import type { Metadata } from "next";
import { ArticleLayout, P, H2, B, Ul, Callout, PostLink } from "../ui";
import { POSTS } from "../posts";

const post = POSTS.find((p) => p.slug === "hermes-el-motor-de-tus-agentes")!;

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
        Cuando un proveedor de tecnología te dice “desarrollamos todo nosotros”, hay dos opciones:
        o tiene un equipo de cien ingenieros, o te está mintiendo. Nosotros preferimos contarte la
        verdad, porque además juega a tu favor: tus agentes corren sobre <B>Hermes</B>, un motor de
        agentes <B>open-source creado por Nous Research</B> — no por nosotros — y elegido por
        nosotros a conciencia.
      </P>

      <H2>Qué es exactamente Hermes</H2>
      <P>
        Hermes es un <B>runtime de agentes</B>: el software de base que resuelve todo lo que
        cualquier agente necesita para existir, antes de que importe qué hace tu empresa. El{" "}
        <PostLink slug="como-funciona-un-agente-de-ia">loop de mirar-pensar-actuar</PostLink>, el
        enrutado de herramientas, la memoria persistente, los cronogramas, el manejo de errores.
        Es código abierto (licencia MIT), publicado por{" "}
        <a
          href="https://github.com/NousResearch/hermes-agent"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary underline decoration-2 underline-offset-2 hover:text-primary-dark"
        >
          Nous Research
        </a>
        , uno de los laboratorios de IA abiertos más respetados del mundo.
      </P>

      <H2>La analogía del motor</H2>
      <Callout>
        Ningún buen fabricante de autos fabrica su propio acero. Elegís el mejor motor disponible y
        construís el auto alrededor — a medida de quien lo va a manejar. Hermes es el motor; el
        auto, diseñado para tu empresa, lo construimos nosotros.
      </Callout>
      <P>
        La alternativa — que cada agencia programe su propio mini-motor de agentes desde cero — es
        exactamente lo que deberías temer: software joven, sin comunidad, sin auditoría, mantenido
        por tres personas. El “desarrollamos todo nosotros” suena lindo hasta que entendés lo que
        implica.
      </P>

      <H2>Por qué esto te conviene a vos (no solo a nosotros)</H2>
      <Ul>
        <li>
          <B>Sin lock-in:</B> la base es código abierto. Si mañana no querés trabajar más con
          nosotros, tu agente no corre sobre una caja negra propietaria de la que no podés salir.
        </li>
        <li>
          <B>Probado en el mundo real:</B> Hermes lo usa y lo revisa una comunidad global de
          ingenieros. Los errores se encuentran y corrigen rápido — no cuando le pasa a tu empresa.
        </li>
        <li>
          <B>Auditable:</B> cualquier ingeniero puede leer el código y verificar qué hace. En una
          época de humo, poder mirar adentro vale oro.
        </li>
        <li>
          <B>Evoluciona solo:</B> cada mejora del proyecto la heredan tus agentes. Es como si tu
          motor se actualizara gratis todos los meses.
        </li>
      </Ul>

      <H2>Entonces, ¿qué hacen ustedes?</H2>
      <P>
        Todo lo que Hermes no puede saber: <B>tu empresa</B>. El motor es genérico a propósito —
        no conoce tu CRM, tu proceso de cobranzas, tus clientes, tus reglas. Nuestro trabajo es:
      </P>
      <Ul>
        <li>Escribir las <B>herramientas a medida</B> que conectan el agente con tus sistemas reales.</li>
        <li>Diseñar los <B>permisos y aprobaciones</B>: qué hace solo, qué te consulta, qué no puede tocar.</li>
        <li>Enseñarle <B>tu proceso</B> — las instrucciones, los matices, las excepciones.</li>
        <li><B>Operarlo</B>: monitorear, ajustar y mejorar el agente todos los meses, en producción.</li>
      </Ul>
      <P>
        En números gruesos: el motor es el 20% del problema, ya resuelto y de primer nivel. El 80%
        restante — que funcione en <B>tu</B> operación, con <B>tus</B> datos, sin romper nada — es
        artesanía de ingeniería, y ahí es donde cobramos nuestro sueldo. Cuánto cuesta exactamente,
        con números, en{" "}
        <PostLink slug="cuanto-cuesta-un-agente-de-ia">cuánto cuesta un agente de IA</PostLink>.
      </P>
    </ArticleLayout>
  );
}
