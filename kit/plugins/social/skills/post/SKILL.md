---
title: Posteos para Instagram
client_summary: "Escribe el posteo del día con tu voz, le hace el carrusel con tus colores y te lo deja listo para revisar."
name: post
description: "Escribe un posteo de Instagram con la voz de la marca y le genera el carrusel: lee el negocio y marca/brand.md, arma el pie con la formula (gancho, una idea, un solo pedido, hasta 5 hashtags), genera de 3 a 6 láminas con generate_image, MIRA cada una contra una lista de cinco puntos y las guarda con save_post. Usala cada vez que haya que dejar un posteo, un pie de foto o contenido para Instagram."
version: 1.0.0
license: MIT
---

# post — el posteo del día

## 1. Leé el negocio y la marca antes de escribir nada

**Qué es el negocio** —cómo se llama, qué vende, dónde está, cuándo abre, cómo
se le pide, cómo habla— está al final de tus instrucciones, en «El negocio», y
en lo que el cliente le contó a tu memoria. **Cómo se ven sus posteos** —los
looks, los colores, la tipografía, qué puede afirmar y qué nunca— está en
`marca/brand.md`, si existe: `read_file("marca/brand.md")`. Un posteo escrito
sin las dos cosas suena igual al de cualquier otra empresa, que es exactamente
lo que el cliente no quiere pagar.

**Si no hay archivo de marca, el look sale del negocio.** Escribí vos UN bloque
de look, de dos o tres oraciones: el lugar y las cosas reales de ese negocio
(su mostrador, su producto, su vidriera), la luz, dos o tres colores y una
tipografía. Ese bloque va palabra por palabra al principio del brief de todas
las láminas, igual que un bloque de la marca. Y en el informe decí en una línea
que los colores los elegiste vos porque todavía no hay una marca escrita.

## 2. Elegí una idea que no repita la de ayer

**La idea sale de quien lee, no del negocio.** Un momento, un problema o una
duda de la persona que va a ver el posteo —el sábado que no llegás a contestar,
el regalo que no sabés qué elegir, la caldera que hace ruido—, y el negocio
entra como la respuesta. Un posteo cuyo tema es el negocio mismo («somos»,
«tenemos», «nuestro servicio») es la excepción, no la semana.

`list_files("posteos")` te muestra lo que ya salió. Mirá los últimos cinco y
elegí otra cosa: otro trabajo, otra punta del mismo tema, otro pilar de los que
liste la marca. Dos posteos parecidos seguidos se leen como un agente que no
tiene nada nuevo para decir.

Si tenés `recent_performance()`, llamala acá: te dice cómo le fue a cada uno de
los últimos posteos. **Lo que la gente guarda es lo que hay que hacer más** —
guardar es el que dice «esto me sirve»—, así que elegí del lado de lo que
funcionó y no del lado de lo que te gustó.

## 3. Armá la historia. Todavía no escribas nada lindo

**Un carrusel es una historia que se pasa con el dedo, no cinco frases sueltas
sobre un tema.** Quien lo ve decide en cada lámina si pasa a la siguiente, y pasa
sólo si la que está mirando le dejó una pregunta abierta. Cinco frases que
podrían ir en cualquier orden son cinco afiches, y nadie pasa de un afiche.

**a. Qué querés que haga quien lo lee.** Una sola cosa: que lo **guarde**
(le sirve para después), que **se lo mande a alguien** (habla de otro) o que
**te escriba** (se reconoció). De eso sale el cierre, y no se decide al final.

**b. Elegí la estructura según lo que la idea ES**, no según cuál te gusta:

| Estructura | Cuándo | El trabajo de cada lámina |
|---|---|---|
| `historia` | Pasó, o pasa todas las semanas: una persona, una hora, una cosa | 1 la escena con la pregunta abierta · 2 lo que salió mal · 3 cuánto costó · 4 el giro · 5 cómo es ahora · cierre |
| `antes-despues` | El mismo momento, de dos maneras | 1 la promesa · 2 el antes, concreto · 3 lo que cambió · 4 el después, el mismo momento · cierre |
| `mito` | Algo que casi todos creen y no es así | 1 el mito, dicho como lo dicen · 2 por qué suena cierto · 3 dónde se rompe · 4 lo que sí es · cierre |
| `pasos` | Cómo se hace UNA cosa | 1 qué vas a poder hacer · un paso por lámina, en orden · la anteúltima los junta · cierre |
| `lista` | Varias cosas del mismo tipo | 1 cuántas y de qué · la más fuerte en la 2, no al final · la anteúltima las junta · cierre |
| `numero` | Un dato que sorprende | 1 el número solo · 2 de dónde sale · 3 qué significa para quien lee · cierre |

