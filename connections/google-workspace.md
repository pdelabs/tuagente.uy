# Conectar Google (Planillas, Drive, Agenda, Docs) sin que el cliente sufra

**El motor ya sabe hacerlo.** La skill `google-workspace` viene con Hermes y
cubre Gmail, Calendar, Drive, Docs y Sheets. Lo que falta no es código: es que
alguien haga el trámite de Google, y ese alguien **no puede ser el cliente**.

## El problema, en una línea

La skill, tal como viene, le pide al usuario que cree un proyecto en Google
Cloud Console, habilite seis APIs, configure la pantalla de consentimiento y
baje un JSON. Un contador de Pocitos no va a hacer eso, y si lo intenta lo va a
hacer mal. Es exactamente donde quedó trabada la tarea de mails de un cliente
real.

## La salida: una sola app OAuth nuestra

El cliente OAuth que pide la skill es de tipo **"Desktop app"**. Google trata el
secreto de ese tipo de cliente como **no confidencial** —está pensado para vivir
dentro de aplicaciones que se distribuyen—, así que **podemos crear uno solo,
nuestro, y usarlo en todos los agentes**.

Con eso, lo único que hace el cliente es: abrir un link, elegir su cuenta,
aceptar y devolvernos un código. Dos minutos, por teléfono si hace falta.

## Runbook — una vez, nosotros

1. Crear un proyecto en Google Cloud Console con la cuenta de tuagente.
2. Habilitar las APIs que vayamos a ofrecer. **Empezar por Sheets, Drive, Docs y
   Calendar**, y dejar Gmail afuera a propósito (ver la advertencia de abajo).
3. Crear credenciales → ID de cliente de OAuth → tipo **Aplicación de escritorio**.
4. Bajar el JSON y guardarlo donde guardamos los secretos del equipo.
5. Configurar la pantalla de consentimiento con el nombre y el logo de
   tuagente: es lo que el cliente va a ver cuando le pidamos permiso, y ahí se
   gana o se pierde la confianza.
6. **Publicar la app.** Mientras está en modo prueba solo funcionan los usuarios
   que agregues a mano y **los permisos se vencen a los 7 días** — un agente que
   deja de leer las planillas cada semana no es un producto.

## Runbook — por cada cliente

1. Copiar el JSON del paso 4 al agente como `data/google_client_secret.json`.
2. Correr el setup de la skill en modo no interactivo, pidiendo **solo los
   servicios que ese cliente necesita** (`--services sheets,drive` si es lo
   único que usa): cuantos menos permisos pida la pantalla, más gente acepta.
3. Pasarle el link al cliente, que entra con su cuenta y acepta.
4. Verificar con `--check`: tiene que decir `AUTHENTICATED`.
5. Confirmar en el portal, pestaña Conexiones, que quedó en **Conectado**.

## Advertencias que no hay que aprender a los golpes

- **Gmail por OAuth sale caro.** Leer o mandar mail con la cuenta de Google es
  un permiso *restringido*: para publicar la app, Google exige una auditoría de
  seguridad de un tercero. Para correo usamos IMAP/SMTP con contraseña de
  aplicación: minutos, cero trámite, y le sirve igual al cliente.
- **Los permisos de Sheets/Drive/Calendar son *sensibles*, no restringidos**:
  verificación de marca, sin auditoría de seguridad. Es el camino barato.
- **Protección Avanzada**: si la cuenta del cliente la tiene activada, su
  administrador tiene que autorizar nuestro ID de cliente antes. Preguntarlo
  ANTES de agendar la llamada, no durante.
- **Un agente, una cuenta.** Nunca compartir un token entre clientes, ni usar la
  cuenta de tuagente para operar los datos de un cliente.

## Estado

Falta hacer el runbook de una vez (los seis pasos de arriba). Hasta entonces, el
portal muestra Google como **"Falta un paso nuestro"**, que es la verdad: el
cliente no puede hacer nada hasta que exista esa app.
