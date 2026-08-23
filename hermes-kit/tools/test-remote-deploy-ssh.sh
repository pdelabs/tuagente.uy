#!/usr/bin/env bash
# Deploys the kit against a REAL sshd, in a container, with GNU's rsync — the
# one that's on the VPS.
#
#   tools/test-remote-deploy-ssh.sh
#
# WHY THIS EXISTS. `compare-installers.sh` runs the deployer with
# `--local-dest`, i.e. WITHOUT a protocol: rsync operates in local mode, and on
# the Mac that rsync is **openrsync**, which is not the VPS's. The difference
# isn't theoretical: `--no-implied-dirs` (which openrsync tolerates by
# creating the directories anyway) makes GNU rsync 3.4.3 abort the whole
# transfer —
#
#     ABORTING due to invalid path from sender: data/connections/catalog.json
#
# — with rc=2 and ZERO files transferred. The agent is left with `data/` and
# nothing else: no adapter, no policy/, no kit-skills, no manifest. The
# comparator gave rc=0 and "29 identical files" with production broken.
#
# Rule that comes out of that: **any new rsync option gets tested here before
# touching production.** Local mode is good for the content; only this
# validates the protocol.
#
# WHAT IT DOESN'T COVER, so nobody reads too much into it: odd file names
# (spaces, accents, quotes), the content of the two composes, the environment
# variables, ufw, DNS, config.yaml's lock, or installing the SOUL. This
# validates the PROTOCOL and the deletion: that the whole kit arrives over
# ssh, that the client's own stuff isn't touched, and that whatever the kit
# stopped bringing gets removed correctly.
#
# Needs docker and network access the first time (pulls alpine and installs
# openssh+rsync on it).
set -uo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="kit-vps-test"
PORT="${SSH_PORT:-2299}"
BENCH="$(mktemp -d)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1
  rm -rf "$BENCH"
}
trap cleanup EXIT

command -v docker >/dev/null || { echo "couldn't find docker" >&2; exit 2; }

echo "→ bringing up a fake VPS (alpine + sshd + GNU rsync)"
# The image gets built ONCE and stays cached: running `apk add` on every run
# depends on the network and made the test flaky ("couldn't authorize the
# key" when apk hadn't finished yet).
IMAGE="kit-vps-test:1"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "   (building the image, just once)"
  docker build -q -t "$IMAGE" - >/dev/null <<'DOCKERFILE' || { echo "couldn't build the image" >&2; exit 2; }
FROM alpine:3.20
RUN apk add --no-cache openssh rsync bash && ssh-keygen -A \
 && mkdir -p /root/.ssh && chmod 700 /root/.ssh \
 && printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/docker && chmod +x /usr/local/bin/docker
CMD ["/usr/sbin/sshd", "-D", "-e", "-o", "PermitRootLogin=yes", "-o", "PasswordAuthentication=no"]
DOCKERFILE
fi

docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:22" "$IMAGE" >/dev/null \
  || { echo "couldn't bring up the container" >&2; exit 2; }

ssh-keygen -q -t ed25519 -N "" -f "$BENCH/key" || exit 2
authorized=0
for _ in $(seq 1 30); do
  if docker exec -i "$NAME" sh -c 'cat > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys' \
       < "$BENCH/key.pub" 2>/dev/null; then
    authorized=1; break
  fi
  sleep 1
done
[[ $authorized -eq 1 ]] || { echo "couldn't authorize the key in the container" >&2
  docker logs "$NAME" 2>&1 | tail -5 >&2; exit 2; }

# The deployer calls `ssh` and `rsync` with no connection options, so the
# configuration comes in through our own `ssh` on the PATH — which is also
# what rsync uses as its remote shell.
mkdir -p "$BENCH/bin"
cat > "$BENCH/bin/ssh" <<EOF
#!/usr/bin/env bash
exec /usr/bin/ssh -i "$BENCH/key" -p $PORT \\
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \\
  -o LogLevel=ERROR "\$@"
