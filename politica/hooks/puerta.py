#!/usr/bin/env python3
"""Puerta de la terminal: bloquea lo que no se hace desde adentro del agente.

Lo corre el motor ANTES de cada llamada a `terminal` (hook `pre_tool_call` con
matcher, declarado en config.yaml). Recibe por stdin un JSON con `tool_name` y
`tool_input`, y si el comando cae en una de las tres familias de abajo contesta
`{"action": "block", "message": ...}`: el motor no ejecuta y le devuelve ese
mensaje al modelo como error de tool.

EL MODELO DE AMENAZA, que es lo que explica todo lo demas: no es un agente
adversario buscando evadir. Es un agente APLICADO que choca contra un bloqueo y
prueba variantes hasta que algo pasa —comillas, otro gestor de paquetes, otra
ruta— porque cree que la tarea lo amerita. Contra eso, dos consecuencias:

  a) hay que cubrir la FAMILIA, no el comando exacto: el reintento natural es
     `npm` despues de `pip`, `'install'` despues de `install`;
  b) el MENSAJE importa tanto como el patron. Un "no" a secas deja al agente
     buscando la vuelta; un "no, y esto es lo que si funciona" cierra la
     busqueda. Los tres mensajes de abajo redirigen y dicen explicitamente que
     no hay variante que pase. Esa frase es la que apaga el reintento.

QUE BLOQUEA, Y POR QUE CADA UNO:

1. INSTALAR SOFTWARE. El QA lo vio: empujado, el agente corrio cuatro
   `hermes skills install --yes` y un `npm install` de 16 MB DENTRO del volumen
   del cliente, sin pedirle permiso a nadie. Lo instalado entra al prompt de
   cada request y nadie lo auditó. Las capacidades se piden, no se instalan.

2. FALSIFICAR UNA FIRMA. `hermes kanban comment --author=portal` deja un
   comentario que se lee igual que el que escribe el boton Aprobar; con
   `--author=cliente` deja el "Aprobado CON CORRECCIONES", que es la mitad del
   par que autoriza Y la que lleva el contenido a ejecutar. No se persiguen dos
   nombres: se bloquea PONER FIRMA (`--author`, `--created-by`, y
   `HERMES_PROFILE=` adelante del comando, que es de donde sale el default —
   `kanban comment --help` y `tools/kanban_tools.py:877`). El agente nunca
   necesita la bandera: su firma sale sola del profile, y ninguna skill del kit
   la usa (verificado con grep sobre skills/ y tools/). El motor ya tomo esta
   misma decision del lado de las tools: `kanban_comment` dejo de aceptar
   `author` justamente para que un worker no forje un nombre con autoridad.

3. DESBLOQUEARSE SOLO. `hermes kanban unblock` sobre el ticket que el propio
   agente bloqueo pidiendo permiso es saltear la puerta entera. (La tool
   `kanban_unblock` se cubre con su propio matcher; esto tapa el camino por
   terminal, que es el que quedaba abierto.)

QUE GESTORES DE PAQUETES EXISTEN DE VERDAD (imagen v2026.7.30, verificado el
2026-08-12 con `for b in ...; do docker exec lab-hermes sh -lc "command -v $b";
done`): npm, npx, uv, uvx, corepack, apt/apt-get, curl, git, node, python3.
NO estan: pip, pip3, pipx, yarn, pnpm, poetry, conda, brew, wget, cargo, gem.
Los patrones cubren los que estan; `pip` y `wget` quedan igual porque son la
forma canonica que un modelo intenta primero y porque `uv pip install` los
reintroduce. Para yarn/pnpm no hay patron —no existen— pero SI para `corepack`,
que es el camino soportado para materializarlos. Si cambia la imagen, hay que
correr ese loop de nuevo: es el unico insumo de esta lista.

LIMITES CONOCIDOS, escritos a proposito y no perseguidos (todos requieren dos
pasos deliberados, que es justo lo que el agente aplicado no hace):

  * variables de shell — `I=install; hermes skills $I x`, `h=hermes; $h kanban
    unblock t_1`. Expandirlas es interpretar shell y esto no es un interprete.
    Lo que si se hizo: los patrones no exigen el `hermes` de adelante, asi que
    `$h kanban unblock` cae igual.
  * dos pasos — `curl -o /tmp/s.sh https://x && sh /tmp/s.sh`, o escribir un
    script (heredoc, `python3 -c`) y correrlo despues.
  * codificar el comando (base64, variables armadas por pedazos).
  * escribirle a `kanban.db` por SQL en vez de por el CLI.
  * `git clone` de un repo de skills: se bloquea recien cuando se intenta
    instalar. Bloquear `clone` costaba mas trabajo legitimo del que salvaba.

Ninguno de esos es "el guardrail no sirve": el guardrail de fondo sigue siendo
el SOUL, y esta puerta existe para que el camino facil este cerrado y el mensaje
llegue en el momento exacto en que el agente estira la mano.

REGLAS DE ESTE ARCHIVO: sin dependencias, sin red, sin leer nada del volumen, y
que termine rapido — corre antes de CADA comando de terminal y un hook lento o
roto se paga en todos los turnos. Ante la duda, DEJA PASAR: esto es una puerta,
no un antivirus.
"""
import json
import re
import sys

