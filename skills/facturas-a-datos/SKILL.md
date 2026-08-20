---
titulo: Cargar facturas
para_cliente: "Pasa la foto o el PDF de tus facturas a la planilla —fecha, proveedor, número y monto— y te muestra lo que no pudo leer antes de que cuente."
name: facturas-a-datos
description: "Pasa una factura —foto, PDF o el XML del CFE— a una fila de datos: fecha, proveedor, RUT, tipo y numero de CFE, moneda, subtotal, IVA y total. Lo que no se puede leer queda vacio y marcado, nunca completado a ojo, y la tanda se le muestra al cliente antes de que cuente. Usala cuando llegue una foto o un PDF de factura, o cuando te pidan cargar comprobantes o pasarlos a la planilla."
version: 1.0.0
license: MIT
---

# facturas-a-datos — la factura entra a la planilla sin que nadie tipee

## Lo primero: fijate si hay XML

En Uruguay el comprobante fiscal **es el XML del CFE**; la hoja impresa es una
representación de ese XML. Si el proveedor lo mandó por mail, si está en la
carpeta con el PDF o si el cliente lo tiene guardado, **leé el XML y no mires la
foto**: los campos vienen nombrados, no hay nada que interpretar y no hay nada
que se pueda leer mal.

Recién si no hay XML se lee la imagen, y ahí entra todo lo que sigue.

Qué trae un CFE, cómo se llama cada cosa y qué cambia entre un e-Ticket y una
e-Factura: `references/cfe.md`.

## Las columnas, siempre las mismas

Cada comprobante sale con estas columnas, en este orden, se hayan podido leer o
no:

| columna | qué es |
|---|---|
| `fecha` | la de emisión del comprobante, no la del día que lo cargaste |
| `proveedor` | la razón social como está escrita en el comprobante |
| `rut` | el RUT del emisor, 12 dígitos |
| `tipo` | e-Ticket, e-Factura, nota de crédito (`references/cfe.md`) |
| `serie_numero` | serie y número juntos, como figuran: `A 0001234` |
| `moneda` | `UYU` o `USD`. Si el comprobante no lo dice, no lo supongas |
| `subtotal` | el neto, antes de IVA |
| `iva` | el IVA del comprobante |
| `total` | lo que hay que pagar |
| `origen` | **de qué archivo salió esta fila** |

`origen` no es una columna de adorno: sin ella, revisar un dato dudoso obliga a
abrir las veinte fotos de nuevo. Es la misma regla que ya tiene la planilla —
cada número tiene que poder señalar de dónde salió.

## El contrato de honestidad

Es el centro de esta skill. Todo lo demás es tipear.

**Lo que no pudiste leer va vacío y marcado.** No hay excepción y no importa
cuánto se parezca a lo obvio.

**Un monto inventado que parece razonable es peor que una celda vacía.** La celda
vacía se pregunta; el monto plausible se cree, y se descubre en el cierre, tres
meses después, cuando ya nadie se acuerda de esa foto.

**No hables de confianza.** "Estoy bastante seguro de que el total es 12.400" no
es un dato, es una apuesta con cara de dato. O lo leíste o no lo leíste. Lo que
decís es **"esto no lo pude leer"**, y decís qué.

**No completes por contexto.** Que el proveedor sea siempre el mismo no te dice
el número de *esta* factura. Que las otras once sean de agosto no le pone fecha a
la doceava. Que el IVA suela ser 22% no te dice cuánto dice esta hoja.

**No cuadres con la resta.** Si tenés subtotal y total pero el IVA está tapado
por el dedo del que sacó la foto, el IVA queda vacío. Calcularlo es escribir un
número que no leíste, y el día que la factura tenía dos tasas ese número está
mal.

**Una fila con tres celdas vacías es un buen trabajo si eran tres celdas
ilegibles.** Sacar la foto de nuevo lleva diez segundos. Corregir un monto mal
cargado lleva un cierre entero.

Y cuando avisás, avisá en el idioma de tu cliente: *"de estas 14, hay 3 en las
que no pude leer el total — te digo cuáles y las sacás de nuevo"*. Nada de
porcentajes de certeza ni de nombres de campos.

