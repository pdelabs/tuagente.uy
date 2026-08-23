# hermes-kit — contexto para trabajar en el kit

Este directorio del monorepo es **el producto que se instala en el agente de
cada cliente** de tuagente.uy: el adapter del portal, las skills, los roles,
los bloques de SOUL y el chequeo de conformidad. Leé `README.md` para el uso.
El resto del monorepo (la landing y el portal) tiene su contexto en el
`CLAUDE.md` de la raíz. Regla de la casa que aplica acá también: **código y
comentarios en inglés, siempre**; en español solo el texto que lee el cliente
o el agente para el cliente.

Hasta el 22/8/2026 esto era un repo aparte (`github.com/luisgurmendez/
hermes-kit`, hoy archivo); las rutas internas no cambiaron.

Hubo un tercero, `agente-pdelabs` —La Mano, el cliente 0 y el fixture de pruebas
de casi todo lo que está medido en `notas/`—, **dado de baja el 12/8/2026**: el
respaldo quedó en `~/Desktop/Luis/Projects/_respaldo-lamano/`. Para probar contra
un agente de verdad hay que desempaquetarlo o crear uno con `nuevo-agente.sh`.
Los agentes vivos están en `flota.md`.

**El kit es la fuente de la verdad.** Si arreglás el adapter o una skill mientras
depurás dentro de un agente, ese cambio hay que traerlo acá: `install.sh --diff`
lo detecta, pero solo si lo corrés.

## Principios que no se negocian

**El modelo pone las palabras; el código pone el formato.** Cada convención que
dependió de que el agente se acordara, falló. Las tres skills existen por eso:
el script decide ruta, nombre, CSS y estructura; el modelo aporta el contenido.

**Genérico por defecto.** Nada de un cliente puntual entra al kit. Lo específico
va en el SOUL de ese agente, que se compone a partir de las plantillas.

**Nunca SQL de escritura al kanban** — locks, claims y dispatcher se corrompen.
Las escrituras van por subprocess del CLI `hermes kanban ...` desde el sidecar.

## Trampas verificadas (están en el código, no las deshagas)

- **Bloqueo pegajoso:** un ticket vuelve solo a `ready` salvo que el último
  evento sea un `blocked` tipado. Crear con `--initial-status blocked` no deja
  ese evento → el pedido de aprobación se auto-desbloquea y la tarea sigue como
  si estuviera autorizada. Siempre `block --kind=needs_input`.
- **CLI:** opciones `--flag=valor` y `--` antes de los posicionales; si no,
  argparse rompe con valores que empiezan con `-`.
- **Frontmatter obligatorio** en cada `SKILL.md` (`name` + `description` que diga
  qué hace **y cuándo usarla**). Sin él se indexa con descripción vacía y el
  agente no la usa. Hermes reindexa solo, pero tarda unos minutos.
  Lo chequea `tools/agente-check.py`, y por algo: esta regla estaba escrita acá
  y aun así un agente en producción tenía sin frontmatter **la skill que manda
  mail a un lead**. Una regla que no chequea nadie no es una regla.
- **Archivos al browser: siempre `text/plain`.** El HTML de un artefacto viaja
  dentro del JSON y lo dibuja el portal en un iframe aislado.
- **Confinamiento:** todo path del cliente se resuelve con `resolve()` +
  `relative_to`, y en artefactos además se compara el padre — sin eso, un `.`
  borraba la carpeta entera.

## Las skills del motor van apagadas, y la lista se genera

El motor trae 70 skills y las copia al volumen en cada arranque. Quedan cuatro
—las de leer documentos: `xlsx`, `pdf`, `docx`, `ocr-and-documents`—, y un
cliente puntual puede tener alguna más si queda **declarada con su motivo** en
su config (`# kit:excepcion <skill> — <por qué>`, que el chequeo exige y
reporta). El resto se apaga con `skills.disabled`,
que **genera** `tools/perilla-skills.py` desde la imagen o desde el manifiesto
del agente — nunca listando `data/skills/`, que también tiene las del kit y las
que el agente escribió para ese cliente. Las del kit ya no viven ahí: van en
`<agente>/kit-skills/`, montadas `:ro` y declaradas en `skills.external_dirs`.
El porqué de cada perilla y el runbook para aplicarlo a un agente que ya existe:
`notas/perillas-aplicadas.md`.

## Capacidades: se piden, no se instalan

Cuando al agente le falta con qué (generar una imagen, buscar en la web), no
improvisa en silencio ni se instala nada: lo dice, y ofrece la capacidad con
`capacidad:<id>` — el portal la dibuja como tarjeta con el texto de
`capacidades/catalogo.json`, que es **cerrado** (lo que ya viene en la imagen
del motor + lo que escribimos nosotros; sin hub) y que se instala en
`politica/capacidades/`, no en `data/`: es texto que lee el cliente, y en el
volumen del agente el agente lo podía reescribir. El registro de pedidos
(`pedidos.jsonl`) vive al lado y lo escribe **el adapter**, que monta esa
carpeta rw mientras el agente la tiene `:ro`. El disparador no depende de
que el modelo se acuerde: las skills sombra (`sin-imagenes`,
`sin-busqueda-web`) aparecen en su índice **solo cuando le falta la tool** y se
retiran solas cuando está, con `metadata.hermes.fallback_for_tools`. Y la
puerta —instalar software, poner una firma que no es la suya (`--author`,
`--created-by`, `HERMES_PROFILE=`), desbloquearse solo— la cierra un hook en
`politica/hooks/`, no la prosa. Bloquea la **familia**, no el comando, y el
mensaje redirige a `capacidad` diciendo que no hay variante que pase: eso es lo
que evita que el agente siga probando. Detalle: `notas/perillas-aplicadas.md`.

