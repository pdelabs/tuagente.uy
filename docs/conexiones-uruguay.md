# Con qué sistemas trabaja una PyME uruguaya (y cómo la enchufamos)

Relevamiento para decidir qué conexiones construir primero. **Estado: 2026-08-05.**

Regla de lectura: donde dice *verificado* lo confirmé contra la fuente; el resto
es criterio y hay que chequearlo antes de prometérselo a un cliente.

---

## 1. Facturación electrónica (CFE) — el único obligatorio

Toda empresa que factura en Uruguay emite CFE ante la DGI. Es el sistema del que
**ninguna PyME se puede escapar**, y por eso el más valioso para conectar: ahí
está la venta, el cliente y la fecha.

- **Uruware** — el dominante: más de **25.000 empresas** en Uruguay (*verificado*).
- La DGI tiene **77 proveedores habilitados** (*verificado*), entre ellos
  **Memory**, **Zureo**, **Bantotal**, **GeoFactura**, **Mempyme**, **Facture**.
- El modelo CFE es de por sí XML sobre servicios web, así que casi todos exponen
  alguna vía de integración. **Falta verificar caso por caso** si es API abierta
  o algo que solo habilitan a partners.

**Cómo conectarlo:** una skill nuestra por proveedor, con las credenciales del
cliente. Empezar por Uruware por volumen, y ver Zureo/Memory después.

**Lo que habilita, en criollo:** "avisame cuando un cliente no pagó a los 30
días", "cuánto facturamos este mes contra el pasado", "armá el resumen para el
contador". Eso es lo que una PyME pide todos los meses.

---

## 2. Contabilidad y gestión

**Memory** es probablemente el más instalado en estudios y comercios chicos;
**Zureo** y **Facture** compiten con ERP liviano; las empresas más grandes van a
**Bantotal** o a SAP/Dynamics.

Realidad a asumir: mucha PyME lleva la contabilidad **en planillas**, y el
estudio contable recibe todo por mail. Por eso Google Sheets + correo cubren más
casos reales que cualquier ERP.

---

## 3. Cobros, POS y pasarelas

Es el rubro con **mejores APIs públicas** del país.

- **Mercado Pago** — la pasarela más usada por vendedores uruguayos
  (*verificado*). API pública, documentada, con sandbox. **La más fácil de todas.**
- **Handy** — POS uruguayo con **guías de integración públicas** y plugin para
  WooCommerce (*verificado*). Integra vía **Plexo**.
- **Plexo** — pasarela que concentra adquirentes: Getnet, OCA, Fiserv, Totalnet
  y Scanntech (*verificado*). Conectando Plexo llegás a varios de una.
- **Scanntech** — fuerte en retail y autoservicios, 30 años de POS (*verificado*).

**Prioridad alta:** Mercado Pago primero (API abierta, mucho volumen, cero
trámite), después Plexo por efecto palanca.

---

## 4. Bancos

Santander, Itaú, BROU, Scotiabank, BBVA. **Uruguay no tiene open banking
obligatorio**, así que para una PyME no hay API: se baja el extracto a mano.

**Cómo lo resolvemos hoy:** el cliente sube el extracto al portal (ya funciona,
cae en `workspace/entrada/`) y el agente concilia contra las facturas. No es
elegante y **es exactamente lo que hoy hace una persona a mano**, así que el
valor está igual.

**Lo que NO vamos a hacer:** guardar las credenciales del homebanking del cliente
para entrar por él. El riesgo no compensa, y es la clase de cosa por la que un
cliente te demanda.

---

## 5. Tiendas online

**Tiendanube** (muy usada en la región), **Shopify**, **WooCommerce** y
**Mercado Libre**. Las cuatro tienen API pública y OAuth. Conexión de dificultad
media, valor alto para quien vende online: stock, pedidos y preguntas sin
contestar.

---

## 6. Lo que ya usan todos los días

- **WhatsApp** — el canal real del comercio uruguayo. El más caro de conectar
  bien (verificación de empresa ante Meta, días). Vale la pena igual.
- **Google Workspace** — mail, planillas, Drive. **Ya soportado por el motor**;
  lo que falta es nuestra app OAuth para que el cliente no tenga que crear nada.
- **Microsoft 365** — bastante presente en empresas más formales. Sin evaluar.
- **Correo del propio dominio** — IMAP/SMTP, minutos, sin trámites. El más
  barato de todos y muchas veces el más útil.

---

## 7. Estado (DGI, BPS)

DGI y BPS tienen servicios en línea con certificado, pensados para el
contribuyente o su contador, **no para integrar un tercero**. No hay API abierta
para que un agente opere en nombre de la empresa.

**Postura:** no automatizar trámites ante el Estado. El agente prepara y avisa;
la persona presenta. Es también lo más defendible si algo sale mal.

---

## Por dónde empezar

Ordenado por (cuánta gente lo usa) × (qué tan fácil es) × (cuánto duele hoy):

| # | Conexión | Por qué |
|---|---|---|
| 1 | **Correo del dominio** | Minutos, cero trámite, resuelve el "no me contestaron" |
| 2 | **Google Sheets / Drive** | Ya soportado; falta solo nuestra app OAuth |
| 3 | **Mercado Pago** | API abierta y documentada, mucho volumen |
| 4 | **Facturación electrónica (Uruware)** | El de mayor valor real; el más trabajo |
| 5 | **WhatsApp oficial** | Alto valor, trámite largo: arrancar temprano |
| 6 | **Tiendanube / Mercado Libre** | Solo para clientes que venden online |

Las tres primeras se pueden tener funcionando sin depender de nadie externo.

---

## Lo que hay que verificar antes de vender cualquiera de estas

1. Si Uruware da acceso a API a un integrador o solo a su cliente directo.
2. Qué permisos pide exactamente Plexo y si hay ambiente de prueba.
3. Si Tiendanube exige publicar una app en su marketplace.
4. Cuánto tarda de verdad la verificación de empresa de WhatsApp en Uruguay.

## Fuentes

- [Registro de proveedores habilitados — DGI](https://www.efactura.dgi.gub.uy/principal/factura-electronica-registro-de-proveedores-habilitado)
- [Uruware](https://www.uruware.com/)
- [Proveedores autorizados por la DGI — Memory](https://memory.com.uy/blog-general/proveedores-de-facturacion-autorizados-por-la-dgi/)
- [Handy — guías de integración](https://handy.uy/guias-de-integracion/)
- [Plexo](https://www.plexo.com.uy/)
- [Mercado Pago Uruguay — guía](https://tiendli.com/blog/mercadopago-uruguay-guia)
- [Acuerdo Scanntech — BBVA Uruguay](https://www.bbva.com.uy/empresas/acuerdo-scanntech.html)
