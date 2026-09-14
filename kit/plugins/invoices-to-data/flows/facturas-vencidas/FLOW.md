---
name: Facturas por vencer
client_summary: "Te aviso lo que vence, con tiempo para hacer algo."
trigger_type: schedule
trigger_detail: Todos los días a las 8:00
trigger_cron: "0 8 * * *"
skills: deliverable
results: entregables/vencimientos
status: active
---

# Cómo trabajo este flujo

1. Reviso qué vence en los próximos días y qué ya venció.
2. Ordeno por fecha: primero lo vencido, después lo que viene.
3. Dejo el aviso corto, con monto y a quién.

## Notas técnicas

- **Aviso con tiempo, no el día.** Un aviso el mismo día es una mala noticia;
  una semana antes es algo que todavía se puede resolver.
- Lo vencido no desaparece del aviso hasta que alguien lo marca resuelto: una
  factura vencida que dejó de aparecer se olvida.
- No pago ni gestiono nada. Aviso.
