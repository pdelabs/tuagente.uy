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
que el agente escribió para ese cliente** — en La Mano hay dos así
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

## 3. Las skills del kit, afuera de `data/`

Antes: `install.sh` las copiaba a `data/skills/<skill>/`. Dos problemas, los dos
verificados en el código del motor (`perillas-motor.md`, puntos 4c y 6):

- **El curator las podía archivar.** Para el motor, una skill que está en
  `data/skills/` y no figura en el manifiesto de bundled es "creada por el
  agente" y por lo tanto elegible: a los 90 días sin uso mueve el directorio a
  `.archive/`. O sea que `transcribir` podía desaparecer sola y con ella el
  contrato del portal. En La Mano el curator todavía no corrió nunca
  (`"run_count": 0`), así que llegamos antes.
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
#     Pendientes anotadas hoy:
#       La Mano (pdelabs) → humanizer, blogwatcher, youtube-content, gif-search

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
- `SOUL sin huecos de plantilla` — los `<ASÍ>` de `00-identidad.md` sin
  completar. Es el trabajo artesanal, cliente por cliente, y necesita datos que
  no están en ningún repo.

O sea: **0 fallas recién cuando también se hizo la parte del SOUL.** Un agente
migrado y con SOUL completo tiene que dar 0.

**Excepciones pendientes, por agente.** Lo que hay que declarar cuando a cada
uno le toque el runbook:

| Agente | Skills a prenderle | Por qué |
|---|---|---|
| La Mano (pdelabs) | `humanizer`, `blogwatcher`, `youtube-content`, `gif-search` | hace contenido y monitorea a la competencia; las cuatro son de escribir y mirar, ninguna publica sola |

Las líneas quedan así en su `config.yaml`:

```yaml
skills:
  # kit:excepcion humanizer — escribe posts para redes, es lo que hace la empresa
  # kit:excepcion blogwatcher — monitorea la competencia todas las semanas
  # kit:excepcion youtube-content — arma guiones y descripciones de videos
  # kit:excepcion gif-search — ilustra los posts que escribe
```

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
