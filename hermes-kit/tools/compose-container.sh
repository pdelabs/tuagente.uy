# Which container is the engine's, read off the compose that named it. SOURCED,
# never run: `. "$(dirname "$0")/compose-container.sh"`.
#
# WHY IT IS ITS OWN FILE. The compose renders `container_name: <slug>-hermes`
# from the slug the agent was created with, and three scripts here need that
# string. Two of them used to GUESS it from the directory's basename -- with a
# `sed 's/^agente-//'` on it, left over from when every agent directory was
# called `agente-<slug>`. Two derivations of one fact, and the rename that
# dropped the prefix made them disagree: a directory called `agente-acme` holds
# a container called `acme-hermes` only if it was created before the rename.
# 5738a0d fixed `hire-role.sh` by reading the compose; a second and a third copy
# of the same `awk` would be that same mistake in a smaller font, so the
# derivation lives here and everybody sources it.

# stdin: the compose. The engine's service is `hermes:`; `portal-adapter:`
# declares a container_name too, and taking the first one in the file would
# be right only as long as nobody reorders the services.
# THE TWO SUBSTITUTIONS ARE NOT TIDINESS. Anchoring the service header on
# "nothing after the colon" made `  hermes:  # the engine` and any CRLF
# compose invisible, and an invisible header means `service` never becomes
# "hermes" -- so the script refused with "has no container_name under the
# hermes service" on a compose that plainly has one. Refusing is safe; saying
# something untrue about the file in front of the operator is not.
#
# The two-space anchor STAYS. Loosening it to any indentation would let a
# nested valueless key (volumes:, ports:, deploy:) become `service` and make
# the reader confidently WRONG, which is worse than refusing.
compose_container() {
  awk '
    { sub(/\r$/, "") }
    /^  [a-z][a-z0-9_-]*:[ \t]*(#.*)?$/ { service = $1; sub(":", "", service) }
    service == "hermes" && $1 == "container_name:" { print $2; exit }
  '
}

# The same name with the YAML taken off it, or a refusal that names the file.
#
# IT REFUSES FROM INSIDE `$(...)`, SO EVERY CALLER NEEDS `set -e`. The `exit 1`
# below leaves the command substitution, not the script; what turns it into the
# script stopping is the assignment inheriting that status under `set -euo
# pipefail`, which all three callers have. Sourcing this into a script without
# it would leave the caller holding an empty name and going on.
#
# A QUOTED VALUE IS STILL A VALID COMPOSE, and `docker exec` on the quotes is
# not. `container_name: "cliente-hermes"` is what a hand-edited compose looks
# like sooner or later, and the quotes come back attached: every `docker exec`
# after this dies on `no such object: "cliente-hermes"` -- late, long after the
# name was resolved, naming something the compose never said. Stripping here is
# the only place that knows the value came out of YAML.
compose_container_or_die() {
  local compose="$1" name
  [[ -f "$compose" ]] || { echo "$compose doesn't exist — is that the agent's directory?" >&2; exit 1; }
  name="$(compose_container < "$compose")"
  name="${name%\"}"; name="${name#\"}"
  name="${name%\'}"; name="${name#\'}"
  [[ -n "$name" ]] || { echo "$compose has no container_name under the hermes service" >&2; exit 1; }
  printf '%s\n' "$name"
}