EOF
chmod +x "$BENCH/bin/ssh"

for _ in $(seq 1 30); do
  PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 true 2>/dev/null && break
  sleep 1
done
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 true 2>/dev/null || {
  echo "couldn't reach the container over ssh" >&2; exit 2; }
echo "   VPS's rsync: $(PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 'rsync --version | head -1')"

echo "→ deploying"
if ! PATH="$BENCH/bin:$PATH" "$KIT/deploy-remote.sh" test root@127.0.0.1 example.local \
     > "$BENCH/output.txt" 2>&1; then
  echo "FAILURE: the deployment finished with an error"
  sed 's/^/   /' "$BENCH/output.txt" | tail -25
  exit 1
fi
grep -E "rsync error|ABORTING|invalid path" "$BENCH/output.txt" | sed 's/^/   /' && {
  echo "FAILURE: rsync complained (above). With rc=0 it may still have transferred nothing."
  exit 1; }

# ── what has to have arrived ────────────────────────────────────────────────
echo "→ checking against the manifest"
R=/opt/agentes/test
failures=0
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "cat $R/.kit-installed" > "$BENCH/remote-manifest.txt" 2>/dev/null
if [[ ! -s "$BENCH/remote-manifest.txt" ]]; then
  echo "FAILURE: the manifest never arrived"; exit 1
fi
echo "   remote manifest: $(wc -l < "$BENCH/remote-manifest.txt" | tr -d ' ') files"

