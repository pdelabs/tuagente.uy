# Cómo se compone el SOUL de un agente

El SOUL es el system prompt: lo que el agente **es** y las reglas que no puede
romper. Se arma pegando estos bloques en orden y reemplazando lo que está
`<ENTRE CORCHETES>`.

```
00-identidad.md      ← específico del cliente, se escribe cada vez
01-aprobaciones.md   ← la regla dura; se adapta el "qué" al cliente
02-entrega.md        ← genérico, va tal cual
03-canales.md        ← genérico, va tal cual
04-lenguaje.md       ← genérico, va tal cual
```

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

Regla práctica: los bloques genéricos rondan los 11 KB y cada regla que tienen
está porque algo falló sin ella. Lo que sí conviene cuidar es **la parte del
cliente** (`00-identidad` y el "qué" de la regla dura): si eso pasa de ~3 KB,
algo de ahí debería ser una skill o un entregable de referencia, no prompt.

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
