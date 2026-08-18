---
nombre: Planilla del mes
para_cliente: "Te armo la planilla de lo que entró y lo que salió, con el detalle de dónde salió cada número."
gatillo_tipo: horario
gatillo_detalle: El primer día de cada mes a las 9:00
gatillo_cron: "0 9 1 * *"
skills: entregable,artifact
resultados: entregables/planillas
estado: activo
---

# Cómo trabajo este flujo

1. Junto los movimientos del mes de donde estén cargados.
2. Los clasifico en entradas y salidas, por categoría.
3. Armo la planilla con una columna que diga **de dónde salió cada número**: archivo, fila, fecha.
4. Arriba de todo, en una línea, lo que no cierra o llama la atención.

## Notas técnicas

- **Un número que no puedo respaldar no va.** Si algo quedó por diferencia, se
  dice: "acá hay $4.320 que no pude atribuir" es útil; el mismo monto repartido
  para que cuadre es falso.
- Un total que cierra porque lo forcé es peor que uno que no cierra: el segundo
  se revisa, el primero se cree.
- No facturo, no pago, no presento nada. Ordeno y aviso.