Cuál usaron los últimos carruseles está al final de tus instrucciones, en «La
estructura de hoy»: la de ayer descansa.

El número de láminas sale de lo que hay para decir, de 3 a 6: **nunca rellenes**.
Si la tapa promete tres cosas, adentro hay tres, ni dos ni cuatro.

**c. Escribí el guion: un renglón por lámina, con su trabajo y su oración.**

- **La 1 pasa la prueba del desconocido.** Alguien que nunca oyó hablar de
  este negocio la ve sola, en el feed, y entiende de qué se trata y si es para
  él. **Claro gana a ingenioso, siempre**: una frase linda que no se entiende
  sin la lámina 2 es una lámina que nadie pasa. Nombra la situación de quien
  lee, con cosas concretas, y ninguna palabra que sólo use el negocio —el
  nombre de un servicio, una sigla, un término de adentro— que no se explique
  ahí mismo.
- **La 1 promete y deja una pregunta.** Se entiende sola y no se cierra sola:
  «A las 23:40 te preguntaron el precio.» deja la pregunta «¿y qué pasó?»;
  «Contestar rápido es importante» no deja ninguna. Formas que funcionan:
  - **una pregunta que quien lee contesta «sí» sin pensar, sobre su
    problema**: «¿Te escriben por WhatsApp cuando ya cerraste?», «¿Se te
    quema el pan cuando hay cola?». Es la que más para el dedo. Nunca una
    pregunta sobre el producto que se contesta «no sé» («¿Conocés nuestro
    servicio?»);
  - **la oferta directa, con el resultado adentro**, uno de cada tres o cuatro
    posteos: «Pan de masa madre recién horneado, todos los días a las 7.» El
    producto nombrado siempre pegado a lo que le resuelve a quien lee, nunca
    solo;
  - una escena con hora y lugar: «Sábado, 11:00, la vidriera llena y el
    teléfono sonando.»;
  - a quién le habla: «Si vendés por WhatsApp, esto es para vos.»;
  - cuántas cosas y de qué: «3 errores al elegir zapatillas para correr.»;
  - cómo lograr algo sin el dolor: «Cómo tener el pan caliente sin
    madrugar.»;
  - un error común: «Dejá de guardar el pan en la heladera.»
- **Cada lámina contesta la pregunta que dejó la anterior y abre la que sigue.**
  Por eso el orden no se puede cambiar.
- **Lo más fuerte va en la 2 o la 3.** Cada lámina pierde lectores: lo mejor no
  se guarda para el final.
- **La anteúltima es la que se guarda**: lo que queda de todo, en una oración
  que sirve sin haber leído el resto.
- **La última es el cierre y tiene un trabajo propio: el pedido y el nombre.**
  Pide la cosa que elegiste en (a) y dice de quién es el posteo, con el nombre
  del negocio tal como está en «El negocio»: «¿Con quién lo compartís? Pasá
  por <el nombre>» o el pedido arriba y el nombre abajo. **No repite ni
  resume a las anteriores**: si hace falta juntar lo que quedó, eso es la
  anteúltima. Sin el nombre, `save_post` no guarda el carrusel.
- **Concreto gana a general, siempre.** Una hora, un rubro, un objeto, una
  cifra que esté en la marca, o un número de escena que se lee como escena y no
  como estadística («un sábado te escriben 14 personas»; nunca un porcentaje
  inventado). «Una ferretería, un martes, 23:40» se lee;
  «las empresas chicas, a veces, de noche» no.
- **Cada posteo lleva al menos un dato de ESTE negocio**, sacado de «El
  negocio» o de tu memoria: un producto con su nombre, la calle o el barrio, el
  horario, cómo se pide. «Un buen pan también deja lugar a tus propias
  combinaciones» podría ser de cualquier panadería; «Los bizcochos salen
  del horno a las 6:30» es sólo de la que los hace. Lo que el borrador
  tiene como pregunta no está confirmado y no entra.
- **Todo el texto va de vos**, en las láminas y en el pie: «¿Con cuál te
  quedás?», no «¿Cuál va contigo?»; tenés, podés, querés, con vos, escribinos.
  `save_post` frena una lámina o un pie que hable de tú.
- Una oración corta por lámina, hasta unas 12 palabras. Si necesita dos
  oraciones, son dos láminas o sobra una.