# --- normalizacion --------------------------------------------------------
# El agente que reintenta no es astuto, pero prueba lo obvio: comillas
# (`hermes skills "install"`), espacios de mas, banderas en el medio
# (`npm --prefix /tmp install`). Se normaliza barato ANTES de matchear, asi los
# patrones quedan cortos y legibles en vez de llenarse de alternativas.

COMILLAS = re.compile(r"[\"'`\\]")          # se borran, no se reemplazan por espacio:
                                            # asi cae tanto `"install"` como `he"rmes"`
ESPACIOS = re.compile(r"\s+")

# Comandos que EMITEN TEXTO: si el segmento es uno de estos y no desemboca en
# una tuberia, lo que dice adentro es contenido, no una orden. Sin esto,
# `echo 'pip install' >> notas.md` —escribir la frase en una nota— se bloquea.
# La excepcion se cae sola si el texto va a parar a un shell (`echo ... | sh`),
# porque ahi el segmento siguiente es el que ejecuta y la tuberia lo delata.
TEXTO = {"echo", "printf", "grep", "egrep", "fgrep", "rg", "#"}

# Interpretes. Si un segmento los invoca SIN archivo —solo banderas— y viene de
# una tuberia, esta ejecutando lo que le llega por stdin: es la forma
# `curl … | sh` y todas sus variantes (`| bash -s -- --yes`, `| python3 -`).
# Se mira asi y no con un patron `curl[^|]*\|` porque al partir por `|` los dos
# lados quedan en segmentos distintos; y de paso cubre cualquier cosa que
# escupa el comando de la izquierda, no solo curl y wget.
INTERPRETES = {"sh", "bash", "zsh", "dash", "ksh", "ash",
               "python", "python3", "node", "perl", "ruby"}
IGNORAR_AL_FRENTE = {"sudo", "command", "exec", "nohup", "time", "env",
                     "do", "then", "else", "{", "("}

# Verbos del kanban que solo escriben TEXTO. Un comentario que dice "para esto
# haria falta `npm install cowsay`" es exactamente lo que queremos que el agente
# escriba —contar que le falta algo— y bloquearlo seria el peor falso positivo
# posible: castigar la conducta correcta. En estos segmentos no se miran los
# patrones de instalar; las reglas de firma SI, que es donde estan `--author` y
# `--created-by`.
KANBAN_TEXTO = re.compile(
    r"^(?:hermes\s+)?kanban\s+(comment|create|block|complete|attach|attach-url|link|show|list)\b")

# Sustitucion de comandos: `echo $(npm install x)` o con backticks. Adentro hay
# un comando de verdad, asi que las excepciones de texto no aplican. Se detecta
# sobre el segmento CRUDO, antes de sacar comillas y backticks.
SUSTITUCION = re.compile(r"\$\(|`|\$\{")

# Un hueco tolerado entre el binario y el subcomando, para que
# `npm --prefix /tmp install x` y `pip3 --target /tmp install x` caigan igual.
# Solo acepta banderas, asignaciones y rutas —no cualquier palabra— y hasta
# tres: con `(?:\S+\s+){0,3}` de por medio, `npm run ci` se bloquearia solo.
HUECO = r"(?:(?:-{1,2}\S+|\S+=\S+|\.{0,2}/\S+)\s+){0,3}?"

