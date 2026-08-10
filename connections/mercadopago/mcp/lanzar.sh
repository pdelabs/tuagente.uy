#!/bin/sh
# Lo que Hermes arranca cuando quiere hablar con Mercado Pago. NUNCA el
# servidor real: siempre la guardia, con el servidor real como su hijo.
#
# Vive en /opt/politica (montado :ro en el contenedor del agente) y no en
# /opt/data a proposito. Si el agente pudiera editar este archivo, le
# alcanzaria con sacar la guardia del medio y llamar al servidor directo.
#
# Un lanzador por conexion en vez de pasar variables por `hermes mcp add`:
# queda a la vista que se ejecuta y no depende de como el CLI propague el env.
GUARDIA_CONEXION=mercadopago \
GUARDIA_COMANDO="python3 /opt/politica/mcp/mercadopago/servidor.py" \
exec python3 /opt/politica/guardia.py
