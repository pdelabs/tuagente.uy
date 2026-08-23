#!/usr/bin/env python3
"""Translates Telegram's pairing message to Spanish, and points it at the portal.

WHY IT EXISTS
-------------
The first message a client gets from their agent says, in English:

    Hi~ I don't recognize you yet!
    Here's your pairing code: LHJY6SAU
    Ask the bot owner to run: `hermes pairing approve telegram LHJY6SAU`

Meaning it asks a non-technical person to run a terminal command — and it
CONTRADICTS the portal, which on that very screen tells them "paste the code
here". The client reads that and freezes, or writes back thinking they did
something wrong.

It's hardcoded in /opt/hermes/gateway/run.py: no template, no config option.
The right fix in the medium term is to ask Nous to make the message
configurable; until then, this.

HOW IT'S USED
-------------
From the container's `command`, BEFORE starting the gateway:

    command: sh -c "python3 /opt/policy/pairing-patch.py; exec hermes gateway run"

Runs inside the container and patches its own copy of the image, not a
volume: it gets re-applied on every start and disappears on its own when the
image gets updated.

FAILS LOUDLY, ON PURPOSE
-------------------------
If Nous changes the text, the patch doesn't match. Instead of staying quiet
—with the client getting the message in English and nobody finding out— it
screams in the log with a line impossible to miss. The gateway starts up
anyway: an ugly message is better than a dead agent.
"""
import sys

PATH = "/opt/hermes/gateway/run.py"

OLD = '''                            f"Hi~ I don't recognize you yet!\\n\\n"
                            f"Here's your pairing code: `{code}`\\n\\n"
                            f"Ask the bot owner to run:\\n"
                            f"`hermes {profile_arg}pairing approve "
                            f"{platform_name} {code}`"'''

NEW = '''                            f"\\u00a1Hola! Todav\\u00eda no nos conocemos.\\n\\n"
                            f"Tu c\\u00f3digo es: `{code}`\\n\\n"
                            f"Pegalo en tu portal, en la pantalla donde te lo "
                            f"pidi\\u00f3, y quedamos conectados."'''


def main():
    try:
        with open(PATH, encoding="utf-8") as f:
            s = f.read()
    except OSError as e:
        print(f"[pairing-patch] couldn't read {PATH}: {e}", file=sys.stderr, flush=True)
        return 0   # never block the agent from starting

    if NEW in s:
        print("[pairing-patch] already applied", file=sys.stderr, flush=True)
        return 0

    if OLD not in s:
        print(
            "\n[pairing-patch] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n"
            "[pairing-patch] COULDN'T FIND the pairing message in run.py.\n"
            "[pairing-patch] Nous must have changed the text: the client is going\n"
            "[pairing-patch] to get the message IN ENGLISH asking them to run a\n"
            "[pairing-patch] terminal command. tools/pairing-patch.py needs to be\n"
            "[pairing-patch] updated against the new version.\n"
            "[pairing-patch] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n",
            file=sys.stderr, flush=True)
        return 0

    try:
        with open(PATH, "w", encoding="utf-8") as f:
            f.write(s.replace(OLD, NEW, 1))
    except OSError as e:
        print(f"[pairing-patch] couldn't write {PATH}: {e}", file=sys.stderr, flush=True)
        return 0

    print("[pairing-patch] applied: pairing message in Spanish, pointing at the portal",
          file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
