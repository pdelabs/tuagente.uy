#!/command/with-contenv sh
# s6 lo corre antes de levantar el gateway, en cada arranque del contenedor.
#
# Va acá y no en el `command` del compose porque el entrypoint de la imagen es
# s6 (`/init /opt/hermes/docker/main-wrapper.sh`) y el command son los args de
# `hermes`: meter un `sh -c` ahí lo rompe.
#
# SIEMPRE sale 0: si un cont-init falla, s6 no levanta el contenedor. Un
# mensaje de pairing feo es mucho mejor que un agente caído.
python3 /opt/politica/parche-pairing.py || true
exit 0
