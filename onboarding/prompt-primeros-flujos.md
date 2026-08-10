# El prompt de los primeros flujos

Se le pasa al cliente para que lo **pegue en el chat de su agente**, una sola vez,
cuando termina el onboarding del portal.

Sirve para el caso en que el cliente **todavía no sabe qué pedirle**. Si ya sabe
—porque viene de otra herramienta o ya tenía un flujo andando—, conviene que lo
describa él y no que el agente lo descubra: sale más preciso y en la mitad del
tiempo.

---

## Para copiar y pegar

```
Quiero que me ayudes a armar mis primeros flujos de trabajo.

Antes de proponerme nada, necesito que entiendas a qué me dedico. Preguntame
lo que te haga falta, pero de a UNA cosa por vez.

Cuando ya entiendas mi trabajo, proponeme entre tres y cinco flujos que te
parezcan los que más me van a servir. Para cada uno decime en una línea qué
haría, cada cuánto, y qué me vas a dejar a mí para revisar. Todavía no crees
nada.

Después los vamos viendo de a uno: yo te digo cuál, vos me hacés las preguntas
que te falten para ese, y recién ahí lo creás. Antes de crearlo, decime con qué
me vas a venir la primera vez, así sé qué esperar.

Cuando te dé un formato mío —cómo quiero que salga algo— guardátelo como una
habilidad tuya, para no tener que repetírtelo cada vez. Si después te pido
cambiarlo para todas las próximas, actualizalo; si es para una sola vez, no.

Y sé honesto: si algo de lo que se me ocurre no lo podés hacer con lo que tenés
conectado hoy, decímelo en el momento y decime qué haría falta. Prefiero tres
flujos que funcionen a cinco que queden a medias.

Arrancá preguntándome a qué se dedica la empresa.
```

---

## Por qué está escrito así

- **"de a UNA cosa por vez"** — un cuestionario de cinco preguntas se contesta
  entero en un párrafo, mal, o se contestan la primera y la última.
- **"todavía no crees nada"** — sin esto el agente crea los cinco de una y el
  cliente se encuentra con cosas corriendo que no entiende.
- **"decime con qué me vas a venir la primera vez"** — es la pregunta que
  convierte un flujo abstracto en algo evaluable *antes* de que corra.
- **"guardátelo como una habilidad tuya"** — el agente sabe escribir skills
  solo (verificado el 10/8/2026: frontmatter correcto, sin ayuda), pero no
  tiene por qué adivinar que un formato es permanente y no de una sola vez.
- **"si algo no lo podés hacer, decímelo"** — el agente tiende a acomodarse
  solo cuando le falta una conexión, en vez de avisar. Verificado el 8/8: le
  faltaba el correo y no preguntó, se las arregló.