## Lo que el agente dice que dejó corriendo se contrasta con el disco

El peor bug del producto no es que el agente falle: es que **diga que hizo algo
que no hizo**. Pasó el 13/8/2026 con una clienta que pidió un control semanal;
el agente contestó *"Queda definido: viernes a las 9:30"* y no llamó a
`crear_flujo.py` ni una vez. En Flujos seguía diciendo "Todavía no hay nada
corriendo solo". Si ella no iba a chequear, no se enteraba.

Por eso hay un plugin, `politica/plugins/promesas/`, que corre en
`transform_llm_output` —el único punto que ve la respuesta final **antes** de
guardarla y de mandarla (`hermes:agent/turn_finalizer.py:485-505`)— y contrasta
lo que la respuesta afirma contra `flujos/*/FLUJO.md` + `cron/jobs.json`. Si
dice que algo quedó armado y no hay flujo vivo que lo respalde, le pega al
mensaje una corrección que **afirma el hecho** (qué corre y qué no), nunca una
acusación: la detección de la frase es aproximada; el estado del disco, no.

Tres cosas de forma que valen para cualquier guardia que venga después:

- **Un hook de shell no servía.** `agent/shell_hooks.py` solo sabe devolver
  `block`, `continue` o `context`; ninguno toca el texto de la respuesta. Y
  `pre_verify`, que sería el lugar para hacerlo reintentar, se dispara **solo
  si el turno editó archivos** (`agent/conversation_loop.py:6808-6815`): el
  turno del bug no escribió nada.
- **Va en `politica/`, montado `:ro` sobre `/opt/data/plugins`**, que es donde
  el motor los busca (`hermes_cli/plugins.py:1369`) y que es del agente.
- **Se prende con `plugins.enabled`**: los plugins de usuario son opt-in, así
  que sin esa lista el motor lo descubre y no lo carga.

`agente-check.py` falla si falta cualquiera de las tres, y además le hace
correr la frase del bug: "está el archivo" no es "funciona".

## Las tools de kanban se habilitan con DOS claves

No hay plugin: Hermes ya las trae. Pero hace falta `toolsets: [kanban]` **y**
`platform_toolsets` con `kanban` en cada plataforma. Con una sola, el agente no
ve ninguna y improvisa con Python sobre su propio tablero. La receta completa, la
reproducción y por qué no era adivinable están en `notas/kanban-nativo.md`.
Lo chequea `tools/agente-check.py`.

## La version del motor va fija

El compose apunta a un tag concreto (hoy `v2026.7.30`), nunca a `latest`: con
`latest`, un push de Nous le cambia el motor a todos los clientes de un dia
para el otro y nos enteramos por un ticket que falla. Al 5/8/2026 los agentes
corrian v2026.7.30 mientras `latest` ya iba dos versiones adelante.

Para subir: cambiar el tag, `docker compose pull && up -d`, correr
`agente-check.py` y `portal-check.py`, y recien ahi darlo por bueno. Si algo se
rompio, se vuelve al tag anterior.

## El bloque de SOUL también tiene versión

Los bloques genéricos van envueltos entre `<!-- kit:base vN -->` y
`<!-- /kit:base -->`, con la versión que dice `soul/VERSION`. Con eso se sabe qué
reglas corre un agente sin leerle el prompt entero, `instalar-soul.sh` no pisa lo
que ya está, y `05-precedencia.md` puede decir qué gana cuando el documento se
contradice. Quién tiene qué versión: `flota.md`. El detalle: `soul/README.md`.

Corolario: **un cambio en `soul/` no llega solo a ningún agente.** Hay que subir
`soul/VERSION` y reinstalar; `agente-check.py` avisa quién quedó atrás.

## Verificar antes de entregar

Dos chequeos, en este orden. El primero es offline y va **antes** de prender:

```bash
python3 tools/agente-check.py <ruta>/data
```

Mira el kit instalado, el frontmatter de todas las skills, el índice vivo, los
tres olvidos clásicos del alta (`api_server` apagado, `model.default` vacío,
plugin de kanban sin habilitar) y cinco cosas del SOUL: ningún hueco `<ASÍ>` sin
llenar, ningún comentario HTML con las palabras que hacen que el motor descarte
el archivo entero, el bloque `kit:base` presente y balanceado, qué versión tiene
puesta contra la del kit, y que haya identidad. De paso avisa si el `soul/VERSION`
del kit no tiene forma de versión.

Y las perillas: que el motor no le pegue su pie de página a la respuesta
(`display.file_mutation_verifier`), que el browser quede afuera **por la lista
de `platform_toolsets`** —sacarlo con `disabled_toolsets` se lleva puesto
`web_search`, que está en el catálogo de `browser`—, que **ninguna skill del
motor** quede
prendida fuera de las cuatro de documentos o de lo declarado para ese cliente
(compara contra el
`.bundled_manifest` que escribe el motor, así que un bump que traiga skills
nuevas falla en vez de pasar), que `platform_hints.api_server.replace` esté
puesto, y que las skills del kit estén montadas afuera de `data/` y **sin copia
vieja que las tape**.

Sobre un SOUL suelto —o sobre un bloque que todavía no instalaste— corren los dos
chequeos de texto solos:

```bash
python3 tools/agente-check.py --revisar <archivo>.md
```

El segundo corre contra el agente ya encendido:

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY> \
  --adapter http://<host>:8643 --endpoint http://<host>:8642 --origin <portal>
```

0 fallas. Los avisos son aceptables (ej. "approvals no declarado" cuando no hay
nada esperando aprobación: es correcto).
