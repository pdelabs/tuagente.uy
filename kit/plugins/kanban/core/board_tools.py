"""The two tools the face gets: open a ticket, and move or annotate one.

NOT GATED. A ticket is internal — writing one down changes nothing outside the
client's own portal — and the gate is for what the agent does outwards. What it
DOES do is leave a trail: every call writes an event with the ticket's id and
the session it was made from, which is what lets a run be traced back to the
ticket that asked for it.

THE MODEL SUPPLIES THE WORDS AND THE CODE SUPPLIES THE FORMAT, here as
everywhere: the id, the status vocabulary, the dedupe and the events are this
file's; the title, the body and what gets said on the ticket are the model's.
"""

from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

import board_store as board


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def create_ticket(
        ctx: RunContext,
        title: str,
        body: str,
        source: str | None = None,
        source_ref: str | None = None,
    ) -> str:
        """Abrir una tarea en el tablero de tu cliente.

        Usala cuando lo que hay que hacer no se termina en esta respuesta: un
        pedido que hay que seguir, alguien que quiere comprar, trabajo que va a
        llevar más de una vuelta. Una pregunta que ya contestaste acá no es una
        tarea, y una tarea que abrís «por las dudas» es ruido en el tablero.

        Te devuelve el id. Nombralo tal cual en tu respuesta —`t_ab12cd34ef56`—:
        el portal lo convierte en un link a la tarea.

        Args:
            title: de qué se trata, en una línea, como lo diría el cliente.
            body: el detalle: qué pidieron, con qué palabras, y lo que sepas
                que hace falta para resolverlo.
            source: de dónde salió, si salió de algún lado: el nombre del
                plugin que la trajo (`mail`, `instagram`). Si la abrís vos,
                dejalo vacío.
            source_ref: la clave de ese lado —el id del mensaje, el del
                comentario—, para no abrir dos veces la misma. Si ya hay una
                tarea con ese par, te devuelvo esa.
        """
        ticket_id, opened = board.create(
            title=title,
            body=body,
            source=source or board.FROM_AGENT,
            source_ref=source_ref,
            session_id=ctx.deps.session_id,
        )
        if not opened:
            return f"Eso ya estaba en el tablero: {ticket_id}. No abrí otra."
        return f"Abrí la tarea {ticket_id}."

    @ts.tool
    def update_ticket(
        ctx: RunContext,
        ticket_id: str,
        status: str | None = None,
        comment: str | None = None,
    ) -> str:
        """Mover una tarea del tablero, dejarle un comentario, o las dos cosas.

        Movela cuando cambió de verdad: **nunca digas que algo está hecho sin
        moverlo a `done`**, porque lo que el cliente ve es el tablero y no lo
        que le dijiste en el chat.

        Args:
            ticket_id: el id de la tarea, como `t_ab12cd34ef56`.
            status: `ready` si queda para hacer, `in_progress` si la estás
                haciendo, `blocked` si no podés seguir sin algo del cliente,
                `done` si quedó resuelta —o descartada, y ahí decí por qué en
                `comment`—, `archived` si sale del tablero.
            comment: lo que quede escrito en la tarea: qué hiciste, qué falta,
                por qué la frenaste. Lo lee el cliente ahí.
        """
        if board.row_of(ticket_id) is None:
            raise ModelRetry(board.MISSING.format(ticket_id=ticket_id))
        if status is not None and status not in board.STATUSES:
            raise ModelRetry(board.BAD_STATUS.format(status=status))
        if status is None and not comment:
            raise ModelRetry(
                "decime qué cambio: `status` para moverla, `comment` para dejarle algo escrito"
            )
        if comment:
            board.comment(ticket_id, board.AGENT, comment, session_id=ctx.deps.session_id)
        if status is not None:
            board.move(ticket_id, status, said=comment, session_id=ctx.deps.session_id)
            return f"Moví {ticket_id} a {board.COLUMN[status]}."
        return f"Comenté en {ticket_id}."

    return ts
