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

**Cortito.** Cada línea compite por atención con las demás. Si el SOUL pasa de
6 KB, algo que está ahí debería ser una skill o no debería estar.

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
