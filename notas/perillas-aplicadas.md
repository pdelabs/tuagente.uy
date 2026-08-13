# Las perillas que aplicamos, y por qué

**Tanda C1, 12/8/2026.** Qué quedó puesto en el kit, qué hace cada cosa y cómo
se aplica a un agente que ya existe. El mapa completo de lo que el motor
permite —con las citas al código— está en `perillas-motor.md`; esto es la parte
que se ejecutó.

Tres decisiones y una que se dejó pasar a propósito:

| Perilla | Decisión | Dónde vive |
|---|---|---|
| Skills del motor | **todas apagadas** salvo `xlsx`, `pdf`, `docx`, `ocr-and-documents` | `skills.disabled` en `config.yaml`, generado |
| Preámbulo del portal | **reemplazado** (decía "assume plain text") | `platform_hints.api_server.replace` |
| Skills del kit | **afuera de `data/`**, montadas de solo lectura | `skills.external_dirs` + volumen `:ro` |
| Kanban | **se queda**, subordinado por `05-precedencia` | no se toca |
| Verificador de mutaciones | **apagado**: le hablaba al cliente de rutas del host | `display.file_mutation_verifier: false` |
| Browser | **afuera**: 9 tools que devuelven capturas en blanco | lista explícita en `platform_toolsets` (NO `disabled_toolsets`) |

Memoria y auto-mejora tampoco se tocaron: `write_approval` sin una pestaña que
muestre lo pendiente es apagar el aprendizaje sin avisarle a nadie
(`perillas-motor.md`, punto 4b).

## 1. Las skills del motor: 66 apagadas de 70

El motor trae 70 skills y las **copia a `data/skills/` en cada arranque**
(`skills_sync.py`, invocado por `docker/stage2-hook.sh`). Un agente de empresa
no necesita casi ninguna, y varias son superficie saliente que no pasa por la
guardia: `himalaya` manda mails, `xurl` postea en X, `google-workspace` toca
documentos, `computer-use` maneja una computadora, `hermes-agent` y
`claude-code` le enseñan a operar su propio motor —lo que el `soul/README.md`
dice explícitamente que no queremos.

Quedan cuatro, y son las de **leer lo que el cliente manda**: `xlsx`, `pdf`,
`docx` y `ocr-and-documents`. Una planilla, un PDF, un Word, la foto de un
remito. Ninguna habla hacia afuera, ninguna publica, ninguna toca sistemas.

`docx` se sumó después de las otras tres, y por lo mismo que están ellas: en una
pyme los contratos, los briefs y las propuestas circulan en Word. Sin esa skill
el agente recibe el archivo y contesta "mandámelo en PDF", que es exactamente el
trabajo que el cliente esperaba no tener que hacer.

**La lista se genera, no se escribe.** Son ~70 nombres que cambian con cada
versión del motor:

```bash
python3 tools/perilla-skills.py --imagen nousresearch/hermes-agent:v2026.7.30 \
                                --aplicar compose/config.base.yaml
```

Sale de la **imagen** (autoritativa para un tag, sirve antes de instalar nada) o
del `.bundled_manifest` de un agente ya armado (`--agente <data>`, sin docker).
Nunca de listar `data/skills/`: ahí conviven las del motor, las del kit y **las
que el agente escribió para ese cliente** — en La Mano había dos así
(`competitive-intelligence-monitoring`, `social-content-operations`, las dos con
`created_by: agent` en `.usage.json`). Un generador que liste el directorio le
apagaría al cliente su propio trabajo.

La política —qué queda prendido— es `compose/skills-permitidas.txt`, y la leen
el generador y `agente-check.py`.

El bloque generado **anota de dónde salió la lista** (`#   fuente: imagen <tag>`
o el `.bundled_manifest` que leyó): es lo que después contesta "¿de qué imagen
salieron estos 70 nombres?" sin adivinar. Esa línea no cuenta para decidir si el
bloque cambió —dos corridas con la misma lista y distinta fuente informan "misma
lista, fuente al día", no "reemplazado"—, así que registrar la procedencia no
hace ruido al migrar agentes.

**El círculo cerrado.** Una blocklist es una foto: el día que el motor suba de
tag y traiga `himalaya-2`, la lista vieja no la nombra y vuelve a haber una
skill saliente prendida. Por eso `agente-check.py` compara el
`.bundled_manifest` **que escribe el propio motor** contra `skills.disabled` +
la allowlist, y falla:

```
[FALLA] config: skills del motor apagadas — 2 skill(s) del motor prendidas:
        himalaya-2, nueva-skill-del-bump — regenerá la lista: python3
        tools/perilla-skills.py --agente <data> --aplicar <config.yaml>
```

