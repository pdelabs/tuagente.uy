---
titulo: Entrada por Google Drive
para_cliente: "Revisa tus carpetas de Drive y trae los videos y audios nuevos para trabajarlos."
name: entrada-drive
description: "Revisa las carpetas de Google Drive del cliente y baja los videos/audios nuevos al workspace. Usala cuando una tarea programada te pida revisar si llego material nuevo (entrevistas, grabaciones); el script te dice que bajo y donde quedo."
version: 1.0.0
license: MIT
---

# entrada-drive — traer lo nuevo de las carpetas del cliente

Corre normalmente desde una tarea programada. El script hace todo lo mecánico;
vos solo mirás el resultado y seguís el flujo del cliente con lo que llegó.

## Uso

```bash
python3 /opt/data/skills/entrada-drive/vigilar.py \
  --carpeta ID_DE_CARPETA [--carpeta OTRA]
```

Los IDs de carpeta están en la configuración del cliente (los dejó el alta —
no los inventes ni los pidas por chat).

Devuelve `nuevos`: por cada archivo nuevo, `nombre` y `archivo` (la ruta local
donde quedó, en `workspace/entrada/`). Si `nuevos` está vacío, **no hay nada
que hacer**: terminá sin más vueltas.

## Qué resuelve el script (no lo hagas vos)

- Recuerda qué archivos ya se procesaron: no vuelve a bajar lo mismo.
- Solo trae videos y audios; ignora el resto de la carpeta.
- Refresca el token de Google solo. Si dice que falta la conexión, el cliente
  tiene que conectar Google (pestaña Conexiones) — no intentes autenticarte
  vos.

## Después de bajar

Lo que sigue depende del flujo del cliente (está en tu SOUL). El caso típico:
`transcribir` el archivo y seguir con la skill de redacción del cliente.
