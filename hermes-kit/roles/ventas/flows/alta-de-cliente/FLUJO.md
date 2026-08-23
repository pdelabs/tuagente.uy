---
nombre: Alta de cliente nuevo
para_cliente: "Cuando le vendés a alguien nuevo, lo dejo cargado en tu planilla con todo lo que hace falta."
gatillo_tipo: pedido
gatillo_detalle: Cada vez que se cierra una venta con alguien nuevo
skills: entregable,artifact
resultados: entregables/clientes
estado: activo
---

# Cómo trabajo este flujo

1. Junto lo que ya sé de la conversación: nombre, contacto, qué compró, a qué precio.
2. Marco lo que falta para poder facturarle (RUT, dirección, forma de pago).
3. Lo agrego a la planilla de clientes, sin pisar lo que ya estaba.
4. Aviso qué quedó incompleto para que se pida antes de la primera factura.

## Notas técnicas

- **Nunca piso una fila que ya existe.** Si el cliente ya estaba, agrego lo nuevo
  y marco la diferencia; sobrescribir es perder el historial de alguien.
- Los datos fiscales no se adivinan ni se completan "provisorio": o están o
  faltan, y si faltan se dice.
- La planilla es de la empresa. Va al lugar compartido, no a un archivo mío.
