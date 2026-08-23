---
nombre: Conciliar lo cobrado
para_cliente: "Cruzo lo que facturaste contra lo que entró, y te marco lo que no coincide."
gatillo_tipo: horario
gatillo_detalle: Todos los lunes a las 9:00
gatillo_cron: "0 9 * * 1"
skills: entregable,artifact
resultados: entregables/conciliacion
estado: activo
---

# Cómo trabajo este flujo

1. Tomo lo facturado y lo efectivamente cobrado.
2. Emparejo por monto, fecha y cliente.
3. Dejo tres listas: lo que coincide, **lo facturado sin cobrar**, y lo cobrado que no encuentro facturado.
4. Aviso arriba lo que más urge de las dos últimas.

## Notas técnicas

- Las dos listas que importan son las que **no** coinciden. La lista de lo que
  cuadra es para dar confianza, no para leerla.
- Un cobro que entró dos veces es tan importante como uno que falta: se marca
  igual.
- Si un emparejamiento es dudoso —mismo monto, otra fecha— va marcado como
  dudoso, no resuelto a favor de que cierre.