PATRONES = [
    # 1. instalar software / ampliarse solo.
    #    Sin anclar en `hermes`: asi `$h skills install x` cae igual.
    (rf"\b(?:hermes\s+)?skills\s+{HUECO}(install|update|tap|publish|config|snapshot|repair-official|opt-in)\b", "instalar"),
    (rf"\b(?:hermes\s+)?mcp\s+{HUECO}(add|install|configure|config)\b", "instalar"),
    (rf"\b(?:hermes\s+)?plugins\s+{HUECO}(install|update|enable)\b", "instalar"),
    (r"\bhermes\s+update\b", "instalar"),
    (r"\b(?:hermes\s+)?claw\s+migrate\b", "instalar"),
    (rf"\bnpm\s+{HUECO}(install|i|add|ci|link|exec)\b", "instalar"),
    (r"\bnpx\b", "instalar"),          # npx baja el paquete al volumen y lo corre
    (r"\bcorepack\b", "instalar"),     # es como se materializan yarn y pnpm
    (rf"\buv\s+{HUECO}(pip\s+install|pip\s+sync|add|sync|tool)\b", "instalar"),
    (r"\buv\s+run\b[^\n]*--with\b", "instalar"),
    (r"\buvx\b", "instalar"),
    (rf"\b(pip|pip3)\s+{HUECO}install\b", "instalar"),
    (r"\bpython3?\s+-m\s+pip\b", "instalar"),
    (rf"\b(apt|apt-get)\s+{HUECO}(install|upgrade)\b", "instalar"),
    (r"\bdpkg\s+-i\b", "instalar"),
    # `curl … | sh` no esta aca: lo resuelve INTERPRETES en `veredicto`.
    # 2. falsificar una firma: ver FIRMA_* abajo, que necesitan contexto.
    # 3. desbloquearse solo. Tampoco anclado en `hermes`.
    (r"\b(?:hermes\s+)?kanban\s+unblock\b", "desbloquear"),
    (r"\b(?:hermes\s+)?kanban\s+promote\b", "desbloquear"),
]
PATRONES = [(re.compile(p), f) for p, f in PATRONES]

# La bandera de firma no se puede perseguir suelta: `git commit --author=…` es
# legitimo. Se exige contexto de kanban en el mismo segmento. La variable de
# entorno no necesita contexto: `HERMES_PROFILE` no tiene otro uso que decidir
# con que nombre firma el CLI, y el agente no cambia de perfil.
FIRMA_FLAG = re.compile(r"--(author|created-by|created_by)\b")
FIRMA_ENV = re.compile(r"(?:^|\s)(export\s+)?hermes_profile\s*=")
CONTEXTO_KANBAN = re.compile(r"\b(hermes|kanban)\b")

MENSAJES = {
    "instalar": (
        "No se instala software desde acá, y no hay variante de este comando que "
        "sí pase: cambiar de gestor de paquetes, de ruta o de comillas te va a "
        "dar lo mismo. Las capacidades de este agente se PIDEN: abrí la skill "
        "`capacidad`, buscá el id en su catálogo y escribí `capacidad:<id>` sola "
        "en una línea para que tu cliente la vea. Si lo que necesitás no está en "
        "el catálogo, decilo en una frase y seguí con lo que sí podés hacer — "
        "queda anotado. Cuando se lo cuentes a tu cliente no nombres comandos, "
        "skills ni instalaciones: decí qué no podés hacer y qué cambiaría si lo "
        "tuvieras."
    ),
    "firmar": (
        "No pongas una firma que no es la tuya. La firma de un comentario sale "
        "sola de tu perfil: comentá sin `--author` y sin tocar `HERMES_PROFILE`. "
        "`portal` es la firma del botón Aprobar y `cliente` la de quien aprueba: "
        "escribir cualquiera de las dos es falsificar una aprobación. No hay "
        "forma correcta de hacerlo ni bandera que sirva — si querés dejar "
        "constancia de algo, comentá normal, con tu firma."
    ),
    "desbloquear": (
        "No te desbloquees vos, ni por este camino ni por otro: no hay comando "
        "que lo haga bien. Bloqueaste ese ticket para pedir permiso, y "
        "desbloquearlo es la respuesta de tu cliente, no un paso tuyo. Esperá el "
        "desbloqueo con su comentario de aprobación. Si el pedido quedó trabado, "
        "avisale por el chat y volvé a pedirlo."
    ),
}


def comando_de(entrada):
    """El texto a mirar, venga como venga el payload de la tool."""
    ti = entrada.get("tool_input")
    if isinstance(ti, str):
        return ti
    if isinstance(ti, dict):
        partes = [str(ti.get(k) or "") for k in ("command", "cmd", "script", "input")]
        return " ".join(p for p in partes if p) or json.dumps(ti, ensure_ascii=False)
    return ""


