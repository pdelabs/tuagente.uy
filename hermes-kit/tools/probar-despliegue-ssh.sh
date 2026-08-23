#!/usr/bin/env bash
# Despliega el kit contra un sshd DE VERDAD, en un contenedor, con el rsync de
# GNU — el que hay en la VPS.
#
#   tools/probar-despliegue-ssh.sh
#
# POR QUE EXISTE. `comparar-instaladores.sh` corre el desplegador con
# `--destino-local`, o sea SIN protocolo: rsync opera en modo local y en la Mac
# ese rsync es **openrsync**, que no es el de la VPS. La diferencia no es
# teorica: `--no-implied-dirs` (que openrsync tolera creando los directorios
# igual) hace que GNU rsync 3.4.3 aborte el envio entero —
#
#     ABORTING due to invalid path from sender: data/connections/catalogo.json
#
# — con rc=2 y CERO archivos transferidos. El agente queda con `data/` y nada
# mas: sin adapter, sin politica/, sin kit-skills, sin manifiesto. El comparador
# daba rc=0 y "29 archivos idénticos" con produccion rota.
#
# Regla que sale de ahi: **cualquier opcion nueva de rsync se prueba aca antes
# de tocar produccion.** El modo local sirve para el contenido; el protocolo
# solo lo valida esto.
#
# QUE NO CUBRE, para que nadie lo lea de mas: nombres de archivo raros
# (espacios, tildes, comillas), el contenido de los dos composes, las variables
# de entorno, ufw, el DNS, el candado del config.yaml y la instalacion del SOUL.
# Esto valida el PROTOCOLO y el borrado: que el kit llegue entero por ssh, que lo
# del cliente no se toque, y que lo que el kit dejo de traer se saque bien.
#
# Necesita docker y red la primera vez (baja alpine y le instala openssh+rsync).
set -uo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOMBRE="kit-vps-prueba"
PUERTO="${PUERTO_SSH:-2299}"
BANCO="$(mktemp -d)"

limpiar() {
  docker rm -f "$NOMBRE" >/dev/null 2>&1
  rm -rf "$BANCO"
}
trap limpiar EXIT

command -v docker >/dev/null || { echo "no encontré docker" >&2; exit 2; }

echo "→ levantando una VPS de mentira (alpine + sshd + rsync de GNU)"
# La imagen se arma UNA vez y queda cacheada: hacer `apk add` en cada corrida
# depende de la red y el test se volvia intermitente ("no pude autorizar la
# llave" cuando el apk todavia no habia terminado).
IMAGEN="kit-vps-prueba:1"
if ! docker image inspect "$IMAGEN" >/dev/null 2>&1; then
  echo "   (armando la imagen, una sola vez)"
  docker build -q -t "$IMAGEN" - >/dev/null <<'DOCKERFILE' || { echo "no pude armar la imagen" >&2; exit 2; }
FROM alpine:3.20
RUN apk add --no-cache openssh rsync bash && ssh-keygen -A \
 && mkdir -p /root/.ssh && chmod 700 /root/.ssh \
 && printf '#!/bin/sh\nexit 0\n' > /usr/local/bin/docker && chmod +x /usr/local/bin/docker
CMD ["/usr/sbin/sshd", "-D", "-e", "-o", "PermitRootLogin=yes", "-o", "PasswordAuthentication=no"]
DOCKERFILE
fi

docker rm -f "$NOMBRE" >/dev/null 2>&1
docker run -d --name "$NOMBRE" -p "127.0.0.1:$PUERTO:22" "$IMAGEN" >/dev/null \
  || { echo "no pude levantar el contenedor" >&2; exit 2; }

ssh-keygen -q -t ed25519 -N "" -f "$BANCO/llave" || exit 2
autorizada=0
for _ in $(seq 1 30); do
  if docker exec -i "$NOMBRE" sh -c 'cat > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys' \
       < "$BANCO/llave.pub" 2>/dev/null; then
    autorizada=1; break
  fi
  sleep 1
done
[[ $autorizada -eq 1 ]] || { echo "no pude autorizar la llave en el contenedor" >&2
  docker logs "$NOMBRE" 2>&1 | tail -5 >&2; exit 2; }

