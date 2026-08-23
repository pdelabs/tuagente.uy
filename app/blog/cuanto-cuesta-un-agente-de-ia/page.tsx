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
        la publicamos con el número al frente: <B>$U 1.500 por rol, por mes</B>. Si te espanta,
        mejor ahorrarte la reunión; si te cierra, mejor llegar sabiéndolo.
      </P>
      <P>
        Un aviso antes de los números: hoy no vendemos “un agente” por proyecto. Vendemos{" "}
        <B>roles</B> — un empleado de IA por vez, con nombre y con una lista escrita de lo que hace
        y de lo que nunca va a hacer — y se pagan como se paga un sueldo.
      </P>

      <H2>Qué cobramos: $U 1.500 por rol, por mes</H2>
      <P>
        Un solo precio, en pesos uruguayos, el mismo para todos los roles. No hay planes, no hay
        escalones, no hay cargo por mensaje. Por cada rol que contratás:
      </P>
      <Ul>
        <li>
          <B>El rol trabajando 24/7</B>, instalado adentro de tu empresa, conectado a lo que ya
          usás y con los permisos que vos le des.
        </li>
        <li>
          <B>Su ficha en el portal:</B> qué hace, qué tiene corriendo y qué entregó. Lo mirás como
          mirás a cualquier empleado.
        </li>
        <li>
          <B>Tu aprobación</B> para todo lo que sale para afuera: nada le llega a un cliente tuyo
          sin tu ok.
        </li>
        <li><B>Soporte por WhatsApp, con nosotros.</B> No con un ticket.</li>
      </Ul>
      <P>
        Contratás los que necesites y ninguno más: uno son $U 1.500 por mes, y si mañana sumás un
        segundo son otros $U 1.500. Si uno no te sirve, lo das de baja y dejás de pagarlo —{" "}
        <B>sin permanencia y sin explicaciones</B>. Lo que recomendamos es arrancar con uno, el que
        más te duele hoy, y recién después decidir si querés el segundo.
      </P>

      <H2>Por qué se paga por rol y no por proyecto</H2>
      <P>
        Cotizar “un agente a medida” tiene un problema de fondo: te obliga a decidir todo el día
        cero, que es justo el día en que menos sabés. Pagás una cifra grande por adelantado
        apostando a que elegiste bien, y si a los dos meses el cuello de botella resulta ser otro,
        el proyecto ya está pago.
      </P>
      <Callout>
        Un rol es un sueldo que decidís mes a mes: lo contratás, lo ves trabajar y si no rinde lo
        das de baja. Con un proyecto pago por adelantado eso no lo podés hacer.
      </Callout>
      <P>
        Cobrar así nos pone el riesgo del lado nuestro, que es donde tiene que estar. Por eso
        preferimos que arranques con uno antes que venderte cinco: cinco roles que no mirás son
        cinco bajas el mes que viene.
      </P>

      <H2>El diagnóstico: USD 200, y se descuentan del setup</H2>
      <P>
        No hacemos demos gratis — una demo gratis es una presentación de ventas con tu logo puesto
        arriba. Hacemos un <B>diagnóstico</B>: una llamada y un informe escrito con qué roles te
        sirven, en qué orden conviene arrancar, dónde te ahorra plata cada uno y qué sale ponerlos
        a trabajar. Sale <B>USD 200, una sola vez</B>, y si seguís se descuentan del setup. El
        informe es tuyo aunque no sigas, incluso si la conclusión honesta es que todavía no te
        conviene.
      </P>
      <P>
        ¿Y el setup? Se cotiza ahí, con tu caso a la vista, porque la variable real es{" "}
        <B>cuántas integraciones hay que escribir</B>: conectar un Google Sheets no cuesta lo mismo
        que conectar un ERP de 2009 que solo entiende el contador. Antes de mirar eso, cualquier
        número es un número al aire — y los números al aire después se cobran igual.
      </P>

      <H2>Qué estás pagando, exactamente</H2>
      <Ul>
        <li>
          <B>La construcción (el setup, una sola vez):</B> las herramientas que conectan cada rol
          con tus sistemas, los permisos, las aprobaciones y tu proceso enseñado. Es ingeniería de
          verdad — por eso el que te cobra USD 300 de setup te está vendiendo otra cosa.
        </li>
        <li>
          <B>El combustible:</B> cada “pensamiento” del rol se le paga a un modelo de IA. Ya está
          adentro de los $U 1.500.
        </li>
        <li>
          <B>La operación:</B> monitoreo, ajustes y mejoras, todos los meses. Un rol sin operación
          es como un empleado sin jefe: arranca bien y termina quién sabe dónde.
        </li>
      </Ul>

      <H2>La comparación que de verdad importa</H2>
      <Ul>
        <li>
          <B>Contra un sueldo.</B> Un administrativo en Uruguay le cuesta a la empresa entre USD
          800 y 1.200 por mes, trabaja 8 horas, se toma licencia y —con todo derecho— un día
          renuncia. Un rol sale $U 1.500 y no para nunca. No lo reemplaza: le saca de encima el
          trabajo que nadie quiere hacer.
        </li>
        <li>
          <B>Contra una agencia.</B> El mercado cobra entre USD 1.500 y 3.000 de armado más USD 100
          a 500 por mes, y la mayoría instala un{" "}
          <PostLink slug="agente-de-ia-vs-chatbot">chatbot con etiqueta de agente</PostLink>.
          Fijate en la moneda, además: esa mensualidad está en dólares.
        </li>
        <li>
          <B>Contra un chatbot SaaS.</B> Entre USD 50 y 200 por mes por una ventanita que contesta
          preguntas, con el precio atado al volumen de conversaciones. Si tu problema son
          preguntas, te alcanza. Si son procesos — cobrar, cargar, conciliar, publicar —, no llega.
        </li>
      </Ul>
      <Callout>
        A nadie se lo contrata por lo que sale, sino por lo que te saca de encima. La pregunta útil
        no es si $U 1.500 es caro: es cuántas horas por semana te devuelve el rol y cuánto vale tu
        hora.
      </Callout>

      <H2>Cuándo NO te conviene (sí, en serio)</H2>
      <P>Un poco de anti-venta, porque la confianza vale más que una factura:</P>
      <Ul>
        <li>
          Si tu proceso <B>cambia todas las semanas</B> y no está definido ni en la cabeza de
          nadie — primero ordenalo, después automatizalo.
        </li>
        <li>
          Si el volumen es muy bajo: cinco facturas por mes se hacen a mano más barato que con
          cualquier software.
        </li>
        <li>
          Si querés <B>los cinco roles el primer mes</B>. Podés, pero nadie incorpora cinco
          empleados el mismo lunes y les explica el trabajo a todos.
        </li>
        <li>
          Si esperás magia: un rol hace trabajo real con reglas reales. El que promete “resultados
          garantizados sin definir nada” te está vendiendo humo — huí.
        </li>
      </Ul>
      <P>
        El precio está publicado, entero, en la{" "}
        <a href="/#planes" className="font-semibold text-primary underline decoration-2 underline-offset-2 hover:text-primary-dark">página principal</a>;
        lo único que no publicamos es el setup, y ya sabés por qué. Si los números te cierran, el
        siguiente paso es el diagnóstico con tu caso adentro. Y si todavía no te queda claro qué es
        exactamente lo que estarías contratando, empezá por{" "}
        <PostLink slug="que-es-un-agente-de-ia">qué es un agente de IA</PostLink>.
      </P>
    </ArticleLayout>
  );
}
