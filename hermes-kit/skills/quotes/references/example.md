# Un presupuesto entero, y qué hace cada bloque

Esto es la estructura, no la plantilla. **La plantilla es la del cliente**: el
orden que diga `secciones` en `formato.json`, sacado del presupuesto suyo que te
pasó. Si él pone las condiciones arriba, van arriba.

Lo que sí vale para todos: el que recibe esto está comparando tres presupuestos y
le dedica menos de un minuto a cada uno. Tiene que poder contestarse cuánto sale,
qué incluye y hasta cuándo vale, sin leer dos veces.

---

## El ejemplo

> **Taller San Martín**
> Presupuesto **P-2026-0007** — 19/8/2026
> Válido hasta el 3/9/2026
>
> **Para:** Ferretería del Este — Juan Pereyra
> **Por:** cepillado y lustrado del piso del local (85 m²), según lo hablado el 18/8.
>
> | Cant. | Detalle | Unitario | Subtotal |
> |---|---|---|---|
> | 85 m² | Cepillado de piso | $ 390 | $ 33.150 |
> | 85 m² | Lustrado con laca, dos manos | $ 1.250,50 | $ 106.292,50 |
> | 1 viaje | Flete Montevideo (hasta 3 km) | $ 1.500 | $ 1.500 |
>
> **Subtotal:** $ 140.942,50
> **IVA (22%):** $ 31.007,35
> **Total:** **$ 171.949,85**
> Los precios son **más IVA**, en pesos uruguayos.
>
> **Condiciones**
> - Forma de pago: 50% al confirmar, 50% contra entrega.
> - Plazo de entrega: 5 días hábiles desde la seña.
> - No incluye: corrimiento de mercadería ni reparación de tablas flojas.
> - El precio vale 15 días desde la fecha.
>
> Cualquier cosa quedo a las órdenes.
> Martín Suárez — Taller San Martín — 099 123 456

---

## Por qué cada bloque

**El encabezado con número y fecha.** El número es el que dio `--issue` y no se
repite nunca: es lo que te deja preguntar por el seguimiento sin ambigüedad ("te
escribo por el P-2026-0007"). La fecha define desde cuándo corre la validez.

**"Por:" en una línea.** Qué te pidieron, dicho como lo dijeron. Es lo que hace
que el que recibe reconozca su pedido y no le mande el presupuesto de otro a su
contador. Si hubo una conversación, se cita ("según lo hablado el 18/8").

**El detalle con cantidad y unitario.** El unitario a la vista es lo que hace
comparable y discutible el precio: sin él, un total grande parece arbitrario y la
respuesta es "está caro" en vez de "¿me sacás el flete?". Las cantidades y los
unitarios salen tal cual de lo que devolvió el script.

**Los totales, con el IVA dicho con todas las letras.** *Más IVA* o *IVA
incluido*, siempre, y la moneda escrita. En Uruguay `$` es pesos y `U$S` es
dólares: escribir `$` cuando eran dólares es un error de cuarenta veces el
precio. Si el presupuesto quedó con las dos monedas, van los dos totales
separados; no se convierte nada por cuenta propia.

**Las condiciones, y sobre todo "no incluye".** Es el bloque que más ventas
cierra y el que casi nadie escribe. Deja claro qué pasa después de que dicen que
sí —cuándo se paga, cuándo se entrega— y de paso evita la discusión que arruina
un trabajo bien hecho. Dos o tres líneas alcanzan.

**La validez.** Sin ella, el precio de agosto te lo reclaman en marzo. Va como
fecha concreta, no como "válido por 15 días": la fecha no hay que calcularla.

**El cierre con nombre y teléfono.** Una persona, no una empresa: el que quiere
preguntar algo tiene que saber a quién.

## Lo que falta se escribe, no se rellena

Si algo quedó sin precio y tu cliente todavía no contestó, el presupuesto sale
igual y la línea lo dice:

> | 1 | Retiro de la mercadería del local | **a confirmar** | — |
>
> El retiro queda a confirmar: lo cotizamos aparte apenas sepamos el volumen.

Eso es normal en un presupuesto y no le cuesta la venta a nadie. Un número
inventado, sí — y no se descubre el día que se manda, sino el día que se cobra.

## Si hay que corregirlo

Va **el mismo número** con `--number`, y el cuerpo dice qué cambió:

> Presupuesto **P-2026-0007 (rev. 2)** — 21/8/2026
> Reemplaza la versión del 19/8: se agrega el retiro de mercadería y se corrige
> el metraje a 92 m².

Dos números para el mismo trabajo es cómo se pierde el rastro de qué fue lo que
tu cliente aprobó, y de qué está esperando respuesta el que lo recibió.
