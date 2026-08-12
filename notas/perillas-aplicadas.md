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
#    (tools/con-config-abierta.sh, o a mano en el host). Un solo comando deja
#    los dos bloques: skills (disabled + external_dirs, generado) y
#    platform_hints (el preámbulo del portal, copiado de config.base.yaml).
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
