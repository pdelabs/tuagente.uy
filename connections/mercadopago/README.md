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
