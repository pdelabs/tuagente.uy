"""promesas — que el agente no pueda anunciar un flujo que no existe.

El motor llama a `transform_llm_output` UNA vez por turno, en
`hermes:agent/turn_finalizer.py:485-505`, con la respuesta final ya armada y
ANTES de guardarla y de mandarla. Lo que devolvemos acá reemplaza el texto: es
lo que se persiste en `state.db`, lo que viaja en `assistant.completed` y lo
que el portal dibuja en la burbuja (el portal pisa lo que streameó con ese
evento — `app/app/lib/agent.ts:997`). O sea que la corrección no se pierde ni
al refrescar.

POR QUE UN PLUGIN Y NO UN HOOK DE SHELL, que es lo que usa el resto del kit:
`agent/shell_hooks.py:580-620` solo sabe devolver `block` (pre_tool_call) o
`continue` (pre_verify) o `context`; un hook de shell NO puede reemplazar el
texto de la respuesta. Y `pre_verify`, que sería el lugar natural para hacerlo
reintentar, se dispara **solo si el turno editó archivos**
(`agent/conversation_loop.py:6808-6815`): el turno del bug no escribió nada
—miró skills y contestó—, así que ese camino no existía.

El plugin se carga por `plugins.enabled` en el config (que es :ro para el
agente) y vive en `politica/plugins/`, montado :ro en `/opt/data/plugins`: un
guardrail que el guardado puede cambiar no es un guardrail.

EL LIMITE, MEDIDO: lo que agregamos NO queda en el historial. `finalize_turn`
persiste la sesión en su línea 352 y recién transforma en la 485, así que
`state.db` guarda el texto original. Verificado contra un agente el 13/8: el
aviso llegó en el `assistant.completed` y el portal lo dibujó, pero
`GET /api/sessions/<id>/messages` devuelve el mensaje pelado. O sea que la
corrección se ve cuando llega y desaparece si el cliente refresca. Alcanza para
lo que importa —que se entere en el momento— y no se puede cerrar desde acá:
son dos líneas del motor (`notas/perillas-motor.md`, sección 8).
"""
import logging
import os

from . import promesas

logger = logging.getLogger(__name__)

DATA = os.environ.get("HERMES_HOME", "/opt/data")


def _revisar_respuesta(response_text=None, session_id="", platform="", **_):
    try:
        salida = promesas.con_aviso(response_text or "", DATA)
    except Exception:
        # Fallar acá no puede costarle la respuesta al cliente. Queda en
        # agent.log, que es donde se mira si el aviso dejó de salir.
        logger.warning("promesas: no pude revisar la respuesta", exc_info=True)
        return None
    if salida:
        logger.warning(
            "promesas: el agente anuncio algo corriendo solo que no existe "
            "(sesion=%s plataforma=%s) — le pegue la correccion",
            session_id, platform,
        )
    return salida


def register(ctx):
    ctx.register_hook("transform_llm_output", _revisar_respuesta)
