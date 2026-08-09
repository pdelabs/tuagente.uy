# Instagram

**No hay conector todavía, y es a propósito.** Esto es una decisión pendiente,
no trabajo pendiente.

## Lo que ya funciona sin conectar nada

El flujo `post-semanal-instagram` **ya hace la parte cara**: elige una historia
real del trabajo de la semana, escribe el caption en criollo y arma la imagen
siguiendo el brand kit. Te lo deja marcado "BORRADOR — NO PUBLICAR" para que lo
apruebes.

Lo único que falta es apretar publicar.

## Los dos caminos, con su costo real

### (a) Graph API propia

Requiere cuenta de Facebook Business, una página vinculada, cuenta profesional
de Instagram, app de Meta y **dos permisos que pasan por app review**:
`instagram_business_basic` y `instagram_business_content_publish`. Cada uno
lleva **2 a 4 semanas** y pide un screencast del recorrido completo del usuario.

Publicar es en tres pasos: crear el container, mirar su estado, publicarlo.
Solo JPEG. Máximo 25 posts por cuenta cada 24 horas.

Se revisa **una vez y se reusa en todos los clientes** — el mismo patrón que la
app OAuth de Google.

### (b) Un scheduler (Buffer, Metricool)

Ya hicieron el app review ellos: publicás por su API y nosotros no tramitamos
nada. Días en vez de semanas. A cambio: dependencia de un tercero en el camino
de algo que sale con la marca del cliente, y costo por canal (Buffer tiene API
en el plan gratis; Metricool arranca en USD 22/mes).

## Por qué no lo construimos todavía

Para pdelabs solo, la cuenta no cierra: el flujo ya escribe el post y la imagen,
y el humano aprueba igual porque sale con su marca. La API ahorra **un copiar y
pegar por semana**. Cuatro semanas de trámite por eso, no.

**La cuenta se da vuelta si "tu agente maneja tu Instagram" se vende como
producto.** Ahí son muchos posts en muchos clientes, y una app revisada una vez
paga sola. Y como el review es **espera y no trabajo**, si la decisión es que sí,
el trámite conviene arrancarlo el mismo día — no cuando haga falta.

## Si se decide que sí

1. Arrancar el app review de los dos permisos (en paralelo, son independientes).
2. Mientras se espera, el flujo sigue entregando borradores: no se pierde nada.
3. Cuando salga, el conector es chico — tres llamadas y el `IG_ACCESS_TOKEN`.
