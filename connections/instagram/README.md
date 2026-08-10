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

## Standard vs Advanced, sin el atajo

La regla de Standard Access **no es "cuentas propias"** — ese atajo confunde y
lleva a conclusiones falsas. La regla es: se le puede pedir permiso a quien
tenga **un rol en nuestra app de Meta** (admin, developer o tester).

| | Standard | Advanced |
|---|---|---|
| App review | no, auto-aprobado | sí, 2 a 4 semanas |
| Quién puede conectar | solo quien tenga un rol en la app | cualquiera |
| Qué hace el cliente | acepta una invitación en el panel de desarrolladores de Meta | aprieta un botón |

**Los permisos son los mismos y hacen lo mismo.** Lo único que cambia es a quién
se le puede pedir.

Consecuencia práctica, que es la que importa: **la cuenta de un cliente SÍ se
conecta sin app review** — se lo agrega como tester y acepta. Anda hoy. Lo que
no anda es el onboarding: ese cliente tiene que entrar al panel de
desarrolladores de Meta, y es justo el cliente que no sabe qué es un token.
Sirve para **pilotear con uno o dos, no para vender**.

O sea que el app review no habilita capacidades nuevas: **habilita que
conectarse deje de ser una pantalla de desarrollador**. Se pide cuando esto se
venda, y como es espera y no trabajo, se arranca temprano.

> Corrección: en la primera vuelta dije que publicar costaba 2 a 4 semanas.
> Estaba mal. En la segunda dije "solo cuentas propias", que también es
> impreciso. Vale lo de esta tabla.

**Requisito que no se saltea:** la cuenta tiene que ser **profesional** (Business
o Creator) y **pública**, vinculada a una página de Facebook. Las personales no
tienen API — Meta les cortó el soporte en octubre de 2024. Convertirla es gratis,
lleva 5 minutos, es reversible y no se pierden seguidores ni posts.

**Excepción: los mensajes directos.** `instagram_manage_messages` pide Advanced
Access **siempre**, aun en la cuenta propia. Las tres herramientas de DM
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
