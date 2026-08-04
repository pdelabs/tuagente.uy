# Este plugin es provisorio y tiene fecha de vencimiento

**Hermes ya trae herramientas de kanban y son mejores que las nuestras.**
`tools/kanban_tools.py` registra doce (`kanban_show`, `kanban_create`,
`kanban_block`, `kanban_comment`, `kanban_complete`, `kanban_link`, adjuntos,
heartbeat), las usan sus propios workers, y están mejor pensadas: su `create`
**no expone el estado inicial**, así que la trampa del bloqueo pegajoso ni
siquiera es alcanzable — que era la razón principal por la que escribimos esto.

Además el cierre es deliberado, no un olvido. El comentario de su código dice
que las herramientas aparecen si sos un worker del dispatcher **o** si el perfil
es un orquestador que enruta trabajo por kanban; y hay una segunda condición que
le esconde `list` y `unblock` a los workers, para que cada uno cierre su tarea y
no ande enumerando el tablero ajeno. Es más fino que lo nuestro.

## Por qué sigue existiendo, entonces

Porque es lo único que **verificamos funcionando de punta a punta**
(2026-08-04): con este plugin, el agente encontró la herramienta y cerró un
ticket en 5 llamadas. Con el toolset de ellos habilitado vía
`toolsets: [kanban]` en `config.yaml`, el agente respondió *"No tengo disponible
kanban_show"* y volvió a improvisar con el terminal — pese a que el gate
(`_profile_has_kanban_toolset()`) devuelve `True` al evaluarlo a mano y a que el
presupuesto de esquemas sube de 50 a 70 KB al activarlo. **Algo entra, pero no
llega a la sesión.** Sospecha sin confirmar: el gateway resuelve la config por un
perfil distinto del `data/config.yaml` que editamos.

## Condición de borrado (no la ablandes)

Se elimina este plugin —del kit, del instalador y de los agentes— **el día que
el agente responda que sí tiene `kanban_show` y lo use en una tarea real**.
Hasta entonces es el camino que funciona y se queda.

Cuando eso pase, lo que sí conviene mandar upstream no es código: es el **issue
con la reproducción** de por qué `toolsets: [kanban]` no abre el gate en un
deploy con gateway. Eso le sirve a todo el mundo; un plugin paralelo, a nadie.

## Lo que aprendimos y no vive en este código

- La trampa del bloqueo pegajoso, demostrada con control: un ticket creado
  directamente en estado bloqueado se auto-promueve a `ready` en ~75 s; uno
  bloqueado con la acción de bloquear aguanta. Un pedido de aprobación creado
  "bloqueado" se lee como aprobado al minuto siguiente.
- **Las memorias del agente pisan cualquier herramienta que le des.** Este
  agente se había escrito solo *"Hermes CLI en esta sandbox: activar el venv,
  cd /opt/hermes, python -m hermes_cli.main…"* y seguía yendo al terminal aun
  con herramientas nativas disponibles. Corregir la memoria es parte de darle
  una herramienta nueva.
