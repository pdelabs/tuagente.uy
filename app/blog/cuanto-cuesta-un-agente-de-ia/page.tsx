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
        Es la primera pregunta de toda reunión y la que casi nadie responde en su página. Vamos a
        contestarla en serio: hay <B>un número publicado</B>, el mensual, y hay cosas que no se
        pueden cotizar antes de mirar tu caso — te vamos a decir exactamente por qué.
      </P>
      <P>
        Un aviso antes de los números: no vendemos “packs” ni horas de consultoría. Vendemos{" "}
        <B>un agente por empresa</B> — uno solo, con el nombre y la cara que le ponés vos — y{" "}
        <B>plugins</B>: cada trabajo concreto que querés sacarte de encima, escrito adentro de ese
        agente con tu proceso adentro.
      </P>

      <H2>Lo que se paga</H2>
      <Ul>
        <li>
          <B>El mensual: USD 90 por mes, sin costo de alta.</B> Trae tu agente con su portal y los
          mensajes de WhatsApp e Instagram: contesta solo, con tus reglas, y lo que no sabe o no le
          toca —un precio que no publicaste, un reclamo— te lo deja a vos con una nota. Los
          modelos, el hosting, los ajustes y el soporte van adentro. Sin permanencia.
        </li>
        <li>
          <B>Cada trabajo que le sumes:</B> posteos, facturas a la planilla, presupuestos y
          seguimiento, transcribir reuniones. Cada uno se agrega al mensual, y qué sale te lo
          cotizamos gratis.
        </li>
        <li>
          <B>Lo que hay que escribir a medida:</B> si tu empresa necesita algo que no existe, se
          cotiza y se paga una vez. La mitad de lo que pagás por ese armado te vuelve como
          descuento en el mensual, en los primeros meses.
        </li>
      </Ul>

      <H2>La cotización es gratis</H2>
      <P>
        No te cobramos por mirar tu caso. Nos contás el trabajo que te come las horas —por
        WhatsApp, o con el teardown gratis de la página principal— y te decimos qué conviene
        sacarte de encima primero, si ya lo tenemos escrito o hay que escribirlo, y cuánto queda
        el mensual. Si la conclusión honesta es que todavía no te conviene, también te lo decimos.
      </P>
      <P>
        Y el riesgo del primer mes lo corremos nosotros: <B>si el primer mes no hizo lo que te
        dijimos, ese mes no lo pagás.</B>
      </P>

      <H2>Los trabajos: por qué se cotizan y no se publican</H2>
      <P>
        La variable real de un trabajo no es “cuánta IA lleva”: es <B>cuánto hay que escribir y
        cuánto hay que conectar</B>. Pasar las facturas a una planilla de Google que ya existe no
        cuesta lo mismo que hacerlo contra un sistema de gestión de 2009 que solo entiende el
        contador y que no tiene API.
      </P>
      <Callout>
        Cualquiera te puede tirar un número antes de mirar tu proceso. Después ese número se cobra
        igual — y la diferencia la pagás vos en un plugin que hace la mitad de lo que necesitabas.
      </Callout>
      <P>
        Por eso lo que cotizamos es esto, con tu caso adelante: qué mira el plugin, qué decide
        solo, qué te pregunta antes de actuar, qué <B>nunca</B> hace, y contra qué sistemas tuyos
        tiene que hablar. Recién ahí hay un precio, y ese precio no se mueve después. Si hay que
        escribir algo a medida, lo pagás una vez, y la mitad de lo que pagás por el armado te
        vuelve en el mensual.
      </P>

      <H2>El mensual: qué estás pagando de verdad</H2>
      <P>
        Son USD 90 por mes. Y acá va el número que nadie publica, así que lo publicamos nosotros.
        Un agente andando con
        uso real de una empresa chica —contestando, leyendo, resumiendo, armando planillas todos
        los días— <B>consume entre US$ 4 y US$ 10 por mes de modelos</B>. Está medido en los
        agentes que tenemos corriendo, no estimado.
      </P>
      <P>
        Es poco, y es a propósito que te lo digamos: si alguien te cobra “por consumo de IA” una
        cifra diez veces mayor sin mostrarte el detalle, ya sabés qué te está vendiendo. Lo que
        cuesta plata de verdad en el mensual no es el modelo — es todo lo demás:
      </P>
      <Ul>
        <li>
          <B>Los mensajes:</B> el WhatsApp y el Instagram contestados solos, sin cargo por
          mensaje.
        </li>
        <li>
          <B>El hosting:</B> la máquina donde vive tu agente, prendida siempre, aislada de la de
          cualquier otro cliente y con su propia clave.
        </li>
        <li>
          <B>Los ajustes:</B> el mes dos siempre trae “che, cuando pregunten por esto contestá
          así”. Eso lo hacemos nosotros y está adentro.
        </li>
        <li>
          <B>La operación:</B> mirar que siga andando, que no se rompa cuando cambia algo de tu
          lado, y arreglarlo antes de que te enteres. Un agente sin operación es como un empleado
          sin jefe: arranca bien y termina quién sabe dónde.
        </li>
        <li>
          <B>El soporte:</B> por WhatsApp, con nosotros. No con un ticket.
        </li>
      </Ul>

      <H2>La comparación que de verdad importa</H2>
      <Ul>
        <li>
          <B>Contra un sueldo.</B> Un administrativo en Uruguay le cuesta a la empresa entre USD
          800 y 1.200 por mes, trabaja 8 horas, se toma licencia y —con todo derecho— un día
          renuncia. Un agente no lo reemplaza: le saca de encima el trabajo que nadie quiere
          hacer, y lo hace a las once de la noche de un domingo, que es cuando se pierden los
          turnos que nunca supiste que tenías.
        </li>
        <li>
          <B>Contra una agencia.</B> El mercado cobra entre USD 1.500 y 3.000 de armado más USD
          100 a 500 por mes, y la mayoría instala un{" "}
          <PostLink slug="agente-de-ia-vs-chatbot">chatbot con etiqueta de agente</PostLink>. La
          pregunta que los separa es una sola: ¿qué hace sin que nadie le escriba?
        </li>
        <li>
          <B>Contra un chatbot SaaS.</B> Entre USD 50 y 200 por mes por una ventanita que contesta
          preguntas, con el precio atado al volumen de conversaciones. Si tu problema son
          preguntas, te alcanza. Si son procesos — cobrar, cargar, conciliar, publicar —, no llega.
        </li>
      </Ul>
      <Callout>
        A nadie se lo contrata por lo que sale, sino por lo que te saca de encima. La pregunta útil
        no es si es caro: es cuántas horas por semana te devuelve y cuánto vale tu hora.
      </Callout>

      <H2>Empezás con poco</H2>
      <P>
        El agente contestando tu WhatsApp y tu Instagram y, si hace falta, un trabajo más: el que
        más te duele hoy. Lo ves andar un mes, medís si te devolvió horas de verdad, y recién ahí
        le sumás el que sigue. No hay que decidir todo el día cero, que es justo el día en que
        menos sabés qué necesitás.
      </P>
      <P>
        Si el primer mes no hizo lo que te dijimos, ese mes no lo pagás. Y después, si un mes no
        te devolvió nada, dejás de pagar el mensual. Sin permanencia y sin explicaciones — es la
        única prueba que importa, y nos pone el riesgo del lado nuestro, que es donde tiene que
        estar.
      </P>

      <H2>Cuándo NO te conviene (sí, en serio)</H2>
      <P>Un poco de anti-venta, porque la confianza vale más que una factura:</P>
      <Ul>
        <li>
          Si tu proceso <B>cambia todas las semanas</B> y no está definido ni en la cabeza de
          nadie — primero ordenalo, después automatizalo. Un plugin escribe un proceso; no puede
          escribir uno que no existe.
        </li>
        <li>
          Si el volumen es muy bajo: cinco facturas por mes se hacen a mano más barato que con
          cualquier software.
        </li>
        <li>
          Si querés <B>todos los plugins el primer mes</B>. Podés, pero es la forma más cara de
          descubrir que dos de ellos no eran el problema.
        </li>
        <li>
          Si esperás magia: un agente hace trabajo real con reglas reales. El que promete
          “resultados garantizados sin definir nada” te está vendiendo humo — huí.
        </li>
      </Ul>
      <P>
        El mensual está publicado con número en la{" "}
        <a href="/#planes" className="font-semibold text-primary underline decoration-2 underline-offset-2 hover:text-primary-dark">página principal</a>;
        lo que no publicamos es el precio de cada trabajo, y ya sabés por qué. Si los números te
        cierran, el siguiente paso es contarnos tu caso: la cotización es gratis. Y si todavía no te queda
        claro qué es exactamente lo que estarías contratando, empezá por{" "}
        <PostLink slug="que-es-un-agente-de-ia">qué es un agente de IA</PostLink>.
      </P>
    </ArticleLayout>
  );
}
