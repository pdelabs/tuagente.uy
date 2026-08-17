"use client";

// Shell del portal: sidebar por manifest + estado de conexión con el agente.
// Los features viven en subcarpetas y NO tocan este archivo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, ChevronDown, Columns3, Folder, Hand, Home,
  LayoutDashboard, LifeBuoy, LogOut, MessageSquare, Plug, Puzzle, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  loadConfig, clearConfig, getManifest, getApprovals, EVENTO_APROBACIONES,
  esPedidoDelCliente, aprenderHusoDelAgente, CLAVE_CONFIG, configGuardada,
  credencialEnLaURL, mismaSesion,
  type PortalConfig, type Manifest,
} from "./lib/agent";
import { Btn, SOPORTE, Soporte, Spinner, inputCls } from "./lib/ui";
import {
  avisarRuta, limpiarCredencialDeLaURL, urlApuntaADetalle, useApuntaADetalle,
  volverAlaPestania,
} from "./lib/rutas";
import { INTROS, useIntroGate } from "./lib/intros";
import Onboarding, {
  AvisoSinCanal, altaYaContestada, loadAgentName, saveAgentName,
} from "./lib/onboarding";
import {
  AgentitoAvatar, hayLookGuardado, loadAgentLook, lookDesdeAgente, saveAgentLook,
} from "./lib/agentito";

// Orden y rótulos de módulos; se muestran solo los que el manifest habilita
// (salvo "home", que es nuestro y no depende de lo que exponga el agente).
// `sec` = vive bajo "Más": son las vistas de taller (archivos, uso, skills…).
// El nav principal es lo que el cliente usa a diario: sus flujos, su chat,
// sus trabajos en curso. "Tareas" (crons) se fue del nav: era la vista de
// máquina que Flujos reemplaza (la ruta sigue viva para nosotros).
// Módulos que el agente declara pero que el portal NO muestra todavía. Es un
// interruptor, no un borrado: la pantalla, su ruta y su bienvenida siguen
// enteras, y sacar la clave de acá las devuelve al nav.
//
// `usage` está oculto desde el 16/8/2026 porque el número que muestra es FALSO
// y falso para abajo, que es la peor dirección: sólo ve lo que pasa por
// litellm, y la generación de imágenes le pega directo al proveedor. Medido ese
// día contra la cuenta real de OpenRouter: la pestaña decía US$ 0,17 y el
// proveedor había cobrado US$ 1,52 — 9x. Un cliente que planifica con eso se
// entera del gasto real cuando le llega la factura. Vuelve cuando el total
// salga de lo que el proveedor cobró y no de lo que nosotros vimos pasar.
export const MODULOS_OCULTOS = new Set<string>(["usage"]);

export const MODULES: { key: string; path: string; label: string; icon: LucideIcon; sec?: boolean }[] = [
  { key: "home", path: "/app/inicio", label: "Inicio", icon: Home },
  { key: "chat", path: "/app/chat", label: "Chat", icon: MessageSquare },
  // WHO works for you comes before WHAT they are doing, so this sits high and
  // never under "Más". It only appears on an agent that has a team: the module
  // is false on every single-role agent, which is all of them today.
  { key: "roles", path: "/app/equipo", label: "Equipo", icon: Users },
  { key: "flujos", path: "/app/flujos", label: "Flujos", icon: Workflow },
  // Actividad sale de "Más" (13/8) y queda pegada a Flujos. Las dos clientas
  // del QA a ciegas la fueron a buscar y las dos dijeron lo mismo: "es donde
  // está la verdad" y "debería estar arriba". Una de ellas descubrió AHÍ que
  // sus dos flujos habían fallado, mientras Flujos los mostraba en verde. Ese
  // agujero ya está tapado del otro lado, pero la bitácora de lo que hizo el
  // agente no es una vista de taller: es la prueba de que trabajó.
  { key: "activity", path: "/app/actividad", label: "Actividad", icon: Activity },
  { key: "kanban", path: "/app/pipeline", label: "Tablero", icon: Columns3 },
  { key: "approvals", path: "/app/aprobaciones", label: "Aprobaciones", icon: Hand },
  // Principal por decisión de Luis (7/8): la vitrina de lo producido —
  // entregables de los flujos + visualizaciones, en una sola pestaña.
  { key: "artifacts", path: "/app/artefactos", label: "Entregas", icon: LayoutDashboard },
  // Conexiones sale de "Más" (8/8): es lo PRIMERO que necesita un cliente
  // nuevo — sin su correo y sus planillas el agente no puede hacer nada — y
  // estaba escondido abajo de todo. Un cliente de prueba lo buscó por cinco
  // pestañas y su frase fue "es como poner la llave de la luz adentro del
  // ropero". Media docena de pantallas le prometen "los sistemas que le
  // conectaste": el lugar donde se conectan no puede estar plegado.
  { key: "connections", path: "/app/conexiones", label: "Conexiones", icon: Plug },
  { key: "files", path: "/app/archivos", label: "Archivos", icon: Folder, sec: true },
  { key: "usage", path: "/app/uso", label: "Uso", icon: BarChart3, sec: true },
  { key: "capabilities", path: "/app/habilidades", label: "Habilidades", icon: Puzzle, sec: true },
];