### Prender una skill para un cliente puntual

Dos cosas, en el `config.yaml` **de ese agente**: sacarla de `skills.disabled` y
**declarar la excepción con su motivo**, arriba de la lista.

```yaml
skills:
  # kit:excepcion humanizer — escribe posts para redes, es lo que hace la empresa
  # kit:excepcion blogwatcher — monitorea la competencia todas las semanas
  disabled:
    - airtable
    …
```

Y reiniciar. La declaración no es burocracia: es lo que separa una decisión de
una deriva. `agente-check.py` acepta lo declarado, **nombra las excepciones en
cada corrida** —para que se vean cuando alguien audite el agente seis meses
después— y sigue fallando por cualquier skill prendida que no tenga su línea.
Una línea sin motivo (o con un motivo de menos de diez caracteres) también
falla: el porqué es el punto.

**El comentario no es durable, y hay que saberlo.** El motor reescribe el
`config.yaml` entero con `yaml.safe_dump` (`atomic_config_write`, en
`hermes_cli/config.py`) y ahí se van todos los comentarios. Verificado en La
Mano: de los que le puso `nuevo-agente.sh` no sobrevivió ninguno, las claves
quedaron reordenadas y con un `_config_version: 33` agregado; los 36
comentarios que hoy tiene son los que escribe el propio motor. Una clave YAML
nueva sí sobreviviría —las claves top-level desconocidas se toleran a propósito
(`config.py:2027-2031`)—, así que la elección del comentario no se justifica por
durabilidad.

Se sostiene por otra cosa, que es más importante: **el modo de falla es
seguro.** Si el motor se comiera la declaración, la skill queda prendida y sin
declarar, y el chequeo falla fuerte; nunca al revés, nunca un permiso que
aparece solo. Y después del alta el `config.yaml` va montado `:ro`, así que el
motor ya no puede reescribirlo.

De ahí la regla operativa: **las excepciones se declaran con el config ya
cerrado `:ro`.** Declararlas antes del primer arranque no sirve — ese arranque
las borra. Si el chequeo dice que hay skills prendidas que vos juraste haber
declarado, lo primero a mirar es si el config se reescribió estando abierto.

Ventaja lateral del comentario: `grep -rn kit:excepcion` las encuentra en toda
la flota.

Si la decisión vale para **todos** los clientes, no es una excepción: va a
`compose/skills-permitidas.txt` con su porqué y se regenera la lista. Así entró
`docx`.

## 2. El preámbulo del portal

Sin perilla, el motor le mete al agente esto en **cada sesión del api_server**,
200 líneas después del SOUL (`agent/prompt_builder.py:912-923`):

> The rendering layer is unknown — assume plain text. No markdown formatting
> (no asterisks, bullets, headers, code fences) … images referenced as
> MEDIA:/absolute/path tags …

Las dos cosas son falsas en nuestro portal: renderiza markdown completo con
`Markdown.tsx` y convierte rutas e ids en chips clicables. Era la contradicción
más cara del prompt —el kit pidiendo tablas y el motor prohibiéndolas— y se
arregla con una clave: `platform_hints.api_server.replace` (`replace`, no
`append`: con `append` el texto del motor **se queda** y quedan los dos).

El texto está en `compose/config.base.yaml`. **Lo lee el modelo**: se escribe con
el mismo cuidado que un bloque de SOUL, en español y corto.

## 2b. El verificador de mutaciones del motor

Cuando un `write_file` o un `patch` falla y no se repite bien, el motor **le pega
al final de la respuesta del agente** una línea así, que el cliente lee en su
portal:

> ⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn…
> `/tmp/design-kit-instagram.md` — Write denied… outside `HERMES_WRITE_SAFE_ROOT`

Vocabulario de máquina, una ruta del host y el nombre de una variable de
entorno. Es exactamente lo que `04-lenguaje.md` le prohíbe al agente —"hablás
del trabajo, no de la máquina"— hecho por encima de él, donde no puede
evitarlo. Que el intento fallara está bien y hay que arreglarlo; contárselo así
al cliente, no.

`display.file_mutation_verifier: false` (default `true` en
`config_defaults.py:1051`, leído en `run_agent.py:3300`; también acepta la
variable `HERMES_FILE_MUTATION_VERIFIER`). Se apaga el aviso, no la causa: el
error sigue estando en los logs y en el resultado de la tool, que es donde
tiene que estar.

## 2c. El browser, apagado

