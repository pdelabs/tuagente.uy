# tuagente.uy — contexto para una sesión nueva

Dos cosas viven en este repo, en la misma app Next 14:

- **La landing pública** (`app/page.tsx`, `app/blog/`, `app/sections`…) — marketing, SEO.
- **El portal del cliente** (`app/app/`) — el producto: la interfaz con la que un
  cliente ve y dirige a su agente. Es estático; toda la lógica vive en el browser.

Además: `docs/` — la memoria del proyecto.

**Lo que se instala en el agente de un cliente NO vive acá**: el adapter, las
skills y el chequeo de conformidad están en el repo hermano `hermes-kit`.

## Qué es el producto

tuagente.uy vende **agentes de IA autónomos instalados dentro de empresas de
LATAM**, sobre el runtime Hermes (Nous Research). Cada cliente tiene **su propio
agente**, aislado, con su volumen y su clave. El portal es la misma app para
todos: qué módulos muestra lo decide el manifiesto que expone cada agente.

**PRINCIPIO CERO:** el portal sirve a CUALQUIER agente Hermes de cualquier
cliente. Nada específico de un cliente puede entrar en el código ni en el copy
fijo. "La Mano" (el agente de pdelabs) es SOLO el entorno de prueba local.

## Con qué habla el portal

Dos servicios del agente del cliente, nunca un backend nuestro:

- **`:8642` — el gateway de Hermes** (nativo): chat, sesiones, jobs.
- **`:8643` — el adapter** (`portal_adapter.py`, en el repo `hermes-kit`):
  lo que el nativo no expone — tickets, aprobaciones, artefactos, archivos,
  actividad, uso, capacidades, subida de archivos.

Autenticación: bearer con la `API_SERVER_KEY` del cliente, que llega por el
magic link (`/app#endpoint=…&adapter=…&key=…`) y queda en localStorage.

**`app/app/lib/agent.ts` es el ÚNICO punto de red.** Si un módulo necesita algo,
se agrega ahí; no se hacen fetch sueltos (hoy hay deuda de fetchers locales en
pipeline, aprobaciones, artefactos y tareas, marcados con TODO).

## Convenciones de código

- Kit de UI en `app/app/lib/ui.tsx`: **sin sombras**, bordes hairline
  `border-black/[0.07]`, radios `rounded-lg/xl`, tonales `c-violet`/`c-green`/
  `c-coral`/`c-amber`, `primary` #5B4BE8, tipografía Jakarta. Íconos lucide,
  **cero emojis**. Copy en español rioplatense neutro, sin marketinés.
- El markdown del agente se renderiza con `app/app/lib/Markdown.tsx` (GFM, código
  con highlight, KaTeX, mermaid, HTML sanitizado, chips de entidades). **Se usa
  en todos lados**, no solo en el chat.
- Cada módulo vive en su carpeta bajo `app/app/` y no toca `lib/` ni `layout.tsx`.
- Bienvenida por pestaña en `app/app/lib/intros/`: una por módulo, cada una con
  su propia ilustración (nada de ocho pantallas iguales).
- **Todo lo que se abre tiene URL.** El "qué está abierto" se LEE de la URL con
  `app/app/lib/rutas.tsx` (`useParamRuta` / `abrirEnRuta` / `cerrarEnRuta`), no
  de un `useState` en paralelo: por eso refrescar restaura la misma vista y el
  link se puede compartir. Un módulo nuevo agrega su parámetro en `PARAM` y lo
  documenta en `docs/rutas-portal.md`. Ningún link que arme el portal lleva
  hash — ahí viaja la credencial.

## Documentación (leer en este orden)

| Archivo | Para qué |
|---|---|
| `docs/COMPACT.md` | estado, endpoints verificados y **lecciones duras**. Empezá acá. |
| `docs/PENDIENTES.md` | qué quedó abierto y quién lo destraba |
| `docs/rutas-portal.md` | **el contrato de las URLs**: qué dirección tiene cada cosa (y qué puede citar el agente) |
| `docs/alta-cliente.md` | runbook de alta de un cliente nuevo, paso a paso |
| `docs/toolkit-agentes.md` | qué construimos una vez y reusamos en cada agente |
| `docs/roadmap-portal.md` | features por pestaña + temas grandes por definir |
| `docs/specs/` | specs por módulo (histórico de la construcción) |

## Verificar

```bash
npx tsc --noEmit && npm run build
npx next start -p 8090     # el portal, contra el agente local
```

Para verificar que un agente cumple el contrato del portal (manifiesto, auth,
CORS de ambos servicios, cada módulo declarado, archivos como text/plain, proxy
del chat), el chequeo vive en el kit:

```bash
python3 ../hermes-kit/tools/portal-check.py --key <API_SERVER_KEY>
```

Es lo que separa "creo que anda" de "anda".
