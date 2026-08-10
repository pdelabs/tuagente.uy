# El prompt de los primeros flujos

Se le pasa al cliente para que lo **pegue en el chat de su agente**, una sola vez,
cuando termina el onboarding del portal.

**Está escrito para alguien que contesta por voz.** Eso cambia todo el diseño:
nada de listas, nada de formatos, nada de "pegame el link". Una pregunta por
vez, y el agente repite lo que entendió antes de hacer nada — porque Whisper
transcribe mal los nombres propios y las marcas, y un flujo creado sobre una
palabra mal entendida se descubre una semana después.

---

## Para copiar y pegar

```
Quiero que me ayudes a armar mis primeros flujos de trabajo.

Antes de proponerme nada, necesito que entiendas a qué me dedico. Preguntame
lo que te haga falta, pero de a UNA cosa por vez: te voy a contestar hablando,
así que nada de listas ni de cuestionarios largos.

Tres cosas más sobre cómo hablarme:

- Cuando te diga un nombre propio, una marca o un cliente, repetímelo escrito
  para que yo te confirme. Estoy dictando y se transcribe mal.
- Si algo te quedó a medias, volvé a preguntarme. Prefiero que preguntes antes
  y no que adivines.
- No me pidas que te pegue links ni archivos mientras hablamos. Anotá qué te
  falta y me lo pedís todo junto al final.

Cuando ya entiendas mi trabajo, proponeme entre tres y cinco flujos que te
parezcan los que más me van a servir. Para cada uno decime en una línea qué
haría, cada cuánto, y qué me vas a dejar a mí para revisar. Todavía no crees
nada.

Después los vamos viendo de a uno: yo te digo cuál, vos me hacés las preguntas
que te falten para ese, y recién ahí lo creás. Antes de crearlo, decime con qué
me vas a venir la primera vez, así sé qué esperar.

Y sé honesto: si algo de lo que se me ocurre no lo podés hacer con lo que tenés
conectado hoy, decímelo en el momento y decime qué haría falta. Prefiero tres
flujos que funcionen a cinco que queden a medias.

Arrancá preguntándome a qué se dedica la empresa.
```

---

## Por qué está escrito así

- **"de a UNA cosa por vez"** — dictar una respuesta a cinco preguntas es
  insoportable, y se contesta la primera y la última.
- **"repetímelo escrito"** — Whisper transcribe mal nombres propios y marcas.
  Un flujo armado sobre una palabra mal entendida se descubre una semana
  después, cuando llega el primer entregable con el nombre cambiado.
- **"no me pidas links mientras hablamos"** — no se pega un link hablando. Que
  el agente los junte y los pida todos juntos al final.
- **"todavía no crees nada"** — sin esto el agente crea los cinco de una y el
  cliente se encuentra con cosas corriendo que no entiende.
- **"decime con qué me vas a venir la primera vez"** — es la pregunta que
  convierte un flujo abstracto en algo evaluable *antes* de que corra.
- **"si algo no lo podés hacer, decímelo"** — el agente tiende a acomodarse
  solo cuando le falta una conexión, en vez de avisar. Verificado el 8/8: le
  faltaba el correo y no preguntó, se las arregló.
