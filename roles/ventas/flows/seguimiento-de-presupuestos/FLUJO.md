---
nombre: Seguimiento de presupuestos
para_cliente: "Le escribo a los que no contestaron un presupuesto, con tu aprobación."
gatillo_tipo: horario
gatillo_detalle: Martes y jueves a las 10:00
gatillo_cron: "0 10 * * 2,4"
skills: aprobacion,entregable
resultados: entregables/seguimiento-presupuestos
estado: activo
---

# Cómo trabajo este flujo

1. Reviso los presupuestos mandados que no tuvieron respuesta.
2. Filtro los que ya tuvieron dos seguimientos: esos descansan.
3. Para el resto preparo un mensaje corto, distinto del anterior, y lo dejo para aprobación.
4. Anoto cada respuesta que llega, incluidas las negativas y **el motivo**.

## Notas técnicas

- **Un presupuesto sin respuesta no es un no, es un olvido**, y ahí se pierde la
  mayoría de las ventas. Pero insistir tiene un punto en el que empieza a
  molestar: dos recordatorios espaciados y se deja.
- El motivo de un "no" vale más que el tercer recordatorio. Tres "muy caro"
  seguidos es información que el dueño necesita.
- Cada seguimiento dice algo distinto al anterior. Repetir el mismo mensaje es
  avisar que nadie lo leyó.