function Login({ onReady }: { onReady: () => void }) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  // Quien llega por un link compartido (a un entregable, a una tarea) y no
  // tiene sesión en ESTE browser caía en un login que no explicaba nada: se
  // veía como el portal equivocado. Le decimos que el link es bueno y que
  // apenas entre lo llevamos ahí — y es cierto: `reload()` conserva la ruta.
  const [venia, setVenia] = useState(false);
  useEffect(() => { setVenia(urlApuntaADetalle()); }, []);
  // "magic link" era jerga: un cliente de prueba leyó "link mágico" y no supo
  // qué pegar, porque el único link que tenía era con el que ya había entrado.
  const enter = () => {
    const hash = link.includes("#") ? link.slice(link.indexOf("#")) : `#key=${link.trim()}`;
    if (!/key=[^&]+/.test(hash)) { setErr("A ese link le falta el código del final. Copialo entero, desde https hasta el último carácter."); return; }
    window.location.hash = hash;
    // Recarga COMPLETA a propósito: cambiar solo el hash deja vivo el JS del
    // build anterior, y tras un redeploy ese runtime pide chunks que ya no
    // existen (404) y la app queda colgada en el spinner. Verificado el 7/8.
    window.location.reload();
  };
  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-xl border border-black/[0.07] bg-white p-8">
        <AgentitoAvatar className="mb-3 h-14 w-14" />
        <h1 className="text-xl font-bold tracking-tight text-ink">tuagente</h1>
        {venia && (
          <p className="mt-1 rounded-lg border border-c-violet bg-c-violet/40 px-3 py-2 text-[13px] leading-snug text-c-violet-ink">
            Este link lleva a algo que está adentro de tu portal. Entrá y te dejo
            justo ahí.
          </p>
        )}
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          Pegá acá el link que te dimos para entrar. Es el que te mandamos cuando dimos
          de alta a tu agente — largo y con un código al final.
        </p>
        <input
          value={link}
          onChange={(e) => { setLink(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          placeholder="https://app.tuagente.uy/app#key=…"
          className={inputCls}
        />
        {err && <p className="mt-2 text-sm text-c-coral-ink">{err}</p>}
        <div className="mt-4"><Btn onClick={enter}>Entrar</Btn></div>
        <div className="mt-5 border-t border-black/[0.07] pt-3"><Soporte /></div>
      </div>
    </main>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /app/avatar es la página utilitaria que fotografía Chrome headless para el
  // PNG del bot: va SIN shell (ni sidebar ni puerta de onboarding — un browser
  // headless siempre tiene localStorage virgen y caería en la bienvenida:
  // exactamente la foto equivocada que subimos el 7/8).
  if (pathname.startsWith("/app/avatar")) return <>{children}</>;
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [state, setState] = useState<"loading" | "login" | "error" | "ok" | "otro">("loading");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  // Nombre y look que el cliente le dio a su agente en el onboarding.
  // El look se lee lazy y no en un efecto: si no, el primer frame pinta el
  // agentito violeta por defecto y se ve el parpadeo.
  const [nombre, setNombre] = useState<string | null>(null);
  const [lookAgente, setLookAgente] = useState(loadAgentLook);
  // "Más" arranca cerrado: las vistas de taller no compiten con los flujos.
  const [verMas, setVerMas] = useState(false);
  useEffect(() => { setNombre(loadAgentName()); }, []);
  const { seen, dismiss } = useIntroGate();

  // LOS HOOKS VAN TODOS ACÁ ARRIBA, antes de cualquier `return` condicional.
  // Puestos más abajo —después de los returns de loading/login/error— la
  // cantidad de hooks cambia entre renders y React tira el #310, que en
  // producción es una pantalla en blanco con "Application error". Me pasó el
  // 11/8 y dejó el chat inusable.
  //
  // Se lee de window y no con useSearchParams: ese hook obliga a envolver todo
  // el layout en un <Suspense> para que Next prerenderice, y no vale la pena
  // por un parámetro que solo importa después de montar. `useApuntaADetalle`
  // hace justamente eso, y además se entera de los cambios de URL.
  //
  // Cuenta como intención CUALQUIER link a algo concreto, no solo el `?p=` del
  // chat: si el agente te manda el link de un entregable y esa pestaña nunca la
  // abriste, la bienvenida del módulo se te pone adelante de lo que viniste a
  // ver. Un link compartido tiene que abrir la cosa, no la portada.
  //
  // Se PEGA mientras no cambies de pestaña, y esa es la parte importante: el
  // chat borra su `?p=` de la URL apenas manda el mensaje, y si esto lo
  // siguiera al pie, la bienvenida volvería a aparecer arriba de la
  // conversación que el cliente acaba de empezar (el bug del 11/8).
  const apuntaADetalle = useApuntaADetalle(pathname);
  const [conIntencion, setConIntencion] = useState(false);
  useEffect(() => { setConIntencion(false); }, [pathname]);
  useEffect(() => { if (apuntaADetalle) setConIntencion(true); }, [apuntaADetalle, pathname]);
  const moduloActual = MODULES.find((m) => pathname.startsWith(m.path));

  // La credencial viaja en el hash y se queda pegada en la barra de
  // direcciones. Con "copiar link" en cada pantalla, eso pasa de ser feo a ser
  // peligroso: el cliente copia la URL a mano y comparte su clave. Se limpia
  // apenas está guardada. En un timeout porque el parche de history de Next se
  // instala en un efecto del router, que corre DESPUÉS de los efectos de sus
  // hijos: sin esperar un tick, el replaceState se lo comería el original.
  useEffect(() => {
    const t = setTimeout(limpiarCredencialDeLaURL, 0);
    return () => clearTimeout(t);
  }, []);

  // PEGAR UN SEGUNDO MAGIC LINK ESTANDO YA ADENTRO. Si la ruta es la misma que
  // la abierta, el browser lo trata como una navegación de FRAGMENTO: no
  // recarga nada, `loadConfig()` —que corre una vez al cargar el JS— ya pasó, y
  // la credencial nueva queda decorando la barra de direcciones sin efecto
  // hasta que el cliente refresque a mano. Es la forma más natural de cambiar
  // de agente (o de volver a entrar con la clave rotada) y fallaba en silencio:
  // el portal seguía mostrando al agente anterior como si el link no sirviera.
  //
  // Recargamos y listo: en el arranque `loadConfig()` la guarda, olvida lo del
  // agente anterior y el portal entra derecho al nuevo. Si el link es el que ya
  // está puesto, no se recarga nada — solo se limpia la clave de la barra.
  // (`replaceState` no dispara `hashchange`, así que esto no se llama solo.)
  useEffect(() => {
    if (!cfg) return;
    const alPegarOtroLink = () => {
      const nueva = credencialEnLaURL();
      if (!nueva?.key) return;
      const efectiva = {
        endpoint: nueva.endpoint ?? cfg.endpoint,
        adapter: nueva.adapter ?? cfg.adapter,
        key: nueva.key,
      };
      if (mismaSesion(efectiva, cfg)) { limpiarCredencialDeLaURL(); return; }
      window.location.reload();
    };
    window.addEventListener("hashchange", alPegarOtroLink);
    return () => window.removeEventListener("hashchange", alPegarOtroLink);
  }, [cfg]);

  // Un `<Link>` de Next hacia la pestaña donde ya estás no dispara popstate, así
  // que las pantallas no se enterarían de que la URL cambió.
  useEffect(() => { avisarRuta(); }, [pathname]);
  // OJO: entrar por un link NO marca la bienvenida como vista. Antes sí, y el
  // cliente que estrenaba el portal con el link de un entregable se quedaba sin
  // conocer nunca esa pestaña. Alcanza con no mostrarla ahora (`showIntro` ya
  // mira `conIntencion`, que se mantiene mientras siga en esa pestaña).

  // Si este browser no conoce al agente pero el agente sí se conoce a sí mismo
  // (el cliente lo bautizó desde otra máquina, o entró con otro link y se
  // limpió lo del anterior), el portal se lo copia.
  //
  // El NOMBRE también, y no solo la pinta: media docena de pantallas lo leen
  // del browser sin tener el manifiesto a mano (`loadAgentName() || "Tu
  // agente"`), así que sin esta copia el cliente que entra desde otra máquina
  // ve a su agente llamado "Tu agente" en el tablero y en las aprobaciones.
  const aprenderDelAgente = (m: Manifest) => {
    if (m.bautizado && m.agent && !loadAgentName()) {
      saveAgentName(m.agent);
      setNombre(m.agent);
    }
    if (hayLookGuardado()) return;
    const suyo = lookDesdeAgente(m.look);
    if (suyo) { saveAgentLook(suyo); setLookAgente(suyo); }
  };

  // EN QUÉ RELOJ VIVE EL NEGOCIO, ANTES DE PINTAR NADA. Todas las pantallas
  // muestran las fechas en el huso del agente, pero sólo tres lo aprendían:
  // entrar derecho a cualquiera de las otras ocho —el primer día de un cliente,
  // o con Inicio caído— dejaba el portal contando las horas con el reloj del
  // browser sin avisar. Se pide una vez, en el arranque, y vale para todas.
  const conocerElReloj = (c: PortalConfig, m: Manifest) => {
    aprenderHusoDelAgente(c, m).catch(() => { /* sin huso se sigue como antes */ });
  };

  const boot = () => {
    const c = loadConfig();
    if (!c) { setState("login"); return; }
    setCfg(c);
    getManifest(c)
      .then((m) => {
        setManifest(m); aprenderDelAgente(m); conocerElReloj(c, m);
        setOnline(true); setState("ok");
      })
      .catch(() => setState("error"));
  };
  useEffect(boot, []);

  // Reintento a mano: sin esto el botón no da NINGUNA señal de que hizo algo
  // (mismo pantallazo, mismo texto) y el cliente concluye que no funciona el
  // botón. El mínimo de 600 ms es para que el cambio se llegue a ver.
  const [reintentando, setReintentando] = useState(false);
  const reintentar = () => {
    setReintentando(true);
    const desde = Date.now();
    const listo = () => setTimeout(() => setReintentando(false), Math.max(0, 600 - (Date.now() - desde)));
    const c = loadConfig();
    if (!c) { setState("login"); listo(); return; }
    setCfg(c);
    getManifest(c)
      .then((m) => {
        setManifest(m); aprenderDelAgente(m); conocerElReloj(c, m);
        setOnline(true); setState("ok");
      })
      .catch(() => setState("error"))
      .finally(listo);
  };

  // La credencial vive en localStorage, que es del ORIGEN y no de la pestaña:
  // si en otra pestaña se entra con el link de OTRO agente, esta se queda con
  // el agente viejo en memoria (el shell, el manifiesto, la pestaña que ya
  // estaba abierta) y el nuevo en el disco — y desde ahí cada pantalla que se
  // monta lee el nuevo. El resultado es una ventana mostrando dos clientes a la
  // vez: el sidebar con las aprobaciones de uno y el chat con las
  // conversaciones del otro. (Reproducido el 12/8 con dos agentes de prueba.)
  //
  // No recargamos solos: puede haber un mensaje a medio escribir. Frenamos la
  // pestaña —los módulos ni se pintan— y que el cliente decida.
  useEffect(() => {
    if (!cfg) return;
    const alCambiar = (e: StorageEvent) => {
      // `key === null` es un `localStorage.clear()` de otra pestaña.
      if (e.key !== null && e.key !== CLAVE_CONFIG) return;
      if (!mismaSesion(configGuardada(), cfg)) setState("otro");
    };
    window.addEventListener("storage", alCambiar);
    return () => window.removeEventListener("storage", alCambiar);
  }, [cfg]);

  // El indicador tiene que decir la verdad: si el agente se apaga mientras el
  // portal está abierto, el punto verde mintiendo es peor que no tenerlo.
  // De paso traemos los pendientes, que es lo que el cliente quiere ver al entrar.
  useEffect(() => {
    if (state !== "ok" || !cfg) return;
    const tick = () => {
      getManifest(cfg).then((m) => { setManifest(m); setOnline(true); })
        .catch(() => setOnline(false));
      getApprovals(cfg)
        // El badge cuenta lo que ESPERA TU OK. Los pedidos que hizo el propio
        // cliente ("conectame el correo") están en la misma lista pero son
        // nuestros: su tarjeta dice "no tenés que hacer nada" y el menú, al
        // mismo tiempo, le marcaba un pendiente. Contar eso es pedirle algo
        // que no tiene que hacer. El MISMO filtro que Inicio y Aprobaciones:
        // uno solo, en `lib/agent.ts`.
        .then((r) => setPending(
          (r.approvals ?? []).filter((a: { body?: string }) => !esPedidoDelCliente(a?.body)).length,
        ))
        .catch(() => setPending(0));
    };
    tick();
    const id = setInterval(tick, 60_000);
    // Y cuando el cliente resuelve una aprobación, ya: esperar hasta un minuto
    // con el "1" puesto le hace creer que su clic no llegó. El segundo tick es
    // porque destrabar el ticket tarda un segundo del lado del agente y el
    // primero puede llegar a leer la cola todavía sin actualizar.
    const alResolver = () => { tick(); setTimeout(tick, 2500); };
    window.addEventListener(EVENTO_APROBACIONES, alResolver);
    return () => {
      clearInterval(id);
      window.removeEventListener(EVENTO_APROBACIONES, alResolver);
    };
  }, [state, cfg]);

  if (state === "loading") return <main className="app-shell min-h-screen bg-surface"><Spinner /></main>;
  if (state === "login") return <Login onReady={boot} />;
  // Otro agente entró en este navegador. Antes que mezclar dos clientes en una
  // pantalla, esta pestaña se queda quieta.
  if (state === "otro") {
    return (
      <main className="app-shell flex min-h-screen flex-col items-center justify-center bg-surface p-6 text-center">
        <AgentitoAvatar look={lookAgente} apagado className="mb-2 h-20 w-20 opacity-45 grayscale" />
        <p className="text-sm font-semibold text-ink">Se abrió otro portal en este navegador</p>
        <p className="mb-4 mt-1 max-w-sm text-sm text-ink-soft">
          En otra pestaña se entró con un link distinto. Para no mezclar el trabajo
          de dos agentes, esta pestaña se quedó quieta: recargá y seguís con el que
          está activo ahora.
        </p>
        <Btn size="sm" onClick={() => window.location.reload()}>Recargar</Btn>
        <Soporte className="mt-5" />
      </main>
    );
  }
  if (state === "error" || !manifest || !cfg) {
    return (
      <main className="app-shell flex min-h-screen flex-col items-center justify-center bg-surface p-6 text-center">
        {/* Apagado: el mismo agentito, dormido y sin color. */}
        <AgentitoAvatar look={lookAgente} apagado className="mb-2 h-20 w-20 opacity-45 grayscale" />
        <p className="text-sm font-semibold text-ink">No pude conectar con tu agente</p>
        <p className="mb-4 mt-1 max-w-sm text-sm text-ink-soft">
          Puede estar apagado un rato, o puede ser tu conexión a internet. No perdiste nada:
          el trabajo de tu agente sigue guardado.
        </p>
        <div className="flex gap-2">
          <Btn size="sm" disabled={reintentando} onClick={reintentar}>
            {reintentando ? "Probando…" : "Probar de nuevo"}
          </Btn>
          <Btn kind="secondary" size="sm" onClick={() => { clearConfig(); setState("login"); }}>Cambiar link</Btn>
        </div>
        <Soporte className="mt-5" />
      </main>
    );
  }

  // Onboarding: antes que cualquier módulo, el cliente bautiza a su agente y
  // el agente se presenta. Completa la bienvenida general, así que también
  // marca la intro de "home" (si no, hay dos pantallas de bienvenida seguidas).
  //
  // QUIÉN DECIDE SI EL ALTA VA ES EL AGENTE, NO EL BROWSER. Se decidía sólo con
  // lo que este navegador se acordaba, y cambiar de agente borra todo lo del
  // anterior (`olvidarAgente`): entrar con el link de un agente ya bautizado y
  // configurado le volvía a correr el alta entera —incluido "¿Por dónde te
  // aviso?"— y contestarla le ESCRIBE al agente, pisándole el canal que ya
  // tenía. Le pasó a un auditor con un agente configurado hacía rato: tuvo que
  // saltear la pregunta a mano para no escribirle. El manifiesto ya dice
  // `bautizado` y `aviso`: si el agente contestó, no se le vuelve a preguntar.
  // Un agente nuevo (sin bautizar) sigue viendo el alta completa, y uno
  // bautizado al que le falta el canal la ve desde la presentación —que es
  // donde `Onboarding` arranca cuando `bautizado` es true—.
  if (seen && !seen.onboarding && !altaYaContestada(manifest)) {
    return (
      <Onboarding
        manifest={manifest}
        cfg={cfg}
        onDone={(n) => {
          setNombre(n);
          setLookAgente(loadAgentLook());
          dismiss("onboarding");
          dismiss("home");
        }}
      />
    );
  }

  const enabled = MODULES.filter(
    (m) => !MODULOS_OCULTOS.has(m.key)
      && (m.key === "home" || m.key === "capabilities" || manifest.modules[m.key]));
  // Bienvenida por módulo: se ve una sola vez, hasta que el cliente da "Ok".
  const current = moduloActual;
  const Intro = current ? INTROS[current.key] : undefined;
  // La bienvenida del módulo NO se muestra si el cliente llegó con una
  // intención explícita (/app/chat?p=…): venía de tocar "armá esto" y su
  // mensaje ya está enviado. Mostrarle la portada del chat encima es una
  // puerta que se abre después de que entró — y esconde la conversación que
  // él mismo pidió. Se marca como vista para que no reaparezca más tarde,
  // en el medio de esa conversación.
  const showIntro = Boolean(
    current && Intro && seen && !seen[current.key] && !conIntencion);

  const item = (m: (typeof MODULES)[number]) => {
    const active = pathname.startsWith(m.path);
    const Icon = m.icon;
    return (
      <Link
        key={m.key}
        href={m.path}
        // Tocar la pestaña en la que ya estás cierra el detalle abierto. Sin
        // esto el `<Link>` cambia la URL, Next no navega a ningún lado (mismo
        // path) y el modal queda abierto sobre una URL que ya no lo nombra.
        onClick={(e) => {
          if (pathname === m.path && window.location.search) {
            e.preventDefault();
            volverAlaPestania();
          }
        }}
        // relative: el badge se posiciona sobre el ícono en el riel.
        title={m.label}
        className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition max-md:justify-center max-md:px-0 ${
          active
            ? "bg-c-violet/60 font-semibold text-primary"
            : "text-ink-soft hover:bg-black/[0.04] hover:text-ink"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 md:inline">{m.label}</span>
        {m.key === "approvals" && pending > 0 && (
          <span className={`rounded-full text-[10px] font-bold max-md:absolute max-md:right-1 max-md:top-1 max-md:h-4 max-md:w-4 max-md:leading-4 md:px-1.5 md:py-0.5 ${
            active ? "bg-white/25 text-white" : "bg-c-coral text-c-coral-ink"
          }`}>
            {pending}
          </span>
        )}
        {/* Conexiones que el flujo necesita y faltan: puntito ámbar. */}
        {m.key === "connections" && (manifest.conexiones_pendientes ?? 0) > 0 && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-c-amber-ink max-md:absolute max-md:right-1 max-md:top-1" />
        )}
      </Link>
    );
  };
  return (
    <div className="app-shell flex min-h-screen bg-surface">
      {/* En pantallas chicas la barra se reduce a un riel de íconos: 224px
          fijos dejaban sin aire al contenido. */}
      <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-black/[0.07] px-2 py-4 md:w-56 md:px-3">
        <div className="mb-4 flex items-center gap-2.5 px-1 md:px-2">
          {/* El agente con su look, no un logo genérico: este portal es SU casa. */}
          <AgentitoAvatar look={lookAgente} className="h-9 w-9 shrink-0" />
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-bold tracking-tight text-ink">{nombre || manifest.agent}</p>
            <p className="flex items-center gap-1 text-[11px] text-ink-soft">
              <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-c-green-ink" : "bg-c-coral-ink"}`} />
              {online ? "conectado" : "sin conexión"}
            </p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {enabled.filter((m) => !m.sec).map(item)}

          {/* "Más": las vistas de taller. Si algo ahí adentro le pide algo al
              cliente (conexión pendiente), el puntito sube al propio "Más"
              para que colapsado no esconda nada importante. */}
          {enabled.some((m) => m.sec) && (
            <>
              <button
                onClick={() => setVerMas((v) => !v)}
                aria-expanded={verMas}
                title="Más"
                className="relative mt-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-ink-soft transition hover:bg-black/[0.04] hover:text-ink max-md:justify-center max-md:px-0"
              >
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${verMas ? "" : "-rotate-90"}`} />
                <span className="hidden flex-1 text-left md:inline">Más</span>
                {!verMas && (manifest.conexiones_pendientes ?? 0) > 0 && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-c-amber-ink max-md:absolute max-md:right-1 max-md:top-1" />
                )}
              </button>
              {verMas && enabled.filter((m) => m.sec).map(item)}
            </>
          )}
        </nav>
        {/* Auxilio siempre a la vista: cuando algo se rompe, el cliente no
            tiene que salir a buscar un teléfono en un mail viejo. */}
        <div className="mt-auto flex flex-col gap-0.5 px-1">
          <a
            href={SOPORTE.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            title="Escribinos"
            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] text-ink-soft transition hover:text-primary max-md:justify-center"
          >
            <LifeBuoy className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Escribinos</span>
          </a>
          <button
            onClick={() => { clearConfig(); setState("login"); }}
            title="Salir"
            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] text-ink-soft transition hover:text-ink max-md:justify-center"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Salir</span>
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {showIntro && current && Intro ? (
          <Intro onOk={() => dismiss(current.key)} />
        ) : (
          <>
            {/* El alta dejó pasar sin canal de aviso: acá se vuelve a ofrecer.
                Se dibuja solo cuando el cliente contestó "ahora no"; el resto
                del tiempo no ocupa ni un píxel. */}
            <AvisoSinCanal manifest={manifest} />
            {children}
          </>
        )}
      </main>
    </div>
  );
}