## Verificá antes de escribir nada

Tres cosas de una factura uruguaya se pueden chequear con aritmética, y son
justo donde una lectura mal hecha duele:

```bash
python3 /opt/kit/skills/facturas-a-datos/scripts/verificar_filas.py < filas.json
```

Entra una fila o una lista de filas en JSON; sale JSON y **corta con código 1 si
hay problemas**, así no seguís de largo. Devuelve tres listas y no hay que
confundirlas:

- **`problemas`** — contradicciones, no opiniones: el dígito verificador del RUT
  no cierra, o el total no da ni cerca de subtotal + IVA. **Se arreglan volviendo
  a mirar el comprobante**, y si con el comprobante a la vista sigue sin dar, el
  campo se vacía y se marca.
- **`revisar`** — preguntas: el IVA no da ni 22% ni 10% (puede ser una factura
  con las dos tasas, puede ser un dígito mal leído), la diferencia entra en el
  redondeo. No son errores; se miran y se sigue.
- **`sin_leer`** — las columnas que vinieron vacías. Es tu propia declaración,
  puesta en una lista para que llegue al aviso y no se pierda.

El dígito verificador del RUT es el chequeo más barato que hay: **un solo dígito
mal leído casi siempre lo hace fallar**, y a ojo eso no se ve nunca.

**El script no propone valores corregidos, a propósito.** Un RUT "arreglado" o un
total "ajustado" es exactamente el dato inventado que esta skill existe para
evitar. Dice qué no cierra; corregir es mirar el comprobante otra vez.

## A la planilla, sin pisar nada

Las filas **se agregan** a la planilla del cliente. Nunca se pisa una fila que ya
estaba: si algo hay que corregir, se agrega la corrección y se marca.

Antes de agregar, **fijate si la factura ya está**: emisor, tipo, serie y número
identifican el comprobante. Si esa combinación ya figura, no la cargues de nuevo
— decilo y seguí. Una tanda de WhatsApp trae repetidas casi siempre.

Cómo se entrega depende de dónde vive la planilla:

- Si el mes se está armando ahora, la tanda es un entregable: se guarda con la
  skill `entregable`, y **con `--flujo planilla-del-mes` si nació de ese flujo**.
- Si el cliente ya tiene su planilla en un `.xlsx`, se le agregan las filas
  respetando sus columnas tal como están. No rehagas el archivo ni le cambies el
  orden de las columnas para que entre lo tuyo.

## El humano en el loop no es un paso opcional

Tu oficio ya lo dice, y acá se aplica sin excepción:

> **No facturás. No pagás. No presentás nada.** Mirás, ordenás en una planilla y
> avisás.

Leer las facturas y dejar la tanda armada como entregable **no pide permiso**:
es escribir un entregable. Lo que sí pide permiso es **el momento en que esos
números pasan a la planilla que después alguien usa para pagar, declarar o cerrar
el mes**: a partir de ahí se usan como si fueran ciertos, y nadie los volvió a
mirar. Ahí va aprobación, con la skill `aprobacion` y en el ticket que ya estás
trabajando.

Lo que le mostrás para aprobar es **la tabla completa, con los huecos a la
vista** — no un resumen ni un conteo. Que vea las filas que le faltan datos es
la mitad del valor: son las fotos que tiene que sacar de nuevo.

La tanda nunca entra sola. Ni cuando son tres facturas, ni cuando son todas del
mismo proveedor de siempre, ni cuando el cliente dijo "dale, cargá todo": eso
autoriza el trabajo, no reemplaza el ver lo que quedó cargado.

## Lo que no hacés

- **No emitís facturas ni presentás nada a DGI.** Si te lo piden, decís que no y
  ofrecés lo que sí: dejar todo cargado y ordenado para que lo haga quien
  corresponde.
- **No "arreglás" un RUT ni un monto** para que el chequeo pase.
- **No borrás ni pisás filas viejas.**
- **No clasificás el gasto por tu cuenta** si el cliente no dijo cómo clasifica.
  Dejá la columna y preguntale una vez qué categorías usa.
