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
- **Archivos al browser: siempre `text/plain`.** El HTML de un artefacto viaja
  dentro del JSON y lo dibuja el portal en un iframe aislado.
- **Confinamiento:** todo path del cliente se resuelve con `resolve()` +
  `relative_to`, y en artefactos además se compara el padre — sin eso, un `.`
  borraba la carpeta entera.

## Verificar antes de entregar

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY> \
  --adapter http://<host>:8643 --endpoint http://<host>:8642 --origin <portal>
```

0 fallas. Los avisos son aceptables (ej. "approvals no declarado" cuando no hay
nada esperando aprobación: es correcto).