# El desplegador llama a `ssh` y a `rsync` sin opciones de conexion, asi que la
# configuracion entra por un `ssh` propio en el PATH — que es tambien el que
# usa rsync como shell remoto.
mkdir -p "$BANCO/bin"
cat > "$BANCO/bin/ssh" <<EOF
#!/usr/bin/env bash
exec /usr/bin/ssh -i "$BANCO/llave" -p $PUERTO \\
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \\
  -o LogLevel=ERROR "\$@"
EOF
chmod +x "$BANCO/bin/ssh"

for _ in $(seq 1 30); do
  PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 true 2>/dev/null && break
  sleep 1
done
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 true 2>/dev/null || {
  echo "no llegué por ssh al contenedor" >&2; exit 2; }
echo "   rsync de la VPS: $(PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 'rsync --version | head -1')"

echo "→ desplegando"
if ! PATH="$BANCO/bin:$PATH" "$KIT/desplegar-remoto.sh" prueba root@127.0.0.1 ejemplo.local \
     > "$BANCO/salida.txt" 2>&1; then
  echo "FALLA: el despliegue terminó con error"
  sed 's/^/   /' "$BANCO/salida.txt" | tail -25
  exit 1
fi
grep -E "rsync error|ABORTING|invalid path" "$BANCO/salida.txt" | sed 's/^/   /' && {
  echo "FALLA: rsync se quejó (arriba). Con rc=0 igual puede no haber transferido nada."
  exit 1; }

# ── lo que tiene que haber llegado ────────────────────────────────────────
echo "→ verificando contra el manifiesto"
R=/opt/agentes/prueba
fallas=0
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "cat $R/.kit-instalado" > "$BANCO/manifiesto-remoto.txt" 2>/dev/null
if [[ ! -s "$BANCO/manifiesto-remoto.txt" ]]; then
  echo "FALLA: no llegó el manifiesto"; exit 1
fi
echo "   manifiesto remoto: $(wc -l < "$BANCO/manifiesto-remoto.txt" | tr -d ' ') archivos"

