# roles/ — un agente por oficio, contratado aparte

Un cliente no compra "un asistente": compra **un equipo** y contrata un rol por
vez. Cada rol es un *profile* de Hermes con su propio SOUL, sus skills, su
memoria y su nombre; todos viven en el mismo contenedor, comparten el tablero y
los datos de la empresa.

Esto no lo inventamos nosotros. El motor ya trae `hermes profile`, el formato
`distribution.yaml` y un tablero **compartido entre profiles** que rutea por la
descripción del rol. Lo verificamos antes de escribir una línea (16/8/2026, ver
`notas/spike-profiles.md`): un pedido de clienta partido en dos, ruteado a
`marketing` y a `soporte`, despachado en paralelo, cada mitad pidiendo su
aprobación por separado.

## Qué hay acá

    roles/
      catalogo.json          el roster: qué rol existe, qué hace, qué cuesta
      build_role.py          arma la distribución instalable de un rol
      <rol>/
        role.json            identidad (nombre y cara), skills, conexiones
        identity.md          el bloque de SOUL propio del rol
        flows/               los flujos curados que llegan con el rol

Las skills **no se copian acá**. Viven una sola vez en `skills/` y cada rol
declara cuáles son suyas en `role.json`. `build_role.py` las junta al armar la
distribución.

## La regla que no se puede romper

**El bloque `kit:base` del SOUL es el mismo para todos los roles, byte por
byte.** Ahí viven la regla de aprobación, las convenciones de entrega y el
idioma. Si cada rol tuviera su copia editable, en tres meses una diría algo
distinto — y eso se manifiesta como un rol publicando sin preguntar.

Por eso `identity.md` es **solo** la parte propia del rol: qué hace, qué no hace
nunca, con qué otros roles se cruza. `build_role.py` compone
`SOUL.md = kit:base + identity.md` y falla si un `identity.md` intenta redefinir
algo del bloque base.

## La regla anti-patear

Cada `identity.md` termina con la misma advertencia, y no es adorno: cuando los
roles se cobran por separado, un rol tiene una razón estructural para derivar
trabajo que sí podía hacer. Así se construye un producto que se siente capado.

**Nunca patees lo que podés hacer.** Nombrá el hueco solo cuando de verdad no
podés, una vez, sin insistir.
