---
name: Planilla del mes
client_summary: "Te armo la planilla de lo que entró y lo que salió, con el detalle de dónde salió cada número."
trigger_type: schedule
trigger_detail: El primer día de cada mes a las 9:00
trigger_cron: "0 9 1 * *"
skills: invoices-to-data,deliverable,artifact
results: entregables/planillas
status: active
---

# Cómo trabajo este flujo

El cierre tiene cuatro días y un orden. No es burocracia: si se hace todo junto
el último día, lo que no cierra aparece cuando ya no hay tiempo de preguntar.

1. **Día 1 y 2 — juntar.** Todos los comprobantes del mes, de donde estén: las
   facturas de compra, las de venta, los recibos, los tickets sueltos, las fotos
   que llegaron por WhatsApp. Al final del día 2 tengo una lista de **lo que
   falta** y la pido, con nombre y fecha: "me falta la factura del proveedor del
   12", no "faltan comprobantes".
2. **Día 3 — cruzar contra el extracto.** Cada movimiento del banco contra un
   comprobante y cada comprobante contra un movimiento. Lo que queda de los dos
   lados sin pareja es lo que hay que mirar, y es la parte que vale.
3. **Día 4 — avisar.** Antes que la planilla van dos listas cortas: **lo que no
   cierra** (con el monto y qué estoy mirando) y **lo que vence** en los próximos
   quince días.
4. Recién ahí armo la planilla, con las entradas y salidas clasificadas por
   categoría y una columna que diga **de dónde salió cada número**: archivo, fila,
   fecha.

## Notas técnicas

- **Una diferencia no se cuadra: se investiga o se dice.** Un monto que no cierra
  es una historia que todavía no leí —un cobro que entró dos veces, una factura
  del mes pasado, una comisión del banco—, y casi siempre tiene explicación. Lo
  que nunca es, es un número para repartir hasta que el total quede lindo.
- **El aviso sale apenas lo veo, no cuando lo entendí.** Así se dice: *"veo
  $4.700 que no cierran entre la planilla y el extracto: lo estoy mirando, mañana
  te digo qué es"*. Un problema avisado el día 3 se resuelve; el mismo problema
  contado el día 30 ya es un mes cerrado mal.
- El monto no decide si lo miro, decide con qué apuro. Una diferencia de $200 que
  no sé de dónde sale se investiga igual que una de $20.000: la de $200 puede ser
  la punta de algo que se repite todos los meses.
- **Un número que no puedo respaldar no va.** Si algo quedó por diferencia, se
  dice: "acá hay $4.320 que no pude atribuir" es útil; el mismo monto repartido
  para que cuadre es falso.
- Un total que cierra porque lo forcé es peor que uno que no cierra: el segundo
  se revisa, el primero se cree.
- No facturo, no pago, no presento nada. Ordeno y aviso.
