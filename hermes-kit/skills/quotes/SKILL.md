---
title: Presupuestos
client_summary: "Arma el presupuesto con tu formato y tus precios, listo para que lo mandes."
name: quotes
description: "Arma un presupuesto con el formato y los precios del cliente: cruza lo que le pidieron contra su lista, hace las cuentas con IVA, moneda y validez, y lo deja como entregable listo para mandar. Usala cuando pregunten cuanto sale algo, pidan un precio, una cotizacion o un presupuesto, o cuando haya que actualizar la lista de precios. La primera vez no hay formato ni lista: se los pedis al cliente, no los inventas."
version: 1.1.0
license: MIT
---

# quotes — el precio que ya existe, en el formato que ya usan

Cotizar a mano lleva de dos a cuatro horas y el que preguntó espera respuesta el
mismo día. Ahí se gana o se pierde la venta: un presupuesto que llega primero
gana seguido contra uno más barato que llega el martes.

Lo que se acelera es **armarlo**. De dónde salen los números no se acelera nunca.

## Sin formato y sin lista no se cotiza

Lo primero, siempre, aunque parezca que ya sabés el precio:

```bash
python3 /opt/kit/skills/quotes/scripts/new_quote.py --item "cepillado:12"
```

Si todavía no hay formato o no hay lista, corta con `missing` y te da la
pregunta ya escrita. **Hacésela y esperá.** Son dos cosas y se piden **juntas,
en un solo mensaje**:

1. **Un presupuesto que ya haya mandado.** El PDF, una foto, un mail viejo: lo
   que tenga. De ahí salen el orden de los bloques, las condiciones que siempre
   pone y cómo cierra. Un presupuesto en un formato que no es el suyo se nota, y
   el que lo recibe no lo lee como algo de esa empresa.
2. **La lista de precios, como la tenga.** Un Excel, una planilla escaneada, una
   nota en el celular.

Las dos las podés leer con lo que ya tenés: un Excel lo abrís, una foto o un PDF
escaneado los mirás.

Si dice que no tiene ninguna de las dos, **no lo armes igual**. Preguntale cuánto
cobra por lo que hay que cotizar ahora, guardá esos precios, y con eso arrancó la
lista: el próximo ya sale derecho. Un precio puesto por vos no se demora: se
cobra.

## Dónde vive lo que guardás

```
workspace/presupuestos/
  formato.json        cómo son SUS presupuestos: encabezado, condiciones, IVA, moneda, validez
  lista-precios.csv   qué cobra por cada cosa
  fuentes/            los originales que te pasó — copialos con `cp`, sirven para imitarle el tono
  contador.json       la numeración, para que no se repita ni se salte un número
```

`formato.json` y `lista-precios.csv` **los escribe el script, no vos**. Es la
misma razón de siempre: si cada corrida los deja distintos, la corrida siguiente
lee cualquier cosa.

```bash
python3 /opt/kit/skills/quotes/scripts/save_setup.py \
  --set empresa.nombre="Taller San Martín" \
  --set moneda_por_defecto=UYU \
  --set iva.criterio=mas_iva \
  --set validez_dias=15 \
  --set condiciones="Forma de pago: 50% al confirmar | Entrega: 5 días hábiles | No incluye flete"
```

Cada `--set` llena su campo y **le saca ese hueco a `gaps`**, así "qué falta"
sigue siendo cierto sin que nadie se acuerde de actualizarlo. Lo que no se sabe
se queda como hueco: un formato que afirma algo que nadie decidió es peor que
uno incompleto, porque después se manda.

## La lista de precios

Se carga entera de una, con la tabla ya leída de lo que te pasó:

```bash
python3 /opt/kit/skills/quotes/scripts/save_setup.py --prices <<'CSV'
codigo,item,unidad,precio,moneda,iva,nota
CEP-01,Cepillado de piso,m2,390,UYU,,
FLE-MVD,Flete Montevideo,viaje,1.500,UYU,,hasta 3 km
CSV
```

Tres cosas que el script arregla y conviene que sepas, porque son las que se
equivocan al transcribir:

- **`$` en Uruguay es pesos y `U$S` es dólares.** Confundirlos multiplica por
  cuarenta.
- **`1.250,50` es mil doscientos cincuenta con cincuenta**, no uno con veinticinco.
- **`iva` vacío usa la tasa del formato** (la básica es 22; la mínima, 10, es
  para lo que la tiene). Se pone por fila solo cuando esa fila va distinto.

Y lo que tu cliente te contesta hoy **va a la lista**, no solo al presupuesto de
hoy:

```bash
python3 /opt/kit/skills/quotes/scripts/save_setup.py \
  --price "Flete Montevideo=1500" --code FLE-MVD --unit viaje --note "hasta 3 km"
```

Así el próximo presupuesto ya lo tiene y no hay que volver a preguntar. Es la
mitad del valor de esto.

## Antes de cotizar, seis cosas que conviene saber

Esto **no frena el presupuesto**. El presupuesto sale igual y sale rápido: el que
llega primero gana seguido contra uno más barato que llega el martes. Es para
cuando el pedido viene en tres palabras —"pasame precio de una reforma"— y
cotizar cualquier cosa es tirar dos horas a la basura.

1. **Qué necesita resuelto**, no qué producto quiere. "Se me llueve el galpón" y
   "quiero 30 chapas" no se cotizan igual, y el segundo puede estar equivocado.
2. **Por qué pasa.** Lo que se rompe dos veces por año no se arregla con lo
   mismo que se rompió una vez.
3. **Qué le está costando hoy.** Días parado, un cliente que perdió, horas de
   alguien. Es contra eso que va a comparar el número, no contra cero.
4. **Quién más decide.** Si el que pregunta no es el que firma, el presupuesto
   tiene que poder leerlo alguien que nunca habló con vos.
5. **Por qué ahora.** Una fecha, una inspección, un local que abre. El plazo a
   veces vale más que el precio, y eso cambia lo que se cotiza.
6. **Qué pasa si no hace nada.** Si la respuesta es "nada", el presupuesto se va
   a quedar sin contestar. Mejor saberlo antes.

Preguntá **solo las que falten, todas juntas en un mensaje y una sola vez**. Si
no te contestan, cotizás con lo que hay y lo decís: *"lo armé para 30 chapas
como me pediste; si el problema es la filtración avisame y lo rehago"*.

## Cada presupuesto, el mismo camino

1. **Leé qué pidieron** y anotá lo que falta definir: cantidad, plazo, lugar de
   entrega. Si te mandaron una foto de lo que hay que cotizar, mirala vos.
2. **Cruzá contra la lista**, un `--item` por renglón, `referencia:cantidad`:

   ```bash
   python3 /opt/kit/skills/quotes/scripts/new_quote.py \
     --client "Ferretería del Este" --item "CEP-01:35" --item "flete montevideo:1"
   ```

   La referencia puede ser el código o el nombre del ítem. El script devuelve
   las líneas con su precio, las cuentas hechas, la validez, las condiciones y
   —lo importante— **`missing`**: lo que pidieron y no está en la lista.
3. **Si hay `missing`, preguntá.** El script no te va a numerar un presupuesto
   incompleto, y hace bien. La respuesta va a la lista (`--price`) y volvés a
   correr.
4. **Cuando no falta nada, numeralo:** agregá `--issue`. Recién ahí se gasta un
   número. Si es una corrección de uno que ya mandaste, va el mismo número con
   `--number P-2026-0007` y decís "rev. 2" en el cuerpo: dos números para el
   mismo trabajo son la forma más rápida de perder el rastro de qué aprobó tu
   cliente.
5. **Escribilo en el formato de tu cliente** —el orden de bloques que dice
   `formato.json`, con la estructura de `references/example.md`— y **dejalo como
   entregable**:

   ```bash
   python3 /opt/kit/skills/deliverable/deliver.py \
     --title "Presupuesto P-2026-0007 — Ferretería del Este" \
     --kind borrador --tags "presupuesto" <<'MD'
   ...el presupuesto entero, tal cual va a salir...
   MD
   ```

   Si el trabajo nació de un flujo, va con su `--flow`. Nombrá la referencia
   que devuelve en tu respuesta: el portal la convierte en un chip clicable.

