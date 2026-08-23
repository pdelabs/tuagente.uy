# tuagente.uy — monorepo, contexto para una sesión nueva

Un solo repo con las tres piezas del producto:

| Dónde | Qué es |
|---|---|
| `app/page.tsx`, `app/blog/`, `app/sections` | **la landing pública** — marketing, SEO |
| `app/app/` | **el portal del cliente** — la interfaz con la que un cliente ve y dirige a su equipo de agentes. Estático; toda la lógica vive en el browser |
| `hermes-kit/` | **lo que se instala en el agente de cada cliente** — adapter del portal, skills, roles, SOULs, capacidades, compose y chequeos de conformidad. Tiene su propio `CLAUDE.md` con el contexto profundo: leelo antes de tocar el kit |
| `docs/` | la memoria del proyecto (portal + alta de clientes) |
| `hermes-kit/notas/` | la memoria del kit (mediciones, perillas del motor, estado del pivot) |

Antes eran dos repos (`tuagente.uy` y `hermes-kit`); desde el 22/8/2026 es este
monorepo. El repo viejo de `hermes-kit` queda de archivo. Vercel construye la
raíz (la app Next) y `.vercelignore` deja el kit afuera del deploy.

## Reglas de código — sin excepciones

- **Todo el código se escribe en inglés**: comentarios, nombres de funciones,
  variables, mensajes de commit. Todo. Lo único en español es el **copy que ve
  el cliente** (UI del portal, catálogos, SOULs, skills que lee el agente para
  el cliente) — y ese va en **rioplatense neutro, sin marketinés**. Hay código
  viejo con nombres en español; no se migra en masa, pero nada nuevo entra así.
- **Sin protective programming** — que se rompa fuerte. Un guard se agrega
  cuando protege al cliente de un estado medido, no "por las dudas".
- Documentación interna (`docs/`, `hermes-kit/notas/`) en español.

## Qué es el producto

tuagente.uy vende **equipos de agentes de IA autónomos instalados dentro de
empresas de LATAM**, sobre el runtime Hermes (Nous Research). El cliente
contrata roles (marketing, soporte, ventas, contabilidad, asistente); cada rol
es un profile de Hermes en el mismo contenedor, con su SOUL, sus skills, su
nombre y su cara. El portal es la misma app para todos: qué módulos muestra lo
decide el manifiesto que expone cada agente.

**PRINCIPIO CERO:** el portal y el kit sirven a CUALQUIER agente Hermes de
cualquier cliente. Nada específico de un cliente entra en el código ni en el
copy fijo.

## Con qué habla el portal

Dos servicios del agente del cliente, nunca un backend nuestro:

- **`:8642` — el gateway de Hermes** (nativo): chat, sesiones, jobs. Con
  equipo, cada rol contesta por `/p/<rol>/` con su propia clave.
- **`:8643` — el adapter** (`hermes-kit/adapter/portal_adapter.py`): lo que el
  nativo no expone — tickets, aprobaciones, artefactos, archivos, actividad,
  uso real, capacidades, roles y contrataciones, salas de chat.

Autenticación: bearer con la `API_SERVER_KEY` del cliente, que llega por el
magic link (`/app#endpoint=…&adapter=…&key=…`) y queda en localStorage.

**`app/app/lib/agent.ts` es el ÚNICO punto de red del portal.** Si un módulo
necesita algo, se agrega ahí; no se hacen fetch sueltos.

## Convenciones del portal

- Kit de UI en `app/app/lib/ui.tsx`: **sin sombras**, bordes hairline
  `border-black/[0.07]`, radios `rounded-lg/xl`, tonales `c-violet`/`c-green`/
  `c-coral`/`c-amber`, `primary` #5B4BE8, tipografía Jakarta. Íconos lucide,
  **cero emojis**.
- El markdown del agente se renderiza con `app/app/lib/Markdown.tsx` (GFM,
  código con highlight, KaTeX, mermaid, HTML sanitizado, chips de entidades).
  **Se usa en todos lados**, no solo en el chat.
- Cada módulo vive en su carpeta bajo `app/app/` y no toca `lib/` ni
  `layout.tsx`.
- Bienvenida por pestaña en `app/app/lib/intros/`: una por módulo, cada una con
  su propia ilustración.
- **Todo lo que se abre tiene URL.** El "qué está abierto" se LEE de la URL con
  `app/app/lib/rutas.tsx` (`useParamRuta` / `abrirEnRuta` / `cerrarEnRuta`),
  no de un `useState` en paralelo. Un módulo nuevo agrega su parámetro en
  `PARAM` y lo documenta en `docs/rutas-portal.md`. Ningún link que arme el
  portal lleva hash — ahí viaja la credencial.

## Convenciones del kit (el detalle en `hermes-kit/CLAUDE.md`)

- **El kit es la fuente de la verdad** de lo que corre en cada agente; un fix
  hecho dentro de un agente se trae al kit (`install.sh --diff` lo detecta).
- **Catálogos cerrados** (roles, capacidades, conexiones): el agente elige ids,
  nunca redacta pedidos libres. Nada se auto-instala.
- **El modelo pone las palabras; el código pone el formato.** Cada convención
  que dependió de que el agente se acordara, falló.
- Roles en `hermes-kit/roles/` (identity + flows + role.json); el build valida
  que una identity no pise el SOUL base y que no haya identities clonadas
  (`tools/chequear-clones.py`).

## Documentación (leer en este orden)

| Archivo | Para qué |
|---|---|
| `docs/COMPACT.md` | estado, endpoints verificados y **lecciones duras**. Empezá acá. |
| `hermes-kit/notas/pivot-equipo-estado.md` | el estado del pivot a equipo: qué está hecho, qué falta, decisiones cerradas |
| `docs/PENDIENTES.md` | qué quedó abierto y quién lo destraba |
| `docs/rutas-portal.md` | **el contrato de las URLs** del portal |
| `docs/alta-cliente.md` | runbook de alta de un cliente nuevo (equipos incluidos) |
| `docs/roadmap-portal.md` | features por pestaña + temas grandes por definir |
| `hermes-kit/flota.md` | qué agentes están vivos y qué versión corren |
| `hermes-kit/notas/` | perillas del motor, mediciones, recetas |

## Verificar

```bash
# El portal
npx tsc --noEmit && npm run build
npx next start -p 8090          # contra el agente local

# El kit (desde la raíz del monorepo)
python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
python3 hermes-kit/tools/check-adapter-boundaries.py
python3 hermes-kit/tools/chequear-clones.py

# Un agente, antes de prender
python3 hermes-kit/tools/agente-check.py <ruta>/data

# Un agente encendido: el contrato del portal. 0 fallas o no se entrega.
python3 hermes-kit/tools/portal-check.py --key <API_SERVER_KEY>
```