# Cada archivo del manifiesto tiene que existir alla y con el sha que dice.
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "cd $R && while IFS=\$'\t' read -r ruta hash; do
    [ -f \"\$ruta\" ] || { echo \"FALTA \$ruta\"; continue; }
    real=\$(sha256sum \"\$ruta\" | cut -d' ' -f1)
    [ \"\$real\" = \"\$hash\" ] || echo \"DISTINTO \$ruta\"
  done < .kit-instalado" > "$BANCO/verificacion.txt" 2>&1
if [[ -s "$BANCO/verificacion.txt" ]]; then
  sed 's/^/   /' "$BANCO/verificacion.txt"; fallas=$((fallas+1))
else
  echo "   todos los archivos del manifiesto llegaron y coinciden por sha256"
fi

# Las carpetas que las skills dan por sentadas, y los dueños que el compose
# necesita: data/ del agente, lo nuestro de root.
for d in data/workspace/entregables data/workspace/artifacts data/workspace/entrada data/workspace/interno; do
  PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "[ -d $R/$d ]" || {
    echo "   FALTA la carpeta $d"; fallas=$((fallas+1)); }
done
echo "   dueños y modos:"
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 \
  "stat -c '     %U:%G %a %n' $R/data $R/politica $R/kit-skills $R/kit-adapter $R/.kit-instalado"
# kit-skills/ y kit-adapter/ son de root (nadie las escribe: van :ro en los dos
# servicios). politica/ es del adapter (uid 10000): ahi escribe politica.json y
# pedidos.jsonl, y lo que la protege del agente es el montaje :ro, no el dueño.
duenos="$(PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "stat -c '%U:%G' $R/kit-skills $R/kit-adapter" | sort -u)"
[[ "$duenos" == "root:root" ]] || { echo "   FALLA kit-skills/ o kit-adapter/ no quedaron de root"; fallas=$((fallas+1)); }
duenopol="$(PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "stat -c '%u' $R/politica")"
[[ "$duenopol" == "10000" ]] || { echo "   FALLA politica/ no quedó del adapter (uid 10000): es $duenopol"; fallas=$((fallas+1)); }

# ── y el segundo despliegue, que es el que borra si algo esta mal ─────────
echo "→ segundo despliegue (incremental) con trabajo del cliente adentro"
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 \
  "mkdir -p $R/data/workspace/entregables && echo 'del cliente' > $R/data/workspace/entregables/reparto.csv &&
   echo '{\"correo\":{\"leer\":true}}' > $R/politica/politica.json &&
   echo '{\"id\":\"imagenes\"}' > $R/politica/capacidades/pedidos.jsonl"
if ! PATH="$BANCO/bin:$PATH" "$KIT/desplegar-remoto.sh" prueba root@127.0.0.1 ejemplo.local \
     > "$BANCO/salida2.txt" 2>&1; then
  echo "FALLA: el segundo despliegue terminó con error"; tail -20 "$BANCO/salida2.txt" | sed 's/^/   /'
  exit 1
fi
for f in data/workspace/entregables/reparto.csv politica/politica.json politica/capacidades/pedidos.jsonl; do
  PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "[ -s $R/$f ]" \
    && echo "   intacto $f" \
    || { echo "   PERDIDO $f"; fallas=$((fallas+1)); }
done
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 \
  "grep -q leer $R/politica/politica.json" \
  && echo "   politica.json conserva los permisos del cliente" \
  || { echo "   FALLA politica.json se pisó"; fallas=$((fallas+1)); }

# ── 3. el BORRADO, que es la parte peligrosa y no la ejercitaba nadie ─────
# `limpiar-obsoletos.sh` corre alla, con el bash y el sha256sum de la VPS. Se le
# siembran dos obsoletos: uno intacto (tiene que irse) y uno editado por el
# cliente (tiene que quedarse), mas una linea envenenada apuntando a un archivo
# del cliente (no puede ser candidata).
echo "→ tercera pasada: lo que el kit dejó de traer"
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "
  mkdir -p $R/kit-skills/skill-que-sacamos $R/politica/mcp/conexion-vieja
  echo 'del kit viejo' > $R/kit-skills/skill-que-sacamos/SKILL.md
  echo 'del kit viejo' > $R/politica/mcp/conexion-vieja/servidor.py
  { cat $R/.kit-instalado
    printf 'kit-skills/skill-que-sacamos/SKILL.md\t%s\n' \$(sha256sum $R/kit-skills/skill-que-sacamos/SKILL.md | cut -d' ' -f1)
    printf 'politica/mcp/conexion-vieja/servidor.py\t%s\n' \$(sha256sum $R/politica/mcp/conexion-vieja/servidor.py | cut -d' ' -f1)
    printf 'data/workspace/entregables/reparto.csv\t%s\n' \$(sha256sum $R/data/workspace/entregables/reparto.csv | cut -d' ' -f1)
  } | sort > $R/.kit-instalado.tmp && mv $R/.kit-instalado.tmp $R/.kit-instalado
  echo '# lo edité yo' >> $R/politica/mcp/conexion-vieja/servidor.py"
if ! PATH="$BANCO/bin:$PATH" "$KIT/desplegar-remoto.sh" prueba root@127.0.0.1 ejemplo.local \
     > "$BANCO/salida3.txt" 2>&1; then
  echo "FALLA: el tercer despliegue terminó con error"; tail -20 "$BANCO/salida3.txt" | sed 's/^/   /'
  exit 1
fi
grep -E "^(quitado|OJO)" "$BANCO/salida3.txt" | sed 's/^/   /'
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "[ -f $R/kit-skills/skill-que-sacamos/SKILL.md ]" \
  && { echo "   FALLA quedó lo que el kit ya no trae"; fallas=$((fallas+1)); } \
  || echo "   se fue lo que el kit dejó de traer"
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "[ -f $R/politica/mcp/conexion-vieja/servidor.py ]" \
  && echo "   quedó lo que el kit ya no trae PERO el cliente editó" \
  || { echo "   FALLA borró un archivo editado por el cliente"; fallas=$((fallas+1)); }
PATH="$BANCO/bin:$PATH" ssh root@127.0.0.1 "[ -s $R/data/workspace/entregables/reparto.csv ]" \
  && echo "   el entregable del cliente sobrevivió a la línea envenenada" \
  || { echo "   FALLA la línea envenenada del manifiesto borró un entregable"; fallas=$((fallas+1)); }

echo
if [[ $fallas -eq 0 ]]; then
  echo "El despliegue por ssh anda: el kit llegó entero, lo del cliente quedó intacto"
  echo "y lo obsoleto se sacó sin llevarse nada puesto."
  exit 0
fi
echo "$fallas falla(s) en el despliegue por ssh."
exit 1
