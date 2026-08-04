# hermes-kit

Lo que tuagente.uy instala en el agente de cada cliente. Antes vivía adentro del
agente de pdelabs, así que dar de alta a alguien nuevo era copiar archivos desde
el agente de otro cliente. Esto lo convierte en un procedimiento.

```
adapter/portal_adapter.py   el sidecar que el portal consume (:8643)
skills/                     artifact · entregable · aprobacion
soul/                       los bloques del system prompt, con placeholders
compose/                    plantilla de docker-compose
tools/portal-check.py       verifica que un agente cumpla el contrato del portal
install.sh                  instala o compara contra un agente
```

## Alta de un agente nuevo

```bash
./install.sh /ruta/al/agente/data
```

Copia el adapter y las skills, y crea las carpetas que el portal espera
(`entregables`, `artifacts`, `entrada`, `interno`). Después, a mano:

1. **Componer el SOUL** con los bloques de `soul/` — ver `soul/README.md`.
   Es el único trabajo verdaderamente artesanal y donde está el valor.
2. Completar el compose (`AGENT_NAME`, `TZ`, los dos CORS) y el `.env`.
3. `docker compose up -d`
4. `python3 tools/portal-check.py --key <API_SERVER_KEY>` → **0 fallas o no se
   entrega.**

El runbook completo, con los canales (Telegram, WhatsApp oficial vs puente QR) y
los tiempos reales, está en `tuagente.uy/docs/alta-cliente.md`.

## Mantenerlo sincronizado

```bash
./install.sh /ruta/al/agente/data --diff
```

Dice qué archivos difieren entre el kit y un agente ya instalado. **El kit es la
fuente de la verdad**: si arreglaste algo dentro de un agente, copialo al kit
antes de reinstalar o lo vas a pisar. Correlo antes de cada actualización.

## Por qué el adapter existe

El gateway de Hermes expone chat, sesiones y jobs, pero no el tablero, los
archivos, las aprobaciones ni los artefactos. Y sirve el stream de chat de
sesiones **sin cabeceras CORS**, así que el browser lo descarta: el adapter lo
proxea. Todo lo que escribe al kanban va por el CLI de Hermes, nunca por SQL.

Contrato y endpoints verificados: `tuagente.uy/docs/COMPACT.md`.
