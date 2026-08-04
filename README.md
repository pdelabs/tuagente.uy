# hermes-kit

Lo que tuagente.uy instala en el agente de cada cliente. Antes vivía adentro del
agente de pdelabs, así que dar de alta a alguien nuevo era copiar archivos desde
el agente de otro cliente. Esto lo convierte en un procedimiento.

```
nuevo-agente.sh             crea el repo de un cliente nuevo y le instala el kit
install.sh                  instala o compara el kit contra un agente existente
adapter/portal_adapter.py   el sidecar que el portal consume (:8643)
skills/                     artifact · entregable · aprobacion
soul/                       los bloques del system prompt, con placeholders
onboarding/                 la primera tarea del agente (brief de la empresa)
compose/                    plantilla de docker-compose
tools/portal-check.py       verifica que un agente cumpla el contrato del portal
```

## Alta de un cliente nuevo

```bash
./nuevo-agente.sh acme "Acme SA" ~/Desktop/Luis/Projects/agente-acme
```

Crea el repo del agente —compose con el nombre ya puesto, `data/` con su
estructura, `.env.example`, `.gitignore`, un borrador de SOUL armado con los
bloques— le instala el kit y hace el primer commit. Después, a mano:

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

## El kit es una dependencia, no una plantilla

`agente-<cliente>` no *sale* del kit: el kit se **instala adentro** y queda
vinculado. Por eso una mejora del adapter llega a todos los agentes con un
`install.sh`. Si fuera una plantilla que se clona, cada cliente quedaría
congelado en la versión del día que lo diste de alta.
