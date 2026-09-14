#!/command/with-contenv sh
# s6 runs this before bringing up the gateway, on every container start.
#
# It goes here and not in the compose's `command` because the image's
# entrypoint is s6 (`/init /opt/hermes/docker/main-wrapper.sh`) and `command`
# is `hermes`'s args: putting a `sh -c` there breaks it.
#
# ALWAYS exits 0: if a cont-init fails, s6 doesn't bring the container up. An
# ugly pairing message is much better than a dead agent.
python3 /opt/policy/pairing-patch.py || true
exit 0
