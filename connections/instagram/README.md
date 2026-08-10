# Instagram

**Graph API oficial, empezando por leer.** Base:
[`mcpware/instagram-mcp`](https://github.com/mcpware/instagram-mcp) — 23
herramientas, token de larga duración, sin API privada de por medio.

## Por qué leer es la mitad que importa

Un agente que publica sin leer escribe a ciegas: repite temas, se contradice con
lo que ya salió, rompe la línea. `get_media_posts` y `get_media_insights` son el
motivo de esta conexión — con eso el flujo semanal deja de inventar en el vacío
y escribe sabiendo qué se dijo y qué funcionó.

Leer vale aunque nunca prendas publicar.

## Lo que cuesta de verdad

**Para tu propia cuenta no hay app review.** Standard Access está
auto-aprobado y cubre las cuentas que son tuyas: leer **y publicar** andan el
mismo día. Hace falta que la cuenta sea profesional (Business o Creator, las
personales no tienen API), vinculada a una página de Facebook, y una app de Meta
para sacar el token.

**Las 2 a 4 semanas de app review son para operar cuentas AJENAS** — Advanced
Access, o sea el día que esto se venda como producto y cada cliente conecte la
suya. Eso es espera y no trabajo: cuando se decida, el trámite se arranca el
mismo día.

> Una corrección honesta: en la primera vuelta dije que publicar costaba 2 a 4
> semanas. Estaba mal — eso aplica solo a cuentas ajenas.

**Excepción: los mensajes directos.** `instagram_manage_messages` pide Advanced
Access aun en la cuenta propia. Las tres herramientas de DM
(`get_conversations`, `get_conversation_messages`, `send_dm`) están declaradas
pero **no van a andar** hasta que se haga esa revisión.

## Por qué NO usamos un MCP no oficial

Hay varios buenos basados en `instagrapi` (la API privada). Los descartamos:

| | instagrapi | Graph API oficial |
|---|---|---|
| Login | usuario + contraseña | token |
| Detección | **horas** — genera un fingerprint nuevo por corrida | ninguna, es la vía legítima |
| Escalada | challenge → bloqueo → 30 días → **baja permanente** | — |
| Cuenta propia | — | sin app review |

Con WhatsApp aceptamos ese riesgo **porque el número es descartable**. Acá no
hay equivalente: si Meta da de baja la cuenta de una empresa, se pierden el
handle, los seguidores y el historial, y no se recuperan. El MCP no oficial no
da nada que el oficial no dé gratis.

## Reparto de permisos

15 leen, 8 actúan (ver `tools.json`). Con la conexión recién conectada
—**leer sí, actuar no**— el agente ve las 15 de lectura y **ni siquiera sabe que
existen** `publish_media`, `delete_comment` y `send_dm`.

Dos decisiones que no se leen del nombre:

- **`delete_comment` actúa**, obvio, pero vale decir por qué pesa: no se
  deshace, y borrar el comentario de un cliente enojado —decidido por un
  agente— es peor que el comentario.
- **`validate_access_token` lee**, y es más importante de lo que parece: el
  token dura 60 días y después **se cae en silencio**. Que el agente pueda
  mirarlo convierte una falla muda en un aviso.

## Límites

200 llamadas por hora. 25 publicaciones por día. Las imágenes van en JPEG.

## Lo que falta

- **Refrescar el token antes de los 60 días.** Sin eso la conexión se muere
  sola cada dos meses y el cliente se entera cuando el flujo falla.
- Conectar una cuenta real y correr las de lectura de punta a punta. Nada de
  esto tocó Instagram todavía.
