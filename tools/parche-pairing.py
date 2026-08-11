#!/usr/bin/env python3
"""Traduce al español el mensaje de pairing de Telegram, y lo apunta al portal.

POR QUE EXISTE
--------------
El primer mensaje que un cliente recibe de su agente dice, en inglés:

    Hi~ I don't recognize you yet!
    Here's your pairing code: LHJY6SAU
    Ask the bot owner to run: `hermes pairing approve telegram LHJY6SAU`

O sea que le pide a una persona no técnica que corra un comando de terminal —y
CONTRADICE al portal, que en esa misma pantalla le dice "pegá el código acá".
El cliente lee eso y se frena, o escribe pensando que hizo algo mal.

Está hardcodeado en /opt/hermes/gateway/run.py: no hay plantilla ni opción de
configuración. Lo correcto a mediano plazo es pedirle a Nous que el mensaje sea
configurable; mientras tanto, esto.

COMO SE USA
-----------
Del `command` del contenedor, ANTES de levantar el gateway:

    command: sh -c "python3 /opt/politica/parche-pairing.py; exec hermes gateway run"

Corre adentro del contenedor y toca su copia de la imagen, no un volumen: se
re-aplica en cada arranque y desaparece sola al actualizar la imagen.

FALLA RUIDOSA, A PROPOSITO
--------------------------
Si Nous cambia el texto, el parche no matchea. En vez de seguir callado —y que
el cliente reciba el mensaje en inglés sin que nadie se entere— grita en el log
con una línea imposible de no ver. El gateway arranca igual: un mensaje feo es
mejor que un agente caído.
"""
import sys

RUTA = "/opt/hermes/gateway/run.py"

VIEJO = '''                            f"Hi~ I don't recognize you yet!\\n\\n"
                            f"Here's your pairing code: `{code}`\\n\\n"
                            f"Ask the bot owner to run:\\n"
                            f"`hermes {profile_arg}pairing approve "
                            f"{platform_name} {code}`"'''

NUEVO = '''                            f"\\u00a1Hola! Todav\\u00eda no nos conocemos.\\n\\n"
                            f"Tu c\\u00f3digo es: `{code}`\\n\\n"
                            f"Pegalo en tu portal, en la pantalla donde te lo "
                            f"pidi\\u00f3, y quedamos conectados."'''


def main():
    try:
        with open(RUTA, encoding="utf-8") as f:
            s = f.read()
    except OSError as e:
        print(f"[parche-pairing] no pude leer {RUTA}: {e}", file=sys.stderr, flush=True)
        return 0   # nunca frenamos el arranque del agente

    if NUEVO in s:
        print("[parche-pairing] ya estaba aplicado", file=sys.stderr, flush=True)
        return 0

    if VIEJO not in s:
        print(
            "\n[parche-pairing] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n"
            "[parche-pairing] NO ENCONTRE el mensaje de pairing en run.py.\n"
            "[parche-pairing] Nous debe haber cambiado el texto: el cliente va a\n"
            "[parche-pairing] recibir el mensaje EN INGLES pidiendole que corra\n"
            "[parche-pairing] un comando de terminal. Hay que actualizar\n"
            "[parche-pairing] tools/parche-pairing.py contra la version nueva.\n"
            "[parche-pairing] !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n",
            file=sys.stderr, flush=True)
        return 0

    try:
        with open(RUTA, "w", encoding="utf-8") as f:
            f.write(s.replace(VIEJO, NUEVO, 1))
    except OSError as e:
        print(f"[parche-pairing] no pude escribir {RUTA}: {e}", file=sys.stderr, flush=True)
        return 0

    print("[parche-pairing] aplicado: mensaje de pairing en español, apuntando al portal",
          file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
