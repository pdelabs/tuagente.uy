# Qué trae un comprobante fiscal uruguayo

Desde el **1/1/2026 la factura electrónica es obligatoria** para todos los
contribuyentes de DGI, así que casi todo lo que llega hoy es un CFE
(Comprobante Fiscal Electrónico).

**El documento es el XML. La hoja es una representación impresa de ese XML.**
Eso tiene una consecuencia práctica que vale más que todo lo demás de este
archivo: si conseguís el XML, no hay lectura que hacer. El CFE viaja por mail
entre empresas; muchas veces el cliente lo tiene y no sabe que lo tiene.

## No hay un lugar fijo en la hoja

El contenido de la representación impresa está reglado; **el diseño no**. Cada
software de facturación la arma distinto: dos facturas del mismo mes pueden
tener el total arriba a la derecha y abajo a la izquierda. Este archivo es un
mapa de **qué buscar**, no de **dónde está**.

## e-Ticket y e-Factura no son lo mismo

Es la distinción que más cambia lo que vas a encontrar:

- **e-Ticket** — se le emite a un **consumidor final**. Puede no traer datos del
  comprador, o traer solo un nombre y una cédula. Es lo que le dan al cliente en
  el mostrador.
- **e-Factura** — se emite **entre contribuyentes**, así que trae el **RUT del
  comprador** además del RUT del emisor. Es la que le sirve a una empresa para
  descontar el IVA.

Si estás cargando gastos de una empresa y el comprobante es un e-Ticket sin RUT
del comprador, eso es un dato para el cliente, no un error tuyo: decilo.

Cada familia tiene su nota de crédito (devoluciones, anulaciones) y su nota de
débito. **Una nota de crédito resta**: si la cargás como una factura más, el mes
cierra de más.

### Códigos de tipo de CFE

El XML trae el tipo como número. Los cuatro que vas a ver todo el tiempo:

| código | tipo |
|---|---|
| 101 | e-Ticket |
| 102 | Nota de Crédito de e-Ticket |
| 111 | e-Factura |
| 112 | Nota de Crédito de e-Factura |

Existen más (notas de débito, exportación, remitos, resguardos, venta por cuenta
ajena) y siguen el mismo patrón de familias de tres. **Verificá contra un CFE
real antes de confiar en un código que no sea uno de estos cuatro**: la tabla
completa la publica DGI y acá solo están los que están confirmados.

## Los campos, y con qué columna se corresponde cada uno

| en el comprobante | columna |
|---|---|
| RUT del emisor — 12 dígitos, siempre presente | `rut` |
| Razón social del emisor (el nombre de fantasía puede ser otro: va la razón social) | `proveedor` |
| Tipo de CFE (nombre o código) | `tipo` |
| Serie (una o dos letras) y número correlativo | `serie_numero` |
| Fecha de emisión | `fecha` |
| Moneda y, si no es peso, el tipo de cambio | `moneda` |
| Total neto / monto gravado | `subtotal` |
| IVA (desglosado por tasa) | `iva` |
| Monto total a pagar | `total` |

Además, siempre en la hoja y sin columna propia:

- **CAE** — la autorización de DGI para emitir: número de autorización, rango de
  numeración autorizado y fecha de vencimiento. Que esté es señal de que el
  comprobante es un CFE de verdad.
- **Código QR** — lleva los datos para verificar el comprobante en el sitio de
  DGI. *Qué campos exactos codifica: verificar contra un CFE real.*

## El IVA: dos tasas y una trampa

- **Tasa básica 22%** — la mayoría de las cosas.
- **Tasa mínima 10%** — canasta, medicamentos, algunos servicios.
- **Exento / no gravado** — existe y da IVA cero. Un total sin IVA no es un
  error automático.

**Una misma factura puede tener las dos tasas.** Por eso el desglose del total
en la hoja tiene varias líneas: monto no gravado, monto gravado a tasa mínima,
monto gravado a tasa básica, IVA de cada una, y recién ahí el total.

La trampa: si hay dos tasas, `iva / subtotal` no da 22% ni 10%, da algo en el
medio. **Eso no significa que leíste mal**, y tampoco significa que leíste bien.
Es lo que el script manda a `revisar` en vez de a `problemas`.

## El RUT

Doce dígitos, sin puntos ni guiones. El último es **dígito verificador**, se
calcula sobre los once anteriores, y por eso un dígito mal leído casi siempre lo
hace fallar. Lo chequea `scripts/verificar_filas.py`.

Se imprime a veces con puntos o con guión (`21.100342.0017`): eso es formato, no
otro número. Se normaliza a doce dígitos.

## Qué falta verificar contra un CFE real

Lo de arriba es lo que está confirmado. Esto no, y conviene chequearlo la
primera vez que se trabaje con los XML de un cliente:

- **Los nombres de las etiquetas del XML.** El formato de DGI usa nombres cortos
  para los totales (del estilo `MntNetoIvaTasaBas`, `IVATasaBas`, `MntTotal`,
  `MntPagar`), pero el nombre exacto de cada etiqueta y su anidamiento hay que
  leerlos de un CFE real antes de escribir nada que dependa de ellos.
- **La tabla completa de códigos de tipo de CFE**, más allá de los cuatro de
  arriba.
- **Qué codifica el QR** de la representación impresa.
- **Cómo aparece la adenda** (el texto libre que agrega el emisor: orden de
  compra, número de remito, condiciones de pago). Ahí suele estar el dato que el
  cliente busca y que no tiene columna.
