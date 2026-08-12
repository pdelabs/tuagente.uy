# Las perillas que aplicamos, y por qué

**Tanda C1, 12/8/2026.** Qué quedó puesto en el kit, qué hace cada cosa y cómo
se aplica a un agente que ya existe. El mapa completo de lo que el motor
permite —con las citas al código— está en `perillas-motor.md`; esto es la parte
que se ejecutó.

Tres decisiones y una que se dejó pasar a propósito:

| Perilla | Decisión | Dónde vive |
|---|---|---|
| Skills del motor | **todas apagadas** salvo `xlsx`, `pdf`, `ocr-and-documents` | `skills.disabled` en `config.yaml`, generado |
| Preámbulo del portal | **reemplazado** (decía "assume plain text") | `platform_hints.api_server.replace` |
| Skills del kit | **afuera de `data/`**, montadas de solo lectura | `skills.external_dirs` + volumen `:ro` |
| Kanban | **se queda**, subordinado por `05-precedencia` | no se toca |

Memoria y auto-mejora tampoco se tocaron: `write_approval` sin una pestaña que
muestre lo pendiente es apagar el aprendizaje sin avisarle a nadie
(`perillas-motor.md`, punto 4b).

## 1. Las skills del motor: 67 apagadas de 70

El motor trae 70 skills y las **copia a `data/skills/` en cada arranque**
(`skills_sync.py`, invocado por `docker/stage2-hook.sh`). Un agente de empresa
no necesita casi ninguna, y varias son superficie saliente que no pasa por la
guardia: `himalaya` manda mails, `xurl` postea en X, `google-workspace` toca
documentos, `computer-use` maneja una computadora, `hermes-agent` y
`claude-code` le enseñan a operar su propio motor —lo que el `soul/README.md`
dice explícitamente que no queremos.

Quedan tres, y son las de **leer lo que el cliente manda**: `xlsx`, `pdf`,
`ocr-and-documents`. Una planilla, un PDF, la foto de un remito. No hablan
hacia afuera, no publican, no tocan sistemas.

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

**Prender una para un cliente que la necesita:** sacarla de `skills.disabled` en
el `config.yaml` **de ese agente**, anotar en su repo por qué, reiniciar. Si la
decisión vale para todos, va a `compose/skills-permitidas.txt` y se regenera.
El chequeo mira la allowlist del kit, así que una excepción de un cliente le va
a fallar hasta que quede escrita — es a propósito: una skill saliente prendida
tiene que costar una línea de justificación.

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
separarse; con 67 nombres generados adentro, mantener dos era garantía de que
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

# 4. Chequeo offline, ANTES de prender
python3 tools/agente-check.py $AG/data

# 5. Reiniciar y verificar contra el motor vivo
docker compose up -d
curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/v1/skills
#    → tienen que ser 9: las 6 del kit + xlsx, pdf, ocr-and-documents
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
  `ocr-and-documents`, `pdf`, `xlsx`. `himalaya`, `xurl`, `computer-use`,
  `google-workspace`, `hermes-agent`, `claude-code`, `imessage`: ninguna.
- **`assume plain text` aparece 0 veces** en el prompt, y el texto nuestro está
  entero, en su lugar.
- **El system prompt bajó a 34.347 caracteres** (La Mano: 40.161).
- Con el gateway encendido, `GET /v1/skills` devuelve las mismas 9, y
  `/portal/capabilities` del adapter también.

Sin clave de modelo **no** se pudo verificar una conversación real, que es lo
único que escribe `sessions.system_prompt` en `state.db`: el snapshot del prompt
por esa vía (la propuesta de C2) queda pendiente de una corrida con credenciales.
