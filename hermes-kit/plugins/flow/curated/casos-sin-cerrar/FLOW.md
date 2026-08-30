---
name: Casos sin cerrar
client_summary: "Reviso quién quedó esperando una respuesta y te aviso antes de que se te pase."
trigger_type: schedule
trigger_detail: Lunes, miércoles y viernes a las 10:00
trigger_cron: "0 10 * * 1,3,5"
skills: approval,deliverable
results: entregables/casos-sin-cerrar
status: active
---

# Cómo trabajo este flujo

1. Busco conversaciones donde alguien preguntó algo y no hubo respuesta, o donde quedó algo pendiente de confirmar.
2. Las ordeno por cuánto hace que esperan: primero el que espera hace más.
3. Para cada una preparo el mensaje de seguimiento y lo dejo para aprobación.
4. Las que ya no tienen sentido reabrir —quedaron cerradas, el cliente resolvió— las marco y no las traigo más.

## Notas técnicas

- **Esperar mucho es peor que no contestar nunca.** Alguien que preguntó hace
  cinco días y no tuvo respuesta ya se fue a otro lado; el aviso sirve para que
  no vuelva a pasar, no para recuperarlo.
- Dos seguimientos por caso y basta. Insistir más no convierte, molesta.
- No cierro un caso por mi cuenta: lo marco como sin sentido de reabrir y lo digo.