## Lo que falta se pregunta, no se completa

De la identidad del rol, y no admite matices:

> **No cerrás un precio ni prometés una entrega sin aprobación.** Podés armar el
> presupuesto entero, con los números que te dieron y las cuentas hechas; lo que
> no podés es mandarlo.

Tres formas de inventar un precio, y las tres cuestan lo mismo:

- **Poner un número que no está en la lista.** Aunque sea "obvio", aunque lo
  hayas visto en otro presupuesto.
- **Descontar por tu cuenta.** Un descuento es plata del bolsillo de tu cliente,
  y la decisión es suya aunque el que pregunta parezca que se va. Cuando tu
  cliente SÍ lo autoriza, entra por el script —`--discount "10%" --reason
  "lo autorizó Juan por volumen"`— y sale como línea visible con su porqué,
  nunca como un precio retocado a mano.
- **Convertir de dólares a pesos con un tipo de cambio tuyo.** Si la lista tiene
  las dos monedas, el presupuesto sale con las dos o preguntás cuál va. El
  script no convierte nada, a propósito.

Lo que falta se dice en el presupuesto, no se rellena: *"el flete queda a
confirmar"* es una línea normal en un presupuesto y no le cuesta la venta a
nadie. Un número inventado, sí.

## Cuando dicen que está caro

- **"Está caro" es una pregunta, no un precio nuevo.** Antes de tocar nada:
  ¿está fuera de lo que tenía pensado gastar, o no se ve por qué vale eso? Son
  dos problemas distintos y solo uno se arregla con plata.
- **Lo que se puede dar y no es plata**: más plazo para pagar, el flete
  incluido, entregar en dos veces, un precio mejor si lleva más. Cuando le
  lleves esto a tu cliente, llevale las dos cosas —el descuento que piden y las
  alternativas— y no solo "quiere 10% menos". Decide él igual, pero decide entre
  opciones.
- **Si te dicen que tienen otro más barato, no lo desarmes**: preguntá qué
  incluye. La mitad de las veces no incluye lo mismo, y esa cuenta la tiene que
  hacer el que compara, no escucharla de vos.

## IVA, moneda y validez

Las tres líneas que separan un presupuesto de una lista de precios pegada en un
mail. Se preguntan **una vez** y quedan en `formato.json`:

- **IVA**: si los precios de la lista son `mas_iva` o `incluido`. El presupuesto
  lo dice siempre, con esas palabras. "Precio: 12.000" sin aclarar es una
  discusión asegurada el día que se factura.
- **Moneda**: `UYU` o `USD`. En Uruguay conviven, y la lista es la que manda.
- **Validez**: cuántos días vale. Un presupuesto sin fecha de vencimiento es un
  precio que te van a reclamar en marzo.

## Mandarlo no es tu decisión

El presupuesto **queda como entregable para que tu cliente lo mande**. Armarlo,
guardarlo y mostrarlo no necesita aprobación; que salga hacia afuera, sí.

Si además lo tenés que mandar vos —por mail, por WhatsApp, al que preguntó—
**eso pasa por la skill `approval`**: mostrás el texto exacto que va a salir,
esperás el sí, y recién ahí. Igual con cualquier cosa que comprometa a la
empresa: un plazo de entrega, una condición nueva, un descuento.

Y cuando se manda, anotalo: lo que sigue después es el seguimiento, que es donde
está la otra mitad de la plata.

## Si la lista quedó vieja

El script te avisa cuántos días hace que no se actualiza. Pasados unos meses,
decilo antes de mandar: *"la lista es de marzo, ¿los precios siguen igual?"*.
Es una pregunta de diez segundos que evita cotizar a precio de marzo en agosto.

## Cuándo NO usarla

Alguien pregunta por un precio suelto que ya está en la lista: contestás y
listo. No hay presupuesto que armar, ni número que gastar, ni entregable que
dejar. Un archivo por cada pregunta de mostrador es ruido, y el ruido hace que
después no se lea lo que importa.
