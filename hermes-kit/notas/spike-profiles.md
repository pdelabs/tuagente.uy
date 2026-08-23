# El spike de profiles — 16/8/2026

Antes de escribir una línea del pivot a equipo, la pregunta era si el motor
soporta de verdad varios roles o si tendríamos que construir la orquestación
nosotros. **Soporta.** Esto es lo medido, en un lab local desde cero.

## Las cuatro preguntas

| | Pregunta | Resultado |
|---|---|---|
| 1 | ¿El decomposer rutea por descripción? | **Sí**, y bien |
| 2 | ¿`kanban.db` es compartida entre profiles? | **Sí** — una sola en `/opt/data/` |
| 3 | ¿El resultado vuelve a un solo lugar? | **Sí** — el adapter devuelve todo junto |
| 4 | ¿Un gateway sirve a todos los profiles? | **Sí**, con `gateway.multiplex_profiles: true` |

## El ruteo

Dos profiles (`marketing`, `soporte`), cada uno con una descripción de una
frase. Un ticket escrito como lo escribe una clienta, **sin nombrar roles**:

> "Cambiamos el horario: ahora abrimos sábados de 9 a 13. Quiero avisarlo en
> Instagram esta semana, y además contestarle a la gente que ya preguntó por
> WhatsApp si abrimos los sábados. Hay como diez mensajes sin responder."

`hermes kanban decompose` lo partió en dos hijos y los ruteó:

    t_777a4819  marketing  Publica el nuevo horario de sábados en Instagram
    t_62111e08  soporte    Responde las consultas pendientes sobre apertura

Los dos se despacharon **en paralelo** y los dos terminaron en `blocked`, que en
nuestro tablero es "esperando tu OK": marketing pidió aprobación del texto
exacto antes de publicar, soporte pidió aprobación antes de escribirle a
contactos externos. **El SOUL v12 funciona igual adentro de un profile.**

Soporte además reportó honestamente que no encontró WhatsApp configurado y
emitió `conexion:whatsapp` — eligiendo un id del catálogo cerrado en vez de
inventar texto libre.

## Lo que sirve para el portal

Los comentarios ya vienen firmados con el nombre del profile:

    [02:14] commented {'author': 'soporte',   'len': 681}
    [02:16] commented {'author': 'marketing', 'len': 1168}

La atribución que queremos dibujar —el chip en el Tablero, la firma en el chat—
no hay que inventarla. El dato viaja; falta que el adapter lo exponga.

## Lo que hay que arreglar

**El adapter no expone `assignee`.** Devuelve las tres tareas con
`assignee: null`. Sin eso no hay chip de rol.

**Sumar un rol pide reiniciar el gateway.** `profiles_to_serve` corre sólo al
arranque: creé los profiles y el gateway siguió sirviendo `['default']` hasta
reiniciarlo. Contratar un rol no es instantáneo — hay que decidir si un reinicio
corto es aceptable o si buscamos un reload.

**El workspace `scratch` se borra al terminar la tarea.** El motor lo avisa en
un evento del ticket. Para los roles hay que usar `--workspace dir:` apuntando
al workspace compartido, o el trabajo se evapora — la misma clase de bug que las
imágenes que se quedaban en el caché.

## El empaque (fase 1)

`hermes profile install <dir>` sobre lo que arma `roles/build_role.py`:

    ✓ Installed 'marketing' v0.1.0
      Env vars: OPENROUTER_API_KEY (required, ✓ set)

Validó la clave sola. Después, la prueba que sostiene todo el empaque —sembré
datos del cliente, edité el SOUL a mano, subí a v0.2.0 y corrí `update`:

| | |
|---|---|
| `workspace/brand/brand.json` | **sobrevivió** |
| `memories/MEMORY.md` | **sobrevivió** |
| edición local del `SOUL.md` | **pisada** |

Es exactamente `install.sh` + los sha256 + el allowlist + el drift check, pero
nativo.

Un rol instalado **no necesita `config.yaml`**: hereda el modelo de la
instalación. En `hermes profile list` aparece `Model: —`, que es cómo se
muestra, no un bloqueo. Corrió en 11 segundos y contestó con su oficio.

## Costo

Centavos, sobre una clave de OpenRouter minteada para el spike con tope de
US$ 5 (`lab-equipo-spike`). Revocarla cuando el lab deje de hacer falta.
