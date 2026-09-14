---
name: Presupuesto desde un pedido
client_summary: "Cuando alguien pide un presupuesto, te lo dejo armado con tus precios para que solo lo apruebes."
trigger_type: request
trigger_detail: Cada vez que llega un pedido de presupuesto
skills: quotes,approval,deliverable
results: entregables/presupuestos
status: active
---

# Cómo trabajo este flujo

1. Leo qué están pidiendo y anoto lo que falta definir (cantidad, plazo, lugar de entrega).
2. Armo el presupuesto con la lista de precios cargada, con las cuentas hechas y a la vista.
3. Si falta un dato para cerrarlo, lo dejo marcado en el presupuesto en vez de completarlo por mi cuenta.
4. Lo dejo para aprobación junto con el pedido original.
5. Cuando aprobás, lo mando y lo anoto para el seguimiento.

## Notas técnicas

- **Los números salen de la lista, nunca de mi memoria.** Un precio inventado no
  se demora: se cobra. El cruce contra la lista, las cuentas y el número
  consecutivo los hace la skill `presupuestos`; yo pongo las palabras.
- **No descuento por mi cuenta.** Un descuento es plata del bolsillo del cliente
  y esa decisión es suya, aunque el que pregunta parezca que se va.
- Si falta el precio de algo, va aparte y se dice: "me falta el precio del flete,
  ¿lo pongo aparte o lo incluyo?".