# Every file in the manifest has to exist over there with the sha it says.
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "cd $R && while IFS=\$'\t' read -r path hash; do
    [ -f \"\$path\" ] || { echo \"MISSING \$path\"; continue; }
    real=\$(sha256sum \"\$path\" | cut -d' ' -f1)
    [ \"\$real\" = \"\$hash\" ] || echo \"DIFFERENT \$path\"
  done < .kit-installed" > "$BENCH/verification.txt" 2>&1
if [[ -s "$BENCH/verification.txt" ]]; then
  sed 's/^/   /' "$BENCH/verification.txt"; failures=$((failures+1))
else
  echo "   every file in the manifest arrived and matches by sha256"
fi

# The folders the skills take for granted, and the ownership the compose
# needs: data/ belongs to the agent, ours to root.
for d in data/workspace/entregables data/workspace/artifacts data/workspace/entrada data/workspace/interno; do
  PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "[ -d $R/$d ]" || {
    echo "   MISSING the $d folder"; failures=$((failures+1)); }
done
echo "   owners and modes:"
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 \
  "stat -c '     %U:%G %a %n' $R/data $R/policy $R/kit-skills $R/kit-adapter $R/.kit-installed"
# kit-skills/ and kit-adapter/ belong to root (nobody writes them: they go :ro
# in both services). policy/ belongs to the adapter (uid 10000): that's where
# it writes policy.json and requests.jsonl, and what protects it from the
# agent is the :ro mount, not the owner.
owners="$(PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "stat -c '%U:%G' $R/kit-skills $R/kit-adapter" | sort -u)"
[[ "$owners" == "root:root" ]] || { echo "   FAILURE kit-skills/ or kit-adapter/ didn't end up owned by root"; failures=$((failures+1)); }
policy_owner="$(PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "stat -c '%u' $R/policy")"
[[ "$policy_owner" == "10000" ]] || { echo "   FAILURE policy/ didn't end up owned by the adapter (uid 10000): it's $policy_owner"; failures=$((failures+1)); }

# ── and the second deployment, the one that deletes if something's wrong ───
echo "→ second (incremental) deployment with client work inside"
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 \
  "mkdir -p $R/data/workspace/entregables && echo 'client data' > $R/data/workspace/entregables/delivery.csv &&
   echo '{\"email\":{\"read\":true}}' > $R/policy/policy.json &&
   echo '{\"id\":\"images\"}' > $R/policy/capabilities/requests.jsonl"
if ! PATH="$BENCH/bin:$PATH" "$KIT/deploy-remote.sh" test root@127.0.0.1 example.local \
     > "$BENCH/output2.txt" 2>&1; then
  echo "FAILURE: the second deployment finished with an error"; tail -20 "$BENCH/output2.txt" | sed 's/^/   /'
  exit 1
fi
for f in data/workspace/entregables/delivery.csv policy/policy.json policy/capabilities/requests.jsonl; do
  PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "[ -s $R/$f ]" \
    && echo "   intact $f" \
    || { echo "   LOST $f"; failures=$((failures+1)); }
done
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 \
  "grep -q read $R/policy/policy.json" \
  && echo "   policy.json kept the client's permissions" \
  || { echo "   FAILURE policy.json got overwritten"; failures=$((failures+1)); }

# ── 3. the DELETION, which is the dangerous part and nobody was exercising ──
# `clean-obsolete.sh` runs over there, with the VPS's own bash and sha256sum.
# Two obsoletes get seeded: one untouched (has to go) and one edited by the
# client (has to stay), plus a poisoned line pointing at a client file (can't
# be a candidate).
echo "→ third pass: what the kit stopped bringing"
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "
  mkdir -p $R/kit-skills/skill-we-removed $R/policy/mcp/old-connection
  echo 'from the old kit' > $R/kit-skills/skill-we-removed/SKILL.md
  echo 'from the old kit' > $R/policy/mcp/old-connection/server.py
  { cat $R/.kit-installed
    printf 'kit-skills/skill-we-removed/SKILL.md\t%s\n' \$(sha256sum $R/kit-skills/skill-we-removed/SKILL.md | cut -d' ' -f1)
    printf 'policy/mcp/old-connection/server.py\t%s\n' \$(sha256sum $R/policy/mcp/old-connection/server.py | cut -d' ' -f1)
    printf 'data/workspace/entregables/delivery.csv\t%s\n' \$(sha256sum $R/data/workspace/entregables/delivery.csv | cut -d' ' -f1)
  } | sort > $R/.kit-installed.tmp && mv $R/.kit-installed.tmp $R/.kit-installed
  echo '# I edited this' >> $R/policy/mcp/old-connection/server.py"
if ! PATH="$BENCH/bin:$PATH" "$KIT/deploy-remote.sh" test root@127.0.0.1 example.local \
     > "$BENCH/output3.txt" 2>&1; then
  echo "FAILURE: the third deployment finished with an error"; tail -20 "$BENCH/output3.txt" | sed 's/^/   /'
  exit 1
fi
grep -E "^(removed|HEADS UP)" "$BENCH/output3.txt" | sed 's/^/   /'
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "[ -f $R/kit-skills/skill-we-removed/SKILL.md ]" \
  && { echo "   FAILURE what the kit no longer brings is still there"; failures=$((failures+1)); } \
  || echo "   what the kit stopped bringing is gone"
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "[ -f $R/policy/mcp/old-connection/server.py ]" \
  && echo "   what the kit no longer brings but the client edited is still there" \
  || { echo "   FAILURE deleted a file the client had edited"; failures=$((failures+1)); }
PATH="$BENCH/bin:$PATH" ssh root@127.0.0.1 "[ -s $R/data/workspace/entregables/delivery.csv ]" \
  && echo "   the client's deliverable survived the poisoned line" \
  || { echo "   FAILURE the manifest's poisoned line deleted a deliverable"; failures=$((failures+1)); }

echo
if [[ $failures -eq 0 ]]; then
  echo "The ssh deployment works: the whole kit arrived, the client's stuff stayed intact,"
  echo "and the obsolete stuff was removed without taking anything else down with it."
  exit 0
fi
echo "$failures failure(s) in the ssh deployment."
exit 1
