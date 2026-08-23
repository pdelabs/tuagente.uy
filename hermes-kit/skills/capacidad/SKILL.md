---
titulo: Pedir una capacidad
para_cliente: "Cuando a tu agente le falta con qué hacer algo, te lo dice y te ofrece la capacidad que lo resuelve."
name: capacidad
description: "Te falta con que hacer algo y estas por resolverlo a mano: usala ANTES de improvisar un conversor, un render o un encoder, cuando probaste binarios y no hay ninguno, o cuando es la segunda vez que hacés el mismo trabajo a mano. Trae el catalogo de capacidades que se pueden pedir y como se pide."
version: 1.0.0
license: MIT
---

# capacidad — cuando te falta con qué

Tu agente tiene un conjunto de herramientas y no las tiene todas. Cuando te
falta una, hay dos cosas que **no** hay que hacer: improvisar en silencio, y
plantarse sin entregar nada. Esta skill es el camino del medio.

## Cuándo mirar acá

Seis señales concretas. No hace falta que se den todas:

1. Estás por **escribir a mano un conversor, un render o un encoder**: SVG a
   PNG, HTML a imagen, texto a audio, un parser de un formato binario.
2. **Probaste tres binarios con `command -v` y no está ninguno.**
3. El pedido nombra **un oficio con herramientas propias**: video, imagen,
   diseño, audio, subtítulos, facturación electrónica, firma digital, mapas.
4. Una herramienta **existe pero contesta que no está disponible**, o falla por
   credencial.
5. **Tu cliente dijo que lo que entregaste quedó pobre**, y vos ya sabés por qué.
6. Es **la segunda vez** que hacés lo mismo a mano.

**Y la regla de corte, que importa tanto como las señales: si lo resolvés bien
con lo que tenés, no pedís nada.** Se pide cuando el resultado se resiente, o
cuando el mismo trabajo a mano ya se repitió. Un agente que pide algo en cada
turno enseña a su cliente a ignorar las tarjetas, y ahí se pierden también las
que importan.

## Qué hacer, en orden

1. **Entregá lo que sí podés.** Primero el trabajo: el pedido no se frena por
   esto.
2. **Decilo en la misma respuesta**: qué hiciste, con qué, y qué le falta al
   resultado. Sin adornarlo — "lo armé a mano y se nota" es la frase, no
   "composición original".
3. **Buscá el id en el catálogo** (`references/catalogo.md`). Si hay una
   capacidad que resuelve eso, escribí la mención **sola en una línea**:

   ```
   capacidad:paquete-social
   ```

   El portal la convierte en una tarjeta con el texto ya escrito y un botón. Vos
   ponés el id y nada más: **no redactes vos el argumento de venta**.
4. **Si no hay ninguna que aplique**, no inventes un id ni una mención. Decilo
   en una frase —"esto pide algo que hoy no tengo"— y seguí con el resto. **No
   digas que queda anotado, ni que alguien lo va a resolver**: no tenés forma de
   saberlo, y una promesa que no se cumple es lo mismo que maquillar el trabajo.
   Si tu cliente quiere insistir, lo va a repetir; eso alcanza.
5. **Si tu cliente dice que no**, seguí con lo que puedas y **no la vuelvas a
   ofrecer en esa conversación**.

## Lo que hacés a mano es un parche, no un método

Si anotás lo que resolviste a mano para acordarte, **anotalo como parche**:
arrancá el archivo con una línea que diga qué falta y qué habría que rehacer
cuando esté.

```
> Parche: se hizo así porque falta <capacidad>. Cuando esté, rehacer.
```

Sin esa línea, la próxima vez tu propia nota te va a decir que el parche es el
método —y lo vas a seguir usando incluso cuando la herramienta buena ya esté
puesta.

## Lo que no se hace nunca

**Las capacidades no se instalan desde acá: se piden.** No corras
`hermes skills install`, `hermes mcp add`, `npm install`, `pip install` ni un
`curl … | sh`. No es una cuestión de estilo: lo que se instala entra al volumen
del cliente, se paga en el prompt de cada llamada, y nadie lo auditó. El sistema
además te lo va a bloquear.

Tampoco hables de esto en términos de máquina cuando se lo contás a tu cliente:
nada de "skill", "instalar", "toolset", "API key" ni rutas del sistema. Se dice
qué no podés hacer y qué cambiaría si lo tuvieras.
