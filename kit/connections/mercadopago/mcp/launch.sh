#!/bin/sh
# What Hermes starts when it wants to talk to Mercado Pago. NEVER the real
# server: always the guard, with the real server as its child.
#
# Lives in /opt/policy (mounted :ro inside the agent's container) and not in
# /opt/data on purpose. If the agent could edit this file, it would be enough
# to cut the guard out of the way and call the server directly.
#
# One launcher per connection instead of passing variables through
# `hermes mcp add`: what runs stays visible and does not depend on how the
# CLI propagates the env.
GUARD_CONNECTION=mercadopago \
GUARD_COMMAND="python3 /opt/policy/mcp/mercadopago/server.py" \
exec python3 /opt/policy/guard.py
