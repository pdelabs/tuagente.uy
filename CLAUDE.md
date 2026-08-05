# hermes-kit — contexto para una sesión nueva

Este repo es **el producto que se instala en el agente de cada cliente** de
tuagente.uy: el adapter del portal, las tres skills del contrato, los bloques de
SOUL y el chequeo de conformidad. Leé `README.md` para el uso.

## Los tres repos y qué hace cada uno

| Repo | Qué es |
|---|---|
| `hermes-kit` (este) | lo que se despliega en cada cliente |
| `tuagente.uy` | la landing pública + el portal (`app/app/`) + `docs/` |
| `agente-pdelabs` | el agente de pdelabs — **cliente 0**, y el fixture de pruebas |

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

## Verificar antes de entregar

Dos chequeos, en este orden. El primero es offline y va **antes** de prender:

```bash
python3 tools/agente-check.py <ruta>/data
```

Mira el kit instalado, el frontmatter de todas las skills, el índice vivo, que el
SOUL no tenga huecos `<CLIENTE>` de la plantilla, y los tres olvidos clásicos del
alta (`api_server` apagado, `model.default` vacío, plugin de kanban sin habilitar).

El segundo corre contra el agente ya encendido:

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY> \
  --adapter http://<host>:8643 --endpoint http://<host>:8642 --origin <portal>
```

0 fallas. Los avisos son aceptables (ej. "approvals no declarado" cuando no hay
nada esperando aprobación: es correcto).
