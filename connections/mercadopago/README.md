# Mercado Pago

La pasarela más usada por vendedores uruguayos, y la de mejor API del país:
pública, documentada y con sandbox.

## Por qué NO usamos el MCP oficial

Mercado Pago tiene un MCP oficial (`mercadolibre/mercadopago-mcp-server`), y no
sirve para esto. Sus herramientas son **de desarrollo**: buscar documentación,
crear aplicaciones, obtener credenciales, configurar webhooks, generar usuarios
de prueba, correr el medidor de calidad de la integración.

Eso es para el que **está integrando** Mercado Pago. Nuestro cliente ya lo
tiene integrado — quiere saber quién no le pagó. Por eso el nuestro, en `mcp/`,
va contra la API REST y habla en las palabras del dueño.

## Qué expone

Cuatro herramientas que leen y dos que actúan (ver `tools.json`):

| | |
|---|---|
| `cobros_del_periodo` | Cuánto entró entre dos fechas, con desglose por medio de pago |
| `buscar_cobros` | Por estado, fecha o referencia |
| `ver_cobro` | El detalle de uno |
| `cobros_pendientes` | Lo que quedó pendiente o rechazado |
| `crear_link_de_cobro` | **actúa** — sale a nombre de la empresa |
| `devolver_cobro` | **actúa** — saca plata y no se deshace |

## Política por defecto

Leer sí, actuar no. `devolver_cobro` además **tiene que pasar por la puerta de
aprobación** aunque el cliente habilite "puede escribir": sacar plata de la
cuenta es irreversible y no alcanza con un interruptor.

## La credencial

Un Access Token de producción en `MP_ACCESS_TOKEN`. Va en el `.env` del agente:
el cliente **no pega claves en el portal**. Le decimos dónde encontrarla en su
panel y la cargamos nosotros — por eso `quien: asistido`.

## Límites de la API, verificados

- La búsqueda devuelve **hasta 100 por consulta** y solo los **últimos 12
  meses**; el rango no puede pasar de 365 días. `cobros_del_periodo` avisa
  cuando el total puede estar recortado en vez de mentir un número redondo.
- Las fechas van en `yyyy-MM-dd'T'HH:mm:ss.SSSZ`.

## Lo que falta

Probarlo contra una cuenta real. Está escrito y pasa por la guardia, pero
ningún endpoint se ejecutó todavía contra Mercado Pago — hace falta el token.
Empezar con las credenciales de **sandbox**, no con las de producción.

---

## Lo que arreglamos después de mirar código de verdad (9/8)

La primera versión salió de la documentación y tenía errores. Se corrigió
leyendo la integración de **demoda** (`backend/src/orders/`,
`common/mercadopago/`), que lleva años en producción.

**1. `X-Idempotency-Key` faltaba, y es obligatorio.** Mercado Pago lo hizo
mandatorio en Pagos y Devoluciones porque se estaban duplicando. Sin el header,
un reintento por timeout puede **devolver la plata dos veces** — y eso no se
deshace. Ahora la clave se deriva del pago y el monto, así el reintento de la
misma operación es el mismo pedido.

**2. Chequear el estado antes de devolver.** demoda lo hace y la doc no lo
sugiere: si el pago ya figura `refunded`, se responde sin tocar nada. La
idempotencia protege del reintento idéntico; esto protege de la orden repetida
a mano.

**3. Los webhooks faltaban por completo.** Y con ellos, la regla que hace toda
la diferencia y que sale del handler de demoda:

> **La notificación es el disparador, no el dato.** Trae un id y nada más
> confiable que eso. El estado se le pide a la API. Creerle el `status` al
> webhook es creerle a algo que te mandó un desconocido.

Se agregó verificación de firma (HMAC-SHA256 sobre
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con `MP_WEBHOOK_SECRET`),
filtrado explícito por `type`/`action`, y el aviso de que hay que contestar 200
en menos de 22 segundos o MP reintenta cada 15 minutos.

**4. Los tokens van cifrados en reposo.** demoda guarda uno por tienda y lo
descifra al usarlo. Nosotros hoy lo tenemos en el `.env` del agente, que para
un agente por cliente alcanza — pero si algún día un agente maneja varias
cuentas, ese es el patrón.

## Lo que NO cubre demoda: suscripciones

Buscamos y **no hay nada de `preapproval` ni suscripciones** en su código. Así
que para eso no tenemos referencia probada: habría que ir a la documentación,
que es justo lo que acá falló. Si un cliente lo necesita, conviene tratarlo
como trabajo de investigación y no como "agregar una herramienta más".