**d. La prueba del hilo, antes de seguir.** Leé las oraciones en orden, de
corrido, como un párrafo. Tiene que pasar las ocho:

1. Se entiende como UN párrafo, con principio y final.
2. Si sacás cualquiera, se nota que falta.
3. Si cambiás dos de lugar, se rompe.
4. Ninguna dice lo mismo que otra con otras palabras.
5. **Cada lámina hace el trabajo que la tabla le da a su lugar.** Un `mito` sin
   el mito dicho en la 1, como lo dice la gente, no es un mito: es otra
   estructura mal nombrada. **Y un mito es algo que la gente de verdad cree y
   dice**; uno inventado para llenar la estructura («si X hace tal cosa, lo
   hace solo») no lo cree nadie y la lámina 1 no se entiende. Si la idea no entra en la que elegiste, cambiá de
   estructura, no le cambies el nombre.
6. **El pedido del cierre se puede cumplir con lo que el carrusel dio.** Si
   pedís que lo guarden, tiene que haber una lámina que valga guardar: los
   pasos, la regla, la frase exacta para contestar, algo que sirva el mes que
   viene sin leer el resto. «Guardá esto» sobre cuatro opiniones es pedir por
   pedir. Si lo que hay es una historia en la que alguien se reconoce, el
   pedido es que te escriba o que se lo mande a alguien.
7. **La última no dice nada que ya dijo otra.** Tapá la anteúltima y leé la
   última: tiene que ser el pedido y el nombre del negocio, no la lista otra
   vez. Si repite, sacale lo repetido; si sin eso no queda nada, sobra una
   lámina.
8. **El dato por el que existe el posteo va en una lámina y va a ir en el
   pie.** Si el posteo es para avisar algo —una fecha, un horario, un precio,
   un lugar, cómo se pide—, ese dato está dicho entero en alguna lámina, y
   anotalo ahora: es lo que el pie no puede dejar afuera. Quien lee el pie sin
   pasar las láminas tiene que saber cuándo, cuánto o dónde.

Si alguna falla, no es un problema de redacción: es que todavía no hay
historia. Volvé a (b). **Una imagen cuesta y una oración no: acá es donde se
corrige.**

**e. Decidí qué MUESTRA cada lámina**, en el mismo guion, al lado de su oración.
La imagen muestra el momento del que habla ESA oración, no el tema del posteo:
si la historia avanza, lo que se ve avanza con ella. **Dos láminas del mismo
carrusel nunca muestran lo mismo.** En un look con fotos u objetos eso quiere
decir otro momento, otra cosa en primer plano, otra hora o otra distancia en
cada una —el teléfono que se prende, la persiana a la mañana, una mano
escribiendo, alguien en la puerta—, aunque el lugar sea siempre el mismo. En un
look de texto solo, lo que cambia es la composición y dónde cae el resaltado.

## 4. Escribí el pie

El pie acompaña al carrusel, no lo repite: **agrega lo que las láminas no
dicen** —el contexto, el matiz, lo que el agente nunca hace— y termina con el
mismo pedido que la última lámina, **dicho con otras palabras**: ninguna
oración del pie es una lámina copiada —`save_post` lo frena—. **Con una excepción: el dato por el que
existe el posteo**, el que anotaste en la prueba del hilo. Ese va también en el
pie, dicho entero —«los sábados de 9 a 13», no «ahora también los sábados»—,
porque mucha gente lee el pie y no pasa las láminas. Un pie que sólo invita
(«escribinos para coordinar») sin decir cuándo, cuánto o dónde dejó afuera lo
único que el cliente pidió avisar. La fórmula, en este orden:

- **Gancho**: una línea, la frase más fuerte del posteo. Es lo único que se ve
  antes del «más», así que no la gastes saludando ni describiendo la imagen.
- **Dos a cuatro líneas cortas** que agreguen lo que la imagen no dice, y una
  de ellas el dato del posteo si lo tiene. Concretas, una idea por línea.
- **Cierre con un solo pedido.** Guardá *y* comentá *y* escribinos es no pedir
  nada.
- **Hasta 5 hashtags**, que van aparte y no adentro del pie.

Y cómo suena:

- Hablale de `vos`, con frases cortas y registro hablado: rioplatense, nunca de tú.
- Nombrá el trabajo, no la tecnología: «los turnos que perdés de noche», no el
  nombre de una integración.
- **Sólo afirmaciones verificables.** Si un dato, un precio o una tendencia no
  está en la marca, no entra. Nada de números inventados, clientes inventados
  ni urgencia inventada.
