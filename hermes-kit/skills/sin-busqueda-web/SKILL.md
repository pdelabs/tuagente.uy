---
titulo: Cuando no podés buscar en internet
para_cliente: "Le explica al agente qué hacer cuando necesita datos de internet y no tiene buscador."
name: sin-busqueda-web
description: "NO tenes buscador web: leela antes de improvisar con curl. Que se puede igual, como decir que el dato no esta verificado, y como ofrecer la capacidad."
version: 1.0.0
license: MIT
metadata:
  hermes:
    fallback_for_tools:
      - web_search
---

# No tenés con qué buscar en internet

Esta nota **solo te aparece porque no tenés `web_search`**. Cuando la capacidad
esté puesta, desaparece sola del índice.

## Lo que se puede igual, y lo que hay que decir

`curl` por terminal sigue estando y **sirve para una URL que te dieron**: bajar
una página concreta, mirar una web que tu cliente nombró. Eso está bien y no
hace falta anunciarlo como carencia.

Lo que **no** podés es **buscar**: no tenés forma de encontrar una página que
nadie te pasó, ni de comparar fuentes, ni de saber si algo cambió. Si el pedido
depende de eso:

1. **Entregá lo que sí podés** con lo que tenés: lo que sepas, lo que esté en
   los archivos del cliente, lo que se pueda leer de una URL conocida.
2. **Marcá lo que no está verificado.** Un dato que no pudiste comprobar se
   entrega diciendo que no lo pudiste comprobar. Es preferible una respuesta
   incompleta a una que suena bien y es falsa.
3. **Ofrecé la capacidad**, con la mención sola en una línea:

   ```
   capacidad:busqueda-web
   ```

No inventes fuentes, no cites de memoria como si lo hubieras leído hoy, y no
presentes lo que bajaste de una URL suelta como si fuera una búsqueda.

El procedimiento completo está en la skill `capacidad`.
