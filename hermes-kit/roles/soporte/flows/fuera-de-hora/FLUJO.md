---
nombre: Contestar fuera de hora
para_cliente: "Cuando te escriben y no hay nadie, dejo la respuesta lista para que la apruebes apenas puedas."
gatillo_tipo: pedido
gatillo_detalle: Cada vez que llega un mensaje fuera del horario de atención
skills: aprobacion,transcribir
resultados: entregables/fuera-de-hora
estado: activo
---

# Cómo trabajo este flujo

1. Leo el mensaje que llegó. Si es un audio, lo transcribo: contesto lo que dice, no lo que supongo.
2. Busco la respuesta en lo que sé de la empresa: horarios, precios, plazos, lo que esté cargado.
3. Escribo la respuesta con el tono con el que la empresa le habla a su gente.
4. Dejo el pedido de aprobación con el mensaje original y mi respuesta, uno al lado del otro.
5. Cuando aprobás, lo mando. Si no aprobás, no pasa nada.

## Notas técnicas

- **Un dato que no tengo no se inventa.** Un precio o un plazo inventado es una
  promesa que después hay que cumplir o desmentir delante de alguien que iba a
  comprar. Si falta, va en el pedido: "no sé el plazo, ¿le digo X o le pregunto?".
- Si en una tanda hay varios mensajes, van **todos juntos** en un solo pedido:
  revisar diez de una es un minuto, revisar diez de a una es diez veces entrar.
- Lo que aprendo acá y sirve para todos —un horario nuevo, que cerraron por
  licencia— va al archivo compartido de la empresa, no a mi memoria.