- Nada de palabras infladas (revolucionario, potenciá, el futuro es hoy), ni
  emojis, ni signos de exclamación en el gancho. Una pregunta abre con «¿»:
  sin el de apertura no es español.
- Si la marca pide decir lo que algo **nunca** hace, va en una línea o en una
  lámina, no es el tema del posteo: el tema es el problema de quien lee.

De cada lámina vas a escribir también su **texto alternativo**: qué se ve en
esa imagen, en una oración, para quien no la ve.

## 5. Hacé el carrusel

Las oraciones ya están: son las del guion del paso 3, **tal cual**. No las
reescribas acá ni las cambies por las líneas del pie.

Se leen como un solo posteo, así que **todas las láminas de un carrusel llevan
el mismo look, y el look es uno de los que están escritos en `marca/brand.md`**
—o, si no hay archivo de marca, el bloque que escribiste en el paso 1—:
su bloque va **palabra por palabra al principio del brief de cada lámina**, con
lo que el bloque pida completar —un lugar, un objeto— dicho igual en todas, y
recién después el texto de esa lámina y qué frase lleva el resaltado, si alguna.
Un brief que dice «igual que la anterior» no dice nada: cada pedido empieza de
cero y el modelo no vio la lámina anterior. No inventes un fondo, un color ni un
personaje que el bloque no nombre.

**El look cambia de un posteo al otro.** Cuál usar hoy está en «El look de hoy»,
al final de tus instrucciones: los que usaron los últimos posteos descansan.

Y en cada brief enumerá **palabra por palabra, entre « »**, el único texto
que puede aparecer en esa pieza —las comillas son cómo `save_post` sabe qué
dice la lámina—: ningún otro, ni fechas, ni dominios, ni logos ni la marca en
una esquina, ni subtítulos en inglés, ni marcas de agua, ni el número de
lámina, ni códigos de color dibujados. El nombre del negocio va sólo en la
última, adentro de su texto y no como firma en un rincón. Todo en español, con sus tildes.

**Y el texto lejos del borde de arriba y del de abajo**, dicho así en cada
brief: «nada escrito en el décimo de arriba ni en el décimo de abajo de la
imagen». La imagen sale un poco más alta que un posteo de Instagram y al
guardarla se le recorta una franja arriba y otra abajo: lo que esté escrito
ahí se pierde.

`generate_image(prompt, format="feed")`, **una lámina por vez y en orden**:
`feed` es la proporción del carrusel y todas las piezas van iguales.

## 6. Mirá cada una. Siempre

La herramienta te devuelve la imagen y la ves, apenas la generás. Recorrela
contra estos cinco puntos:

1. **Se lee**: el texto entra, no se corta, no se pisa con el fondo y no
   toca la franja de arriba ni la de abajo, que se recortan al guardar.
2. **Es del look que elegiste**: el fondo, los colores y el adorno son los de
   ese bloque y nada más, igual que las otras láminas de este carrusel. Un
   robot, un personaje o un fondo que el bloque no nombra es una falla aunque
   quede lindo.
3. **No tiene texto que no pediste.** Es la falla más común y la más fácil de
   pasar por alto, porque el texto de más suele estar bien escrito.
4. **No hay palabras rotas.** Mirá adentro de los dibujos, no sólo los
   titulares: ahí es donde el modelo escribe mal el español.
5. **Dice lo suyo**: la línea de esa lámina y no la de otra.

Si una falla, generá **esa sola una vez más** con la corrección adentro del
prompt, y seguí. Si a la segunda sigue mal, dejala afuera: el carrusel sale con
las que pasaron, siempre que estén el gancho y el cierre, y decís en una línea
cuál quedó afuera y por qué. Si la que no pasa es la 1, no guardes el posteo
—no se guarda sin el gancho—: volvé con el pie escrito y con qué no pudiste
resolver, que un pie bueno sirve.

## 7. Guardalo

`save_post(slug, title, caption, hashtags, format="carousel", images=[…],
alts=[…], structure="…", goal="…")`: el título es cómo se llama el posteo
donde el cliente lo ve, de tres a seis palabras y con sus tildes («El horario
de los sábados»); las imágenes en el orden en que se ven, un texto
alternativo por cada una en ese mismo orden, y la estructura y el objetivo que
elegiste en el paso 3. La herramienta pone la carpeta, los nombres y la fecha; vos
ponés las palabras. El id es la fecha y el slug: otro tema en el mismo día es
otro slug. El brief con el que hiciste cada lámina queda guardado con ella, así
que después se puede arreglar una sola sin rehacer el posteo.