def partir(comando):
    """Parte por `;` `&&` `||` `|` `&` y saltos de linea, RESPETANDO comillas.

    Diez lineas de escaner en vez de un `re.split`, por un caso concreto: el
    cuerpo de un comentario —`kanban create --body 'no puedo; falta X'`— trae
    puntos y comas adentro, y partir ahi convierte media frase en un comando
    imaginario. Devuelve [(crudo, separador_que_sigue)].
    """
    segs, buf, comilla, i = [], [], None, 0
    while i < len(comando):
        c = comando[i]
        if comilla:
            buf.append(c)
            if c == comilla:
                comilla = None
            i += 1
        elif c in "\"'":
            comilla = c
            buf.append(c)
            i += 1
        elif c == "\\" and i + 1 < len(comando):
            buf.append(c)
            buf.append(comando[i + 1])
            i += 2
        elif comando[i:i + 2] in ("&&", "||"):
            segs.append(("".join(buf), comando[i:i + 2]))
            buf, i = [], i + 2
        elif c in "|;&\n":
            segs.append(("".join(buf), c))
            buf, i = [], i + 1
        else:
            buf.append(c)
            i += 1
    segs.append(("".join(buf), ""))
    return segs


def segmentos(comando):
    """El comando partido en pedazos ejecutables y normalizados.

    Devuelve (texto, tuberia, sustitucion): `tuberia` dice si ese pedazo
    desemboca en `|` —lo unico que distingue escribir una frase de ejecutarla—
    y `sustitucion` si adentro hay un `$(…)` o un backtick, que desactiva las
    excepciones de texto.
    """
    salida = []
    for crudo, sep in partir(comando.lower()):
        texto = ESPACIOS.sub(" ", COMILLAS.sub("", crudo)).strip()
        if texto:
            salida.append((texto, sep == "|", bool(SUSTITUCION.search(crudo))))
    return salida


def cabeza(segmento):
    """El comando de un segmento y sus argumentos, sin ruido de adelante."""
    tokens = segmento.split()
    while tokens and (tokens[0] in IGNORAR_AL_FRENTE
                      or ("=" in tokens[0] and not tokens[0].startswith("-"))):
        tokens.pop(0)
    return (tokens[0] if tokens else ""), tokens[1:]


def es_texto(segmento):
    """¿El segmento solo emite/lee texto? (`echo 'pip install' >> notas.md`)"""
    cmd, _ = cabeza(segmento)
    return cmd in TEXTO or cmd.startswith("#")


def lee_de_stdin(segmento):
    """`sh`, `bash -s -- --yes`, `python3 -`: un interprete sin archivo."""
    cmd, resto = cabeza(segmento)
    if cmd not in INTERPRETES:
        return False
    return all(t.startswith("-") for t in resto)


def veredicto(comando):
    partes = segmentos(comando)
    for i, (texto, tuberia, sustitucion) in enumerate(partes):
        solo_texto = not sustitucion and not tuberia
        if solo_texto and es_texto(texto):
            continue
        entubado = i > 0 and partes[i - 1][1]
        if entubado and lee_de_stdin(texto):
            return "instalar"           # `curl … | sh` y toda su familia
        if FIRMA_ENV.search(texto):
            return "firmar"
        if FIRMA_FLAG.search(texto) and CONTEXTO_KANBAN.search(texto):
            return "firmar"
        if solo_texto and KANBAN_TEXTO.match(texto):
            continue                    # el cuerpo de un comentario es texto
        for patron, familia in PATRONES:
            if patron.search(texto):
                return familia
    return None


# Tools que se bloquean por nombre, sin mirar argumentos. `kanban_unblock` es
# la version "tool" de lo mismo que el patron de terminal: el agente NO se
# desbloquea, ni por un camino ni por el otro.
TOOLS_BLOQUEADAS = {"kanban_unblock": "desbloquear"}


def main():
    try:
        entrada = json.load(sys.stdin)
    except Exception:
        return 0            # payload ilegible: dejar pasar, no romper el turno
    if not isinstance(entrada, dict):
        return 0
    familia = TOOLS_BLOQUEADAS.get(str(entrada.get("tool_name") or ""))
    if not familia:
        familia = veredicto(comando_de(entrada))
    if familia:
        json.dump({"action": "block", "message": MENSAJES[familia]},
                  sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Ni una excepcion nuestra puede dejar al agente sin terminal.
        sys.exit(0)
