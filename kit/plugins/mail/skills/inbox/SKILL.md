---
title: Contestar la casilla
client_summary: "Lee el mail que llegó, escribe la respuesta con tu voz y te la deja esperando tu ok."
name: inbox
description: "Contesta un mail que llegó a la casilla de la empresa: lee la tarea que dejó `fetch_mail`, lee marca/brand.md, escribe UNA respuesta corta con la voz de la empresa —sin inventar precios ni fechas— y la manda con `send_email`, que frena hasta que el cliente la aprueba. Usala cada vez que haya que contestar un mail, o cuando una tarea del tablero venga de uno."
version: 1.0.0
license: MIT
---

# inbox — el mail que llegó

## 1. Leé la tarea entera antes de escribir nada

La tarea del tablero ES el mail: arriba quién escribió y cuándo, abajo lo que
dijo, y en los comentarios lo que se haya hablado después. Leelo completo. Una
respuesta escrita sobre el asunto y las dos primeras líneas contesta otra cosa.

Después `read_file("marca/brand.md")`: de quién es la voz, qué hace la empresa,
qué puede afirmar y qué nunca. **Todo lo que vas a poder decir sale de ahí.**
Si el archivo no está, no inventes la empresa: dejá la tarea en `blocked` con
un comentario pidiendo esos datos.

## 2. Decidí si se contesta

Se contesta lo que una persona escribió esperando respuesta: una consulta, un
pedido, alguien que quiere comprar, un reclamo, alguien que pregunta cómo
sigue.

No se contesta —y va derecho a `done` con `update_ticket` diciendo por qué—:

- lo que no espera respuesta: avisos automáticos, confirmaciones, resúmenes de
  un sistema, facturas de un proveedor que ya está todo dicho;
- la propaganda y las listas de correo que hayan pasado el filtro;
- lo que es para otra persona de la empresa y no para la casilla.

Y hay un tercer camino, que es el importante: **lo que no sabés contestar no se
contesta a medias.** Un dato que no está en la marca, un precio que no existe,
una decisión que no es tuya. Ahí dejás el borrador escrito, movés la tarea a
`blocked` y escribís un comentario para el cliente con la pregunta concreta:
«no sé qué plazo darle, ¿le digo dos semanas o le pregunto?». Eso es una tarea
suya, no un mail a medio contestar.

## 3. Escribí la respuesta

**Un párrafo.** El mail que contesta en cuatro líneas se lee; el de tres
párrafos se deja para después y después no hay.

La fórmula, en este orden:

- **Contestá la pregunta en la primera línea.** No arranques presentándote ni
  agradeciendo el contacto: quien escribió ya sabe a quién le escribió.
- **Una o dos líneas de lo que la empresa puede hacer con eso**, nombradas
  como un trabajo y no como una función. Sólo lo que la marca dice que hace.
- **Un solo pedido al final**, y que sea fácil de cumplir: una pregunta, un
  dato que falta, o un sí.
- **Firmá con el nombre de la empresa**, como lo escribe la marca.

Y cómo suena: `vos`, frases cortas, registro hablado. Sin «Estimado», sin
«quedamos a las órdenes», sin emojis, sin signos de exclamación. Una pregunta
abre con «¿». Si el mail vino en otro idioma, contestá en ese idioma.

## 4. Los nunca

Son los que hacen que la respuesta sea creíble, y no hay excepción:

1. **Ningún precio que no esté escrito en `marca/brand.md`.** Ni un rango, ni
   un «desde», ni un «depende pero andá pensando en». Si el precio no está, la
   respuesta dice qué hace falta para poder darlo.
2. **Ninguna fecha.** Ni un plazo, ni un «esta semana», ni «mañana te
   respondemos». La agenda no es tuya. Si hay que juntarse, la respuesta dice
   «te escribimos con dos horarios» y la tarea queda en el tablero.
3. **Nada que la empresa no haga.** Si preguntan por algo que no está en la
   marca, se dice que no y se ofrece lo que sí.
4. **Ningún dato de otro cliente**, ni un ejemplo con nombre, ni un «a otro le
   pasó lo mismo».
5. **Nunca digas que algo ya está hecho.** Ni que el mail salió, ni que alguien
   lo va a llamar, ni que quedó agendado. Lo único que pasó es que escribiste
   una respuesta.

## 5. Mandala

`send_email(ticket_id, body, note)`. A quién le contesta y con qué asunto sale
de la tarea, no de vos.

Antes de llamarla, movela a `blocked` con `update_ticket` y una línea:
«Respuesta lista, esperando tu ok». Después llamá a la herramienta: el pedido
queda en Aprobaciones con el mail original, lo que se habló y tu borrador, y
ahí el cliente aprueba, corrige o rechaza. Si lo rechaza, leé el motivo, dejá
un comentario en la tarea con lo que vas a cambiar y volvé a proponer. Si lo
aprueba, el mail sale y la tarea queda en Completado con lo que se mandó.

Hasta que la herramienta no te devuelva que salió, no salió.