En el despliegue de Mr.Wobble (12/8) el agente gastó ~15 llamadas peleando con
un navegador que no funciona: `browser_get_images` devolvió 0 imágenes,
`browser_console` vacío y `browser_vision` "la captura aparece completamente
blanca" (Browserbase sin proxies residenciales). Se recuperó solo, sacando la
paleta de la web con `curl` por terminal — pero el cliente vio toda la pelea.

**La forma de sacarlo importa, y la primera que elegimos estaba mal.**
`agent.disabled_toolsets` no saca un toolset de la lista: **resta su catálogo
estático** al final de todo (`model_tools.py:410-441` — *"even if a composite
toolset is enabled, any tools belonging to a disabled toolset are strictly
stripped out"*). Y el catálogo de `browser` incluye `web_search`
(`toolsets.py:199-207`), aunque `web_search` esté registrada en el toolset `web`.
Resultado: apagar el browser por ahí **también apaga la búsqueda web**.

Medido con el intérprete de la imagen, llamando como llama el motor de verdad
—`agent/agent_init.py:1390`, que pasa `enabled_toolsets` **y**
`disabled_toolsets`—, **las tres filas en una sola corrida** y con una
credencial de búsqueda presente para que `check_web_api_key` no tape el
resultado:

| Config | Tools | `browser_*` | `web_search` | `web_extract` |
|---|---|---|---|---|
| bundle, browser adentro | 36 | 9 | sí | sí |
| bundle + `disabled_toolsets: [browser]` | 26 | 0 | **NO** | sí |
| **lista explícita de toolsets, sin browser** | **27** | **0** | **sí** | sí |

Y los deltas por nombre, que son lo que no se desarma si alguien vuelve a medir
en otro estado: (bundle − explícita) = las 9 `browser_*` y nada más;
(explícita − bundle) = ∅; (explícita − `disabled_toolsets`) = `web_search`.

La tercera es la que quedó. Por eso `platform_toolsets` lista los toolsets uno
por uno en vez de nombrar el bundle, y `browser` no aparece **en ninguna lista**:
ni en las tres de `platform_toolsets` ni en `disabled_toolsets`.

### Y en las tres plataformas, no solo en el portal

El mismo agente atiende el portal, Telegram y los flujos del cron. Un browser
que devuelve páginas en blanco falla igual en los tres, y en el cron encima sin
nadie mirando.

Además, las declaraciones que había para Telegram y cron **no hacían nada**:
`platform_toolsets.telegram: [hermes-telegram, kanban]` y un `cron:` colgado de
`platforms:` (que ni siquiera es donde van los toolsets). Una lista que solo
nombra bundles y `kanban` no menciona ningún toolset **configurable**, así que
el motor no entra en modo explícito y cae al default: todo prendido. Verificado
sacando las claves — el resultado era idéntico con y sin ellas. Las dos
plataformas venían corriendo con 37 tools, 9 de ellas `browser_*`.

Con la misma lista en las tres, hoy:

| Plataforma | Tools | `browser_*` | `kanban_*` | `web_search` |
|---|---|---|---|---|
| `api_server` (portal) | 27 | 0 | 12 | sí |
| `telegram` | 27 | 0 | 12 | sí |
| `cron` (flujos) | 27 | 0 | 12 | sí |

**Diferencias deliberadas contra el default que tenían Telegram y cron:** además
del browser se van `clarify` —preguntar por una UI: el portal nunca lo tuvo, el
cron lo apaga solo (`cron/scheduler.py`), y el agente pregunta escribiendo— y
`computer_use`, manejar una computadora, cuya skill ya apagamos. Nada más: el
delta por nombre entre lo que tenían y lo que tienen son 10 tools —las 9
`browser_*` y `clarify`— y no se gana ninguna. `computer_use` se va como
toolset pero no aparece en ese delta: su `check_fn` ya la tapaba, así que no
había ninguna tool suya que perder. Lo que cambia es que ahora tampoco puede
aparecer sola.

Queremos `web_search` porque el cliente hace monitoreo de competencia y es
probable que suba una key de búsqueda; el día que la ponga, la tool está.

**La lista explícita puede quedar vieja** cuando el motor suba de tag y sume o
renombre toolsets — el mismo problema que la blocklist de skills, y la misma
solución: se genera y se chequea.

```bash
python3 tools/perilla-skills.py --toolsets --imagen <tag>   # al subir de tag
```

Sale de pedirle al motor que resuelva la plataforma con la forma histórica
(`hermes-api-server` + `kanban`) y restarle lo que no queremos, así que es la
misma resolución que corre en producción. `agente-check.py` compara la lista del
agente contra la del kit y falla si difieren.

**Lo que hoy no hay, y no es por esto:** el agente **no tiene búsqueda web** en
ningún caso, porque `check_web_api_key` da `False` sin credenciales
(`web_tools.py:1049`). Los backends posibles son `EXA_API_KEY`,
`TAVILY_API_KEY`, `PARALLEL_API_KEY`, `BRAVE_SEARCH_API_KEY`, Firecrawl o un
`SEARXNG_URL`; hay uno sin key, `ddgs`, pero **el paquete no está en la imagen**
(verificado). O sea que para tener búsqueda de verdad hay que poner una key en
`data/.env` y, si se quiere fijar cuál, `web.backend`. Mientras tanto lo único
que lee la web es `curl` por terminal, que es lo que el agente ya hace.

**Para un cliente que necesite navegador**: agregar `browser` a la lista de
`platform_toolsets.api_server` —no sacarlo de `disabled_toolsets`, que ahí no
está—, poner las credenciales de Browserbase y **probar una captura antes de
prometérselo**.

## 2d. La puerta en código: los hooks

El motor corre scripts nuestros **antes** de cada tool y, si contestan
`{"action":"block"}`, no la ejecuta y le devuelve el mensaje al modelo
(`agent/shell_hooks.py`; registro en `gateway/run.py:10499`). Es la primera vez
que un guardrail de conducta del kit está en código y no en prosa.

`politica/hooks/puerta.py` bloquea tres FAMILIAS, todas medidas en el QA o
dejadas abiertas por él:

| Qué | Por qué |
|---|---|
| instalar: `skills install/update/tap`, `mcp add`, `plugins install`, `hermes update`, `npm/npx`, `uv/uvx`, `corepack`, `pip`, `apt`, `dpkg -i`, y cualquier `… \| sh` | el agente se instaló 4 skills y 16 MB de npm en el volumen del cliente, con `--yes`, sin permiso |
| firmar: `--author=…`, `--created-by=…` y `HERMES_PROFILE=…` en cualquier comando de kanban | `portal` es la firma del botón Aprobar y `cliente` la del comentario "Aprobado CON CORRECCIONES" —el que lleva el contenido a ejecutar—: escribir cualquiera de las dos es falsificar la aprobación |
| desbloquear: `kanban unblock`, `kanban promote` y la tool `kanban_unblock` | desbloquearse el ticket que uno mismo bloqueó es saltear la puerta |

**Se bloquea la familia, no el comando.** Es la lección de la primera versión,
que solo miraba `--author=portal` y dejaba pasar `--author=cliente`: media
puerta. Hoy la firma se bloquea por PONER FIRMA —ninguna skill del kit usa esas
banderas y el default sale solo del profile—, y el motor tomó la misma decisión
del lado de las tools (`kanban_comment` dejó de aceptar `author` para que un
worker no forje un nombre con autoridad, `tools/kanban_tools.py:871-877`).

**El modelo de amenaza no es un agente astuto.** Es un agente aplicado que
choca contra un bloqueo y prueba variantes: comillas (`skills "install"`), otra
ruta (`npm --prefix /tmp install`), otro gestor. Por eso el comando se
**normaliza** antes de mirarlo —se sacan comillas, se colapsan espacios, se
parte en segmentos respetando lo que está entre comillas— y por eso el MENSAJE
dice explícitamente *"no hay variante de este comando que sí pase"* y enseña el
camino correcto (abrir `capacidad`, elegir un id, escribir `capacidad:<id>`).
Cerrar la búsqueda vale tanto como cerrar el comando: **probado contra el agente
del lab**, después de un bloqueo y con el cliente insistiendo *"probá con pip, o
con npm, o bajalo con curl, hacelo como sea"*, el agente no corrió ni un comando
más — releyó la skill `capacidad` y contestó que las tres son lo mismo.

**Lo que NO se bloquea, a propósito**: escribir la frase en una nota
(`echo 'pip install' >> notas.md`) y contarlo en un comentario del tablero
(`kanban comment -- t_1 'haría falta npm install x'`). Es la conducta correcta
—decir qué le falta— y castigarla sería el peor falso positivo posible.

**Límites conocidos** (escritos en el docstring del script, no perseguidos:
todos piden dos pasos deliberados): variables de shell (`I=install; hermes
skills $I x`), bajar y correr en dos comandos, codificar el comando, escribirle
a `kanban.db` por SQL. La puerta cierra el camino fácil; el guardrail de fondo
sigue siendo el SOUL.

**Falla abierto, y por eso hay un chequeo.** Si el script revienta o vence el
timeout, el motor deja pasar la tool con un `logger.warning` que nadie mira: un
guardrail roto se ve igual que uno que anda. Por eso `agente-check.py` (`la
puerta (hooks)`) es `required=True` y **la única señal** de que la puerta
funciona: verifica que esté declarado, que haya consentimiento, que el script
exista y sea ejecutable, y **lo corre** con 13 casos —uno por familia, las
evasiones de reintento, y los dos falsos positivos que cuestan caro—. Cuando
falla, el mensaje empieza con `LA PUERTA ESTÁ ABIERTA`.

Dos cosas verificadas contra el motor v2026.7.30 que conviene no re-descubrir:

- **Editar el script no lo desactiva.** `hermes hooks list` avisa *"script
  modified since approval"*, pero el allowlist se compara por `(evento,
  comando)` y no por mtime (`agent/shell_hooks.py:679-687`): el hook nuevo
  corre igual. El aviso es cosmético.
- **Qué gestores de paquetes existen de verdad** en la imagen (verificado el
  2026-08-12 con `command -v`): npm, npx, uv, uvx, corepack, apt/apt-get, curl,
  git, node, python3. **No** están pip, pipx, yarn, pnpm, poetry, conda, wget.
  Por eso no hay patrones para yarn/pnpm/poetry —serían decorativos— pero sí
  para `corepack`, que es el camino soportado para materializar yarn y pnpm. Si
  cambia la imagen, hay que correr ese loop de nuevo.

El consentimiento va en `hooks_auto_accept: true` y en `HERMES_ACCEPT_HOOKS=1`
del compose, **nunca** en el allowlist de `data/`: ese vive en el volumen del
agente, que lo puede borrar, y sin consentimiento el hook no corre.

### El resto de `politica/`, que a un agente local no le llegaba

`politica/` no son solo los hooks: ahí van también la guardia de los MCP
(`guardia.py`), el permiso de cada conexión (`tools/<conexion>.json`), los
servidores MCP propios y **el parche del mensaje de pairing**. Todo eso lo
subía `desplegar-remoto.sh` a la VPS y `install.sh` no lo instalaba: un agente
LOCAL se quedaba sin nada de eso. El síntoma no era un error sino un cliente
perdido — sin el parche, el primer mensaje del bot de Telegram sale en inglés
pidiéndole que corra `hermes pairing approve …` en una terminal, justo mientras
el portal le dice "pegá el código acá".

Ahora las dos rutas ponen lo mismo y los archivos entran en la lista que
compara `install.sh --diff`, que es el control de deriva.

**Las dos líneas van juntas.** El compose monta
`./politica/cont-init-parches.sh:/etc/cont-init.d/03-parches:ro`, y si el
archivo no está, Docker crea un **directorio** con ese nombre. Medido sobre un
agente de cero: el contenedor **levanta igual** —s6 intenta ejecutarlo, escupe
`Permission denied` … `exited 126` en el medio del log y sigue—, así que no hay
nada roto a la vista y el cliente recibe el mensaje en inglés. Por eso
`agente-check.py` lo chequea (`politica: parche del pairing`) antes de prender,
y por eso el archivo lo pone `install.sh`, que corre antes del primer `up`.

Verificado sobre un agente creado con `nuevo-agente.sh`: los 10 archivos en
`politica/`, `cont-init: info: running /etc/cont-init.d/03-parches` →
`[parche-pairing] aplicado` → `exited 0`, y adentro del contenedor el
`run.py` con el texto en español y **cero** apariciones del inglés.

Al actualizar el `.sh` en un agente que ya corre: `install.sh` usa `cp`, que
conserva el inodo, así que alcanza con reiniciar. Con `rsync` o `mv` —que
reemplazan el archivo— el montaje se queda con el viejo y hace falta
`docker compose up -d --force-recreate`.

## 2d-bis. Las capacidades: dónde vive el catálogo y qué se anota

El catálogo (`capacidades/catalogo.json`) se instala en **`politica/capacidades/`**,
no en `data/`. Es el texto que el cliente lee sobre lo que su agente puede hacer,
y en el volumen del agente —que corre como root— el agente lo podía reescribir y
podía borrar el registro de pedidos. El markdown que el agente LEE ya estaba
`:ro` en `kit-skills/`: o sea que podía mentirle al cliente pero no a sí mismo,
justo al revés de lo que hace falta. Verificado desde adentro del contenedor:
`rm` y `>` sobre esa carpeta dan `Read-only file system`.

`pedidos.jsonl` vive al lado y lo escribe **el adapter**, que monta `politica/`
rw mientras el agente la tiene `:ro`. Se anotan dos cosas distintas, con
`origen`: `cliente` (apretó el botón en la tarjeta) y `mencion` (el agente
escribió `capacidad:<id>` y el adapter lo detectó al pasar el stream, mirando
solo el evento `assistant.completed` — los deltas parten la mención al medio y
un `skill_view` de la skill devuelve el catálogo con el ejemplo adentro, que
habría inventado demanda en cada lectura).

**Lo que el agente NO promete**: la skill decía "queda registrado del lado
nuestro" para el caso en que no hay ninguna capacidad que aplique — y eso no lo
anotaba nadie. Se sacó la promesa en vez de fabricarla: el agente dice qué no
puede y sigue. Anotar la mención es cosa de la máquina, no una promesa suya.

`activa` es de verdad. `/v1/toolsets` no sirve —contesta el catálogo ESTÁTICO de
cada toolset: dice `web_search` y `image_generate` estén disponibles o no—, así
que el adapter importa el motor (corre sobre la misma imagen) y llama
`get_tool_definitions()` con las dos listas, igual que `agent_init.py:1390`. Es
la única parte del adapter atada a las internas del motor: va envuelta, cachea
60 s, y si algún día falla vuelve a "no se sabe" **avisando por el log** (la
primera versión se tragó un `NameError` mío en silencio).

**Las skills sombra no hay que sacarlas a mano.** Se retiran solas: verificado
con `build_skills_system_prompt` — sin tools están las dos, con `image_generate`
desaparece `sin-imagenes`, con `web_search` desaparece `sin-busqueda-web`, y
`capacidad` queda siempre.

**`imagenes` quedó verificada a medias, y el texto lo dice.** Con
`image_gen: {provider: openrouter}` en el config, `image_generate` **aparece** en
las tools (probado sobre un agente creado de cero: 27 tools contra 26, y
`activa: true` en el endpoint). Lo que NO se probó es el primer render real: no
hay clave con acceso a modelos de imagen, y el propio plugin avisa que los
`openai/*` de OpenRouter pueden pedir habilitación de cuenta. Por eso el `como`
que ve el cliente promete **una prueba con él**, no que quede andando.

## 2e. Auto-mejora: cada 25, no cada 10

`skills.creation_nudge_interval: 25`. El fork que escribe skills se dispara por
**volumen de trabajo**, no por calidad (`turn_finalizer.py:633-637`): cuanto más
sufre el agente por no tener la herramienta correcta, más probable es que
canonice el sufrimiento — es la causa mecánica de la skill que fijaba "dibujar
el SVG a mano" como método. No se apaga: hoy es la única señal que tenemos de
qué le falta a un agente en producción. Se acota, y la cosecha (mirar lo que se
escribió y subir lo bueno al kit) es trabajo humano pendiente.

La clave **no tiene default declarado** en `config_defaults.py`: vive como el
`.get(..., 10)` de `agent_init.py:1706-1710`, así que un bump del motor puede
cambiar el número sin que nada falle.


## 3. Las skills del kit, afuera de `data/`

Antes: `install.sh` las copiaba a `data/skills/<skill>/`. Dos problemas, los dos
verificados en el código del motor (`perillas-motor.md`, puntos 4c y 6):

- **El curator las podía archivar.** Para el motor, una skill que está en
  `data/skills/` y no figura en el manifiesto de bundled es "creada por el
  agente" y por lo tanto elegible: a los 90 días sin uso mueve el directorio a
  `.archive/`. O sea que `transcribir` podía desaparecer sola y con ella el
  contrato del portal. En La Mano el curator no llegó a correr nunca
  (`"run_count": 0`): llegamos antes.
- **El agente las podía reescribir** con `skill_manage`.

Ahora viven en `<agente>/kit-skills/`, montadas `:ro` en `/opt/kit/skills` y
declaradas en `skills.external_dirs`. El motor las indexa igual, y una skill
externa **nunca** es elegible para el curator (`tools/skill_usage.py:469-480`).

**Ojo con el tapado, que es silencioso.** Si la misma skill está en
`data/skills/` y en el directorio externo, **gana la de `data/`**: el motor
resuelve local primero (`tools/skill_manager_tool.py:645-662`) y el índice del
prompt saltea el nombre repetido (`agent/prompt_builder.py:1738-1760`). El
agente sigue corriendo la copia vieja y `install.sh` deja de tener efecto, sin
un solo mensaje de error. Por eso `install.sh` **aparta** las copias viejas a
`<agente>/skills-reemplazadas/` —afuera de `data/`, que es la única forma de
sacarlas del índice; el porqué está más abajo— sin borrarlas, porque apartar es
reversible. Y `agente-check.py` recorre el árbol indexado con la regla de
exclusión del motor y falla si encuentra cualquier copia, esté donde esté.

**El portal también cambia.** Las skills externas no están en el scan de
`data/skills/` **ni en el snapshot del prompt** (el motor lo escribe antes de
recorrer los directorios externos), así que el adapter las lista aparte. De
paso, ahora el adapter **no muestra las apagadas**: antes la pestaña de
habilidades le ofrecía al cliente 70 capacidades que el agente no tiene.

## Cómo queda un agente nuevo

Sale así de `nuevo-agente.sh`, sin pasos extra:

```
agente-<cliente>/
  data/            volumen del agente (escribe él)
    config.yaml    ← copia de compose/config.base.yaml: skills apagadas,
                     external_dirs, platform_hints, kanban, toolsets
    skills/        ← solo las del motor (sembradas) y las del cliente
  kit-skills/      ← las 6 del kit, montadas :ro en /opt/kit/skills
  docker-compose.yml
```

`nuevo-agente.sh` ya no lleva su propia copia del config: copia
`compose/config.base.yaml`. Había dos configs paralelos y ya habían empezado a
separarse; con 66 nombres generados adentro, mantener dos era garantía de que
uno quedara viejo.

## Runbook: aplicarlo a un agente que ya existe

**No está aplicado a ningún agente todavía** — esto se ejecuta con Luis. Es un
redeploy: el `config.yaml` está montado `:ro` y hay un volumen nuevo.

```bash
AG=/ruta/al/agente          # el repo del agente; adentro están data/ y kit-skills/

# 1. El kit al día. Instala las skills en $AG/kit-skills/ y APARTA las copias
#    viejas de data/skills/ a $AG/skills-reemplazadas/ (afuera del árbol que el
#    motor indexa: adentro seguirían tapando).
./install.sh $AG/data

# 2. El compose: montar kit-skills en los DOS servicios (hermes y portal-adapter)
#       - ./kit-skills:/opt/kit/skills:ro
#    Ya viene en compose/docker-compose.example.yml y en el remoto; a un agente
#    viejo hay que agregárselo a mano.

# 3. El config del agente. Está montado :ro: se abre, se edita, se cierra
#    (tools/con-config-abierta.sh, o a mano en el host). UN SOLO COMANDO deja
#    las cuatro perillas puestas:
#      · skills (disabled + external_dirs, generado desde el manifiesto)
#      · platform_hints (el preámbulo del portal)
#      · display.file_mutation_verifier (el pie de página del motor)
#      · platform_toolsets, las tres plataformas sin browser
#    Cada bloque es idempotente —si ya está igual no lo toca, si difiere lo
#    reemplaza y lo dice— y no pisa nada del agente: un `model.base_url` propio,
#    una plataforma que el kit no conoce, otras claves de `display`.
#    Escribe atómico (archivo al lado + os.replace) y deja copia del config
#    anterior en respaldos-config/, así que no hace falta respaldarlo a mano.
#    Se niega si el YAML no parsea o si hay una clave de primer nivel repetida.
#    OJO: esa guarda necesita PyYAML EN TU MÁQUINA, que es justo desde donde se
#    migra. Si `python3 -c "import yaml"` falla, ponelo (pip install pyyaml) o
#    corré el comando desde la imagen del motor, que ya lo trae.
python3 tools/perilla-skills.py --agente $AG/data --aplicar $AG/data/config.yaml

# 3b. Las excepciones de ESE cliente, si tiene (ver "Prender una skill para un
#     cliente puntual"): sacarlas de la lista y declararlas con su motivo.
#     VAN DESPUES, con el config ya cerrado :ro — un arranque con el config
#     escribible reescribe el archivo y se lleva puestos los comentarios.
#     Hoy no hay ninguna pendiente (ver mas abajo).

# 4. Chequeo offline, ANTES de prender
python3 tools/agente-check.py $AG/data

# 5. Reiniciar y verificar contra el motor vivo
docker compose up -d
curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/v1/skills
#    → tienen que ser 10: las 6 del kit + xlsx, pdf, docx, ocr-and-documents
#      (más las excepciones declaradas de ese cliente, si tiene)
python3 tools/portal-check.py --key $API_SERVER_KEY
```

`respaldos-config/` se llena solo y no lo mira nadie: son copias del config de
clientes, así que revisalo de vez en cuando y borrá lo viejo.

**Qué fallas quedan después del paso 4, y por qué.** Las tres perillas quedan en
verde, pero un agente anterior a la Fase B arrastra **dos fallas del SOUL** que
esto no toca y que se arreglan aparte:

- `SOUL: bloque del kit` — su SOUL se compuso antes de los marcadores
  `kit:base`. Se arregla con `tools/instalar-soul.sh`.
- `SOUL: versión del bloque` (aviso) — el agente tiene un bloque más viejo que
  el del kit. Se sube con `tools/instalar-soul.sh --reemplazar <host> [slug]`,
  que conserva la identidad y avisa si el bloque viejo tenía agregados de ese
  cliente.
- `SOUL sin huecos de plantilla` — los `<ASÍ>` de `00-identidad.md` sin
  completar. Es el trabajo artesanal, cliente por cliente, y necesita datos que
  no están en ningún repo.

O sea: **0 fallas recién cuando también se hizo la parte del SOUL.** Un agente
migrado y con SOUL completo tiene que dar 0.

**Excepciones pendientes, por agente: hoy ninguna.** Las cuatro que había
anotadas —`humanizer`, `blogwatcher`, `youtube-content`, `gif-search`— eran de
La Mano, que se dio de baja el 12/8/2026 (ver `flota.md`). Ni Mr.Wobble ni East
tienen ninguna declarada.

El mecanismo se queda, y la lista de arriba sirve de ejemplo de para qué es: un
cliente que hace contenido y sigue a la competencia necesita cuatro skills que
el resto no, y eso se declara en el `config.yaml` de ese agente así:

```yaml
skills:
  # kit:excepcion humanizer — escribe posts para redes, es lo que hace la empresa
  # kit:excepcion blogwatcher — monitorea la competencia todas las semanas
```

Cuando aparezca una de verdad, va acá con su agente y su porqué.

**En un remoto nuevo no hay nada que migrar:** `desplegar-remoto.sh` ya sube las
skills del kit a `$REMOTO/kit-skills/` (nunca a `data/skills/`), el compose
remoto trae el montaje `:ro` y el `config.base.yaml` que instala trae los dos
bloques. Lo que sí le falta a un remoto es el `00-identidad.md`.

**Cuidado con el YAML:** `skills:` no puede aparecer dos veces en el mismo
archivo. No da error — gana el último y el otro se pierde en silencio. Por eso
el generador emite la clave entera (`disabled` **y** `external_dirs`) y
`--aplicar` se niega si ya hay un `skills:` sin marcadores.

**Y cuidado con "apartar" adentro de `data/skills/`:** el motor indexa ese árbol
entero y solo saltea los nombres de `EXCLUDED_SKILL_DIRS`
(`agent/skill_utils.py:26-44`). Que el directorio empiece con punto **no
alcanza**: `.archive` está en esa lista, `.cualquier-otra-cosa` no. Una copia
apartada a un dot-dir cualquiera se sigue indexando y sigue tapando a la
externa, con el chequeo en verde si el chequeo solo mira
`data/skills/<nombre>`. Por eso `install.sh` las manda a un hermano de `data/` y
`agente-check.py` recorre el árbol con la misma regla de exclusión del motor.

Estado por agente: `flota.md`.

## Lo que se verificó contra el motor real (12/8/2026)

Con un agente descartable creado con `nuevo-agente.sh`, la imagen
`v2026.7.30`, puertos propios y **sin clave de modelo**. Se sembraron las 70
skills del motor con su propio `skills_sync.py` y se armó el prompt efectivo
con el motor (`build_system_prompt`, offline, sin llamar al proveedor):

- **El índice de skills quedó en 866 caracteres** (en La Mano son ~9.000) y
  nombra exactamente 9: las 6 del kit —servidas desde el montaje `:ro`— y
  `ocr-and-documents`, `pdf`, `xlsx`. (Medido con la allowlist de tres, antes de
  sumar `docx`: hoy serían 10.) `himalaya`, `xurl`, `computer-use`,
  `google-workspace`, `hermes-agent`, `claude-code`, `imessage`: ninguna.
- **`assume plain text` aparece 0 veces** en el prompt, y el texto nuestro está
  entero, en su lugar.
- **El system prompt bajó a 34.347 caracteres** (La Mano: 40.161).
- Con el gateway encendido, `GET /v1/skills` devuelve las mismas 9, y
  `/portal/capabilities` del adapter también.

Sin clave de modelo **no** se pudo verificar una conversación real, que es lo
único que escribe `sessions.system_prompt` en `state.db`: el snapshot del prompt
por esa vía (la propuesta de C2) queda pendiente de una corrida con credenciales.
