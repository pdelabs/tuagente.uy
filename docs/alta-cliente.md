# Alta de un cliente nuevo — de cero a portal andando

Procedimiento sacado de lo que efectivamente funcionó con el agente fixture.
Cada paso que dice "verificado" es algo que ya probamos, no una suposición.

## 0. Lo que se necesita antes de empezar

- Un servidor para el agente (hoy: la Mac; después Railway).
- Claves: `API_SERVER_KEY` (`openssl rand -hex 32`), la del proveedor de modelos,
  y las del canal que use el cliente (Telegram, WhatsApp Cloud, mail).
- Una decisión de negocio: **qué hace este agente y qué requiere aprobación.**
  Si eso no está claro, no arranques: es lo que define el SOUL.

## 1. Levantar el agente

Copiar el `docker-compose.yml` del fixture. Dos servicios:

- `hermes` — el gateway. Puertos 8642 (API) y 9119 (dashboard), **solo loopback**.
- `portal-adapter` — nuestro sidecar, puerto 8643, misma imagen y mismo volumen.

Variables que no se pueden olvidar:

| Variable | Dónde | Para qué |
|---|---|---|
| `AGENT_NAME` | portal-adapter | el nombre que el cliente ve en el portal |
| `API_SERVER_CORS_ORIGINS` | hermes | el origen del portal, o el browser rechaza todo |
| `PORTAL_CORS_ORIGINS` | portal-adapter | ídem para el adapter |
| `TZ` | ambos | los horarios de las tareas se leen mal sin esto |

## 2. Instalar el kit

Copiar a `data/skills/`: `artifact`, `entregable`, `aprobacion`.
Copiar `data/scripts/portal_adapter.py`.

**Paso que parece opcional y no lo es:** agregar al SOUL el bloque que documenta
cada skill con su comando exacto. Verificado el 2026-08-04: una skill que existe
en el directorio y aparece en `hermes skills list` **igual es invisible para el
agente** si no está en el prompt — el índice interno no se regenera solo, ni
siquiera reiniciando el gateway. El agente contesta "esa skill no existe" y sigue
de largo. (Ver `toolkit-agentes.md`.)

## 3. Escribir el SOUL

Lo específico del cliente. Como mínimo:

- Quién es el agente y para quién trabaja.
- **La regla dura de aprobación**: qué jamás hace sin permiso explícito.
- Dónde va cada cosa: entregables por la skill, andamiaje a `workspace/interno/`.
- Cuándo conviene un artefacto en vez de texto.
- Qué hacer con las referencias que llegan del portal (`t_...`, `workspace/...`).

La regla de oro: si una convención importa, que la ejecute un script. El SOUL
sirve para decidir *cuándo*, no para recordar *cómo*.

## 4. Verificar antes de entregar

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY> \
    --adapter http://<host>:8643 --endpoint http://<host>:8642 \
    --origin https://app.tuagente.uy
```

Tiene que dar **0 fallas**. Los avisos son aceptables (por ejemplo "approvals no
declarado" cuando todavía no hay nada esperando aprobación: es correcto, el
módulo aparece cuando hay pendientes).

Además, probar a mano el circuito que vende el producto:
1. Pedirle algo por chat → responde.
2. Pedirle una visualización → crea el artefacto y lo cita.
3. Pedirle algo que requiera permiso → aparece en Aprobaciones con su tabla.
4. Corregir y aprobar → el ticket se destraba con tu versión asentada.
5. Crear una tarea desde el tablero y comentarla → el agente la ve.

## 5. Entregar el acceso

El magic link: `https://app.tuagente.uy/app#endpoint=<api>&adapter=<adapter>&key=<clave>`.
Queda guardado en el navegador del cliente. **Es la credencial**: quien tiene el
link tiene el agente. Mandarlo por un canal privado y no reusar la clave entre
clientes.

## Lo que todavía no está resuelto

- **Multi-cliente de verdad**: hoy una clave = acceso total. Sin usuarios ni
  permisos por persona.
- **Hosting**: mientras el agente viva en una máquina de casa, el portal solo
  funciona en esa red.
- **Varios tableros por cliente**: Hermes los soporta (cada board con su propia
  base), el adapter todavía lee uno fijo.
- **Adjuntar archivos** desde el portal hacia el agente.
