# Cómo se compone el SOUL de un agente

El SOUL es el system prompt: lo que el agente **es** y las reglas que no puede
romper. Se arma pegando estos bloques en orden y reemplazando lo que está
`<ENTRE CORCHETES>`.

```
00-identidad.md      ← del cliente, se escribe cada vez, y va AFUERA del bloque
<!-- kit:base v2 -->
01-aprobaciones.md   ← la regla dura, ya genérica; adentro tiene un comentario
                       para sumarle lo sensible de esta empresa
02-entrega.md        ← genérico, va tal cual
03-canales.md        ← genérico, va tal cual
04-lenguaje.md       ← genérico, va tal cual
05-precedencia.md    ← genérico, cierra el bloque: la regla de desempate
<!-- /kit:base -->
```

Lo hacen solos `nuevo-agente.sh` (un agente nuevo) y `tools/instalar-soul.sh`
(uno que ya existe y no lo tiene). A mano se pega igual, en ese orden y con los
marcadores.

## Los marcadores y la versión

Los bloques genéricos van envueltos entre `<!-- kit:base v2 -->` y
`<!-- /kit:base -->`. Los dos marcadores hacen tres cosas:

- **Dicen qué reglas tiene puesto un agente** sin leerle el prompt entero: la
  versión está en el marcador de apertura, y qué versión hay en cada agente
  está en `flota.md`.
- **Le dan sentido a `05-precedencia.md`**: la regla de desempate necesita poder
  señalar dónde empieza y dónde termina lo que manda.
- **Hacen idempotente la instalación**: `instalar-soul.sh` no toca un agente que
  ya tiene bloque, sea cual sea su versión, y dice cuál tiene.

**Ojo al actualizar: reemplazar el bloque se lleva puesto lo que el cliente tenga
adentro.** Las acciones sensibles propias de cada empresa viven en
`01-aprobaciones.md`, o sea DENTRO de los marcadores. Quien suba a una versión
nueva tiene que sacarlas del bloque viejo antes y volver a ponerlas después. Hoy
es a mano y hay que acordarse; que lo resuelva una herramienta viene después.

La versión vive en `soul/VERSION`: una línea, con forma `vN`. De ahí la leen
`nuevo-agente.sh`, `tools/instalar-soul.sh` y `tools/agente-check.py`, y si el
archivo falta o dice otra cosa los dos primeros se niegan a estampar el marcador.

Se sube cuando aparece una regla nueva o cuando una cambia de sentido: o sea,
cuando los agentes ya instalados quedan atrás y hay que reinstalarles el bloque.
`v1` es el marcador sin versión, de antes de que esto existiera, y
`agente-check.py` lo reporta como tal.

## Los comentarios del SOUL tienen cinco palabras prohibidas

El motor escanea el SOUL antes de meterlo en el prompt, y uno de sus patrones
matchea **cualquier comentario HTML que contenga `ignore`, `override`, `system`,
`secret` o `hidden`**, en mayúsculas o minúsculas. Cuando matchea no borra el
comentario: **descarta el SOUL entero** y deja en su lugar un
`[BLOCKED: SOUL.md contained potential prompt injection]`. El agente arranca sin
identidad y sin reglas, contesta como si nada, y el único rastro es una línea en
el log del motor.

O sea que un comentario `por-cliente` bienintencionado —"ignore los mails de
facturación", "override de precios para mayoristas", "los datos hidden del
panel"— le apaga al agente todas las reglas, en silencio. Escribilos en español
y sin esas palabras. Lo chequea `agente-check.py`, que para eso mira todos los
comentarios del SOUL, no solo los nuestros.

Regla general, entonces: **un comentario del SOUL es una nota corta, en español,
para quien lo compone.** Lo que necesite una explicación larga va al repo del
agente, no adentro del prompt.

## Cómo se llaman las cosas

Cinco nombres para lo mismo obligan al agente a adivinar de qué le estás
hablando. Estos son los que usan los bloques genéricos, y el SOUL del cliente
conviene que use los mismos:

| Se dice | Y es | En vez de |
|---|---|---|
| **tu cliente** | la persona que dirige al agente y aprueba lo sensible — es lo que queda cuando se reemplaza `<RESPONSABLE>` | "el usuario", "la persona", "el responsable" |
| **gente de afuera** | clientes, proveedores y desconocidos de la empresa: tono de la empresa y nada de información interna | "los clientes", que se confunde con tu cliente |
| **flujo** | lo que corre solo, cada tanto o ante un disparador | "cron", "tarea programada", "automatización" |
| **entregable** | un archivo que tu cliente va a releer, guardar o reenviar | "documento", "reporte", "output" |
| **artefacto** | **solo** los `art_...` del portal: lo que se mira, no lo que se lee | usarlo para cualquier archivo |

## Tres reglas al escribirlo

**El SOUL no es el catálogo de skills.** De eso se encarga el índice de Hermes,
que lee el `description` del frontmatter de cada `SKILL.md`. Acá van las reglas
de negocio: qué requiere aprobación, qué no le corresponde, cómo hablar.

**Si una convención importa, que la ejecute un script.** Todo lo que dependió de
que el modelo se acordara, falló. Todo lo que quedó en código, aguantó. El modelo
pone las palabras; el código pone el formato.

**Cortito, pero sabiendo dónde está el gasto.** Cada línea compite por atención
con las demás, así que lo que no cambia una decisión, sobra. Ahora bien, medido
con `hermes prompt-size` sobre un agente recién creado (2026-08-05):

```
system prompt   39,6 KB   ← de eso, ~11 KB son estos bloques
esquemas tools  67,6 KB   ← casi el DOBLE, y se paga en cada llamada
```

O sea: **la palanca grande son las herramientas, no la prosa.** Sacar `tts` y
`delegation` ahorró 7,6 KB de una — más que todo lo que se gana reescribiendo
párrafos. Antes de podar el SOUL, mirá `agent.disabled_toolsets` en el
`config.yaml`.

Regla práctica: los bloques genéricos rondan los 14 KB —eran 11 antes de la
regla dura genérica y del bloque de precedencia— y cada regla que tienen está
porque algo falló sin ella. Lo que sí conviene cuidar es **la parte del cliente**
(`00-identidad` y las acciones sensibles propias): si eso pasa de ~4 KB, algo de
ahí debería ser una skill o un entregable de referencia, no prompt. Por ahí anda
el aviso de `agente-check.py`, que mira el SOUL entero.

## Lo que el agente NO tiene que saber

No metas nada de esto, y si el runtime lo mete, no lo refuerces:

- Sobre qué corre (el nombre del runtime, su documentación, cómo configurarse).
  El agente es **el agente de \<CLIENTE\>, provisto por tuagente.uy**, y punto.
- Su infraestructura: rutas absolutas de sistema, nombres de contenedores,
  comandos para levantarse o reiniciarse.
- Cómo instalarse skills o cambiar su propia configuración. No es solo ruido:
  un agente que sabe ampliarse es un agente al que se lo puede convencer de que
  se amplíe.
- Nada de nuestro negocio: precios, márgenes, que existe este kit, ni que hay
  otros clientes.
