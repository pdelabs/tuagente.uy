---
name: Seguimiento de presupuestos
client_summary: "Le escribo a los que no contestaron un presupuesto, con tu aprobación."
trigger_type: schedule
trigger_detail: Martes y jueves a las 10:00
trigger_cron: "0 10 * * 2,4"
skills: approval,deliverable
results: entregables/seguimiento-presupuestos
status: active
---

# Cómo trabajo este flujo

1. Reviso los presupuestos mandados y **saco de la lista los que ya terminaron**.
   Un seguimiento no se apaga porque me acuerde: se apaga por una de estas
   cuatro y no hay quinta.
   - **Contestó**: cualquier respuesta corta la tanda, aunque sea "lo estoy
     mirando". De ahí en más es una conversación, no un recordatorio.
   - **Compró**: se cierra y pasa al alta de cliente.
   - **Pidió que no le escriba más**: se corta ese día, queda anotado que lo
     pidió, y no vuelve a entrar en ninguna tanda. Eso no se vence ni se olvida.
   - **Ya se hicieron los tres toques**: se cierra la carpeta y queda anotado
     "sin respuesta".
2. Para los que siguen abiertos miro cuántos toques llevan y de cuándo es el
   último: **toque 1 a los 3 días, toque 2 a los 10, cierre a los 21**. Antes de
   esos días no toco nada.
3. Preparo un mensaje corto, distinto del anterior, y lo dejo para aprobación.
4. El tercero es el de cierre y se escribe distinto: *"Te mandé el presupuesto
   hace tres semanas y no tuve novedades, que suele querer decir que ahora no era
   el momento o que lo resolviste por otro lado. ¿Te cierro la carpeta? Si más
   adelante lo necesitás, escribime y lo actualizo."* Conteste o no, con ese
   toque el presupuesto sale de la lista.
5. Anoto cada respuesta que llega, incluidas las negativas y **el motivo**.

## Notas técnicas

- **Un presupuesto sin respuesta no es un no, es un olvido**, y ahí se pierde la
  mayoría de las ventas. Pero insistir tiene un punto en el que empieza a
  molestar: dos recordatorios y un cierre, y se deja.
- **El mensaje de cierre es el que más contesta.** No es una amenaza ni una
  última oportunidad: es dar por terminado algo que quedó colgado, y por eso la
  gente responde. Va sin apuro y sin descuento de último momento.
- "No me escribas más" **se anota, no se cumple una vez**. Un contacto que
  volvió a entrar en una tanda porque nadie lo marcó es la única forma de que
  este flujo haga daño.
- El motivo de un "no" vale más que el tercer recordatorio. Tres "muy caro"
  seguidos es información que el dueño necesita.
- Cada seguimiento dice algo distinto al anterior. Repetir el mismo mensaje es
  avisar que nadie lo leyó.
