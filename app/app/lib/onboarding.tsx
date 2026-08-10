"use client";

// Onboarding del portal: se ve UNA sola vez, antes que cualquier módulo.
// Paso 1: el cliente bautiza a su agente — ponerle nombre es la primera
// decisión que toma sobre él. Paso 2: el agente, ya con nombre, cuenta en
// tres líneas qué va a pasar acá adentro.
//
// Nombre y look se guardan EN EL AGENTE (POST /portal/identity, adapter 0.26+)
// y quedan cacheados en localStorage. Así el agente sigue siendo el suyo desde
// cualquier máquina; el browser es solo la copia rápida. Que el agente además
// se PRESENTE con ese nombre (escribirlo en el SOUL) sigue pendiente.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Columns3, Dices, Hand, MessageSquare } from "lucide-react";
import { Btn, inputCls } from "./ui";
import {
  getConnections, guardarIdentidad,
  type Connection, type Manifest, type PortalConfig,
} from "./agent";
import {
  AgentitoCargando, LOOK_DEFAULT, LOOK_EJES, hayLookGuardado, loadAgentLook,
  lookDesdeAgente, saveAgentLook, type AgentitoLook,
} from "./agentito";

// El runtime de Rive (~330 KB gz) se trae solo cuando el onboarding se muestra;
// el resto del portal no lo paga. Mientras tanto, la cara estática.
const AgentitoRive = dynamic(() => import("./AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoCargando />,
});

const NAME_KEY = "tuagente_agent_name";

// Nombres para el placeholder del bautizo. Son apodos cortos y rioplatenses a
// proposito: un apodo se lee como algo que le PONES a alguien cercano, no como
// la identidad formal de una persona — que es justo la lectura que queremos
// evitar. Y nadie se llama legalmente Chispa, asi que la chance de pisarle el
// nombre al cliente es minima.
const NOMBRES_SUGERIDOS = [
  "Tota", "Rulo", "Pepa", "Milo", "Coco", "Nina", "Beto", "Cuca", "Tito", "Lola",
  "Kiko", "Mora", "Nino", "Pocha", "Chispa", "Lino", "Juana", "Bruno", "Tuca", "Rosita",
];

/** La cara que eligió, capturada del canvas de Rive: termina siendo la foto
 *  del bot de Telegram (la sube un tool nuestro por MTProto). Si el canvas no
 *  coopera, el bautizo sigue igual, sin foto. */
function capturaDelAgentito(): { avatar_png?: string } {
  try {
    const canvas = document.querySelector("canvas");
    const data = canvas?.toDataURL("image/png") ?? "";
    if (data.startsWith("data:image/png") && data.length > 2000) {
      return { avatar_png: data.split(",", 2)[1] };
    }
  } catch { /* canvas contaminado o sin buffer: seguimos sin foto */ }
  return {};
}

/** Un look al azar, garantizado distinto del actual. */
function sortearLook(actual: AgentitoLook): AgentitoLook {
  for (;;) {
    const look = { ...actual };
    for (const eje of Object.keys(LOOK_EJES) as (keyof AgentitoLook)[]) {
      look[eje] = Math.floor(Math.random() * LOOK_EJES[eje]);
    }
    if (Object.keys(LOOK_EJES).some((e) => look[e as keyof AgentitoLook] !== actual[e as keyof AgentitoLook])) {
      return look;
    }
  }
}

/** Nombre que el cliente le puso a su agente, o null si nunca lo bautizó. */
export function loadAgentName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

/** Cómo llamamos al agente en el portal: el nombre del cliente, o el del manifest. */
export function agentDisplayName(manifest: Manifest | null): string {
  return loadAgentName() || manifest?.agent || "tu agente";
}

// Qué contamos en el paso 2: solo lo que el manifest habilita.
const PUNTOS = [
  {
    key: "chat",
    icon: MessageSquare,
    tono: "bg-c-violet",
    titulo: "Chat",
    texto: "Hablame como a cualquiera del equipo: me pedís las cosas en tus palabras.",
  },
  {
    key: "kanban",
    icon: Columns3,
    tono: "bg-c-amber",
    titulo: "Tablero",
    texto: "Cada cosa que me pedís queda como una tarea, y ves en qué anda.",
  },
  {
    key: "approvals",
    icon: Hand,
    tono: "bg-c-coral",
    titulo: "Aprobaciones",
    texto: "Antes de un paso sensible freno y espero tu visto bueno.",
  },
];

export default function Onboarding({ manifest, cfg, onDone }: {
  manifest: Manifest;
  cfg: PortalConfig;
  onDone: (name: string) => void;
}) {
  // Si el agente YA fue bautizado (otra máquina, otra persona de la empresa),
  // no se le vuelve a pedir el nombre: se salta directo a la presentación.
  const yaBautizado = Boolean(manifest.bautizado);
  const [nombre, setNombre] = useState(
    () => loadAgentName() ?? (yaBautizado ? manifest.agent : ""));
  const [paso, setPaso] = useState<"bautismo" | "negocio" | "presentacion">(
    yaBautizado ? "presentacion" : "bautismo");
  // Quien es EL CLIENTE. El onboarding le preguntaba el nombre al agente y
  // nunca por el negocio: el portal terminaba hablandole de "nosotros" y el
  // agente firmando con el nombre del dueño anterior.
  // Una sola vez al montar: en el render cambiaria en cada tecla. Y el
  // onboarding nunca se pinta en el server (la puerta espera a localStorage),
  // asi que Math.random aca no rompe la hidratacion.
  const [sugerido] = useState(
    () => NOMBRES_SUGERIDOS[Math.floor(Math.random() * NOMBRES_SUGERIDOS.length)]);
  const [empresa, setEmpresa] = useState("");
  const [url, setUrl] = useState("");
  const [canal, setCanal] = useState<"telegram" | "correo" | "" >("");
  const [mail, setMail] = useState("");
  // El aviso es OBLIGATORIO, asi que tiene que funcionar de verdad acá: elegir
  // "Telegram" sin activarlo dejaria al agente sin donde escribir. Traemos la
  // conexion para tener el link del bot y su estado real.
  const [tg, setTg] = useState<Connection | null>(null);
  const [codigo, setCodigo] = useState("");
  const [activando, setActivando] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [pareado, setPareado] = useState(false);

  useEffect(() => {
    if (paso !== "presentacion") return;
    getConnections(cfg)
      .then((r) => {
        const t = (r.conexiones ?? []).find((c) => c.id === "telegram") ?? null;
        setTg(t);
        if (t?.estado === "conectado") setPareado(true);
      })
      .catch(() => { /* sin catalogo seguimos: el mail alcanza para pasar */ });
  }, [paso, cfg]);

  const activarTelegram = async () => {
    if (!codigo.trim()) return;
    setActivando(true);
    setPairErr(null);
    try {
      const r = await fetch(`${cfg.adapter}/portal/connections/telegram/pairing`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: codigo }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d?.error || `Error ${r.status}`);
      setPareado(true);
    } catch (e) {
      setPairErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActivando(false);
    }
  };

  // Investigar una web son DOS cosas y el personaje las tiene las dos: primero
  // la lupa barriendo (buscar el sitio, recorrerlo) y después el libro (leer lo
  // que encontró). Un solo gesto clavado un minuto se lee como una animación en
  // loop; alternándolos parece alguien trabajando. Arranca por `buscando`
  // porque es el orden real. El state machine cruza los gestos en 220 ms, así
  // que el cambio no salta.
  const leyendoWeb = paso === "presentacion" && Boolean(url.trim());
  const [gesto, setGesto] = useState<"buscando" | "leyendo">("buscando");
  useEffect(() => {
    if (!leyendoWeb) return;
    setGesto("buscando");
    const t = setInterval(
      () => setGesto((g) => (g === "buscando" ? "leyendo" : "buscando")), 5200);
    return () => clearInterval(t);
  }, [leyendoWeb]);

  const mailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.trim());
  // La puerta: o Telegram activado, o un mail donde escribirte. Sin canal el
  // portal espera que el cliente entre solo, y no entra.
  const puedeEntrar =
    (canal === "telegram" && pareado) || (canal === "correo" && mailOk);
  // Contador de festejos: cada bautismo dispara el trigger del personaje.
  const [festejos, setFestejos] = useState(0);
  const [look, setLook] = useState<AgentitoLook>(
    () => (hayLookGuardado()
      ? loadAgentLook()
      : lookDesdeAgente(manifest.look) ?? LOOK_DEFAULT));
  // Solo escribimos en el agente si el cliente eligió algo ACÁ; si no, entrar
  // desde otra máquina le pisaría la pinta con el default.
  const eligioAlgo = useRef(false);
  const listo = nombre.trim().length > 0;

  const otroLook = () => {
    const nuevo = sortearLook(look);
    saveAgentLook(nuevo);
    setLook(nuevo);
    eligioAlgo.current = true;
  };

  const bautizar = () => {
    if (!listo) return;
    const n = nombre.trim();
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* modo privado: al menos vale para esta sesión */
    }
    setNombre(n);
    setFestejos((f) => f + 1);
    setPaso("negocio");
    eligioAlgo.current = true;
    // El bautizo se guarda ACA, cuando pasa, y no al final del onboarding.
    // Cuando el ultimo paso se volvio obligatorio (elegir canal), el nombre se
    // quedaba en el browser hasta el final: el agente pasaba por todo el
    // pairing de Telegram sin saber como se llamaba, su bot seguia con el
    // nombre viejo, y si el cliente abandonaba ahi el bautizo se perdia.
    guardarIdentidad(cfg, { nombre: n, look, ...capturaDelAgentito() })
      .catch(() => { /* adapter viejo o caido: queda la copia del browser */ });
  };

  /** Paso 2 → presentación. La web se manda ACÁ y no al final: mientras el
   *  cliente lee la presentación, el agente ya está leyendo su sitio. */
  const contarme = () => {
    const e = empresa.trim();
    if (!e) return;
    guardarIdentidad(cfg, {
      empresa: e,
      ...(url.trim() ? { url: url.trim() } : {}),
    }).catch(() => { /* adapter viejo o caído: el portal sigue */ });
    setPaso("presentacion");
  };

  /** El bautizo viaja al agente; si el adapter es viejo o está caído, el
   *  portal sigue andando con la copia del browser. */
  const terminar = () => {
    const n = nombre.trim();
    if (eligioAlgo.current) {
      const contacto = canal === "telegram"
        ? { canal: "telegram" as const, valor: "portal" }
        : canal === "correo" && mail.trim()
          ? { canal: "correo" as const, valor: mail.trim() }
          : undefined;
      guardarIdentidad(cfg, {
        nombre: n, look, ...(contacto ? { contacto } : {}),
      }).catch(() => {
        /* adapter viejo (404) o caído: queda en el browser */
      });
    }
    onDone(n);
  };

  // La pestaña Aprobaciones es condicional (existe cuando hay algo esperando),
  // pero acá se presenta la CAPACIDAD, no la pestaña: si hay tablero, hay
  // compuerta de aprobación — y es la promesa que más confianza construye.
  const puntos = PUNTOS.filter((p) =>
    p.key === "approvals" ? manifest.modules.kanban : manifest.modules[p.key]);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        {/* Lo primero que un cliente ve de tuagente: el título es la tesis del
            producto, y convierte el bautismo en lo que es — darle nombre a
            alguien que se suma al equipo. */}
        {paso === "negocio" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Ahora contame de vos
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Para trabajar necesito saber para quién. Con esto me alcanza para
              arrancar; el resto lo vamos corrigiendo sobre la marcha.
            </p>
          </div>
        )}
        {paso === "bautismo" && (
          <div className="mb-10 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Tu empresa tiene un empleado nuevo
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Va a trabajar para vos todos los días, y todo lo que haga queda a la
              vista en este portal. Empecemos por lo más importante: ponerle nombre.
            </p>
          </div>
        )}
        <div className={`relative transition-all duration-500 ${paso === "bautismo" ? "h-40 w-40" : "h-28 w-28"}`}>
          {/* Si le pasó la web, el agentito no está quieto: la está leyendo de
              verdad — el adapter ya creó el ticket del brief. El gesto no es
              decorativo, muestra lo que está pasando. */}
          <AgentitoRive
            festejos={festejos}
            look={look}
            estado={leyendoWeb ? gesto : "tranquilo"}
            className="h-full w-full"
          />
          {/* El dado vive pegado al personaje: cambia SU pinta, no la página. */}
          {paso === "bautismo" && (
            <button
              onClick={otroLook}
              title="Otro look"
              aria-label="Otro look"
              className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white shadow-soft transition hover:scale-105 hover:bg-black/[0.03] active:scale-95"
            >
              <Dices className="h-[18px] w-[18px] text-ink" />
            </button>
          )}
        </div>

        {/* "¡Hola! Soy ____" en la voz del agente es ambiguo a secas: un campo
            de nombre debajo de una cara no tiene sujeto, y completarlo se
            siente como presentarse uno mismo. Se resuelve con dos cosas y no
            con la redaccion:
            1. El PLACEHOLDER trae un nombre puesto. Con un nombre adentro, el
               campo se lee como "acá va un nombre para él" sin explicar nada.
               Sale al azar de una lista: que justo caiga el nombre del cliente
               es lo bastante improbable como para no preocuparnos.
            2. Antes de esta pantalla va a haber un login donde el cliente ya
               puso SU nombre — cuando llega acá, la pregunta de quién es quién
               ya está contestada. (Pendiente: ese login todavía no existe.) */}
        <h2 className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
          {paso === "negocio" ? (
            <span className="text-primary">{nombre}</span>
          ) : (
            <>
              ¡Hola! Soy{" "}
              {paso === "bautismo" ? (
                <input
                  autoFocus
                  value={nombre}
                  maxLength={24}
                  onChange={(e) => setNombre(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && bautizar()}
                  placeholder={sugerido}
                  aria-label="Nombre para tu agente"
                  className="inline-block w-[6.5em] max-w-[70vw] border-b-[3px] border-black/15 bg-transparent text-center text-[32px] font-extrabold tracking-tight text-primary outline-none transition placeholder:font-extrabold placeholder:text-ink-soft/35 focus:border-primary sm:text-[38px]"
                />
              ) : (
                <span className="text-primary">{nombre}</span>
              )}
            </>
          )}
        </h2>

        {paso === "bautismo" ? (
          <div className="mt-8">
            <Btn disabled={!listo} onClick={bautizar}>
              Continuar <ArrowRight className="h-4 w-4" />
            </Btn>
          </div>
        ) : paso === "negocio" ? (
          <div className="mt-6 w-full max-w-md animate-fadeup text-left">
            <label className="block text-[13px] font-semibold text-ink" htmlFor="ob-empresa">
              ¿Cómo se llama tu negocio?
            </label>
            <input
              id="ob-empresa"
              autoFocus
              value={empresa}
              maxLength={60}
              onChange={(e) => setEmpresa(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && empresa.trim() && contarme()}
              placeholder="Farmacia Artigas"
              className={`${inputCls} mt-1.5`}
            />
            <p className="mt-1.5 text-[12px] text-ink-soft">
              Es como te voy a nombrar acá adentro y cuando escriba algo a nombre tuyo.
            </p>

            <label className="mt-5 block text-[13px] font-semibold text-ink" htmlFor="ob-url">
              ¿Tenés página web? <span className="font-normal text-ink-soft">(opcional)</span>
            </label>
            <input
              id="ob-url"
              value={url}
              maxLength={200}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && empresa.trim() && contarme()}
              placeholder="farmaciaartigas.com.uy"
              className={`${inputCls} mt-1.5`}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
              Si me la pasás, la leo mientras entrás y te dejo un resumen de lo que
              entendí de tu negocio. Es un borrador: lo vas a poder corregir.
            </p>

            <div className="mt-7 flex items-center gap-3">
              <Btn disabled={!empresa.trim()} onClick={contarme}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
            </div>
          </div>
        ) : (
          <div className="animate-fadeup">
            <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-soft">
              {/* Sin género: el cliente le pone el nombre que quiere y
                  "Encantado" con un nombre femenino se lee mal. Y sacamos "con
                  tus sistemas": todavía no le conectó ninguno, así que sonaba
                  a que alguien le dio sus cosas sin avisarle. */}
              Un gusto. Trabajo para tu empresa: me pedís cosas en tus palabras, las
              resuelvo y todo lo que hago queda a la vista acá.
            </p>

            {puntos.length > 0 && (
              <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
                {puntos.map((p) => {
                  const Icon = p.icon;
                  return (
                    <div key={p.key} className="rounded-card border border-black/[0.07] bg-white p-4">
                      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${p.tono}`}>
                        <Icon className="h-4 w-4 text-ink" />
                      </div>
                      <p className="text-sm font-bold text-ink">{p.titulo}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{p.texto}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Va acá y no en un formulario: es la ultima pregunta que hace
                EL AGENTE, y se lee como tal. Es ademas lo que decide si el
                portal sirve — un cliente de prueba lo dijo sin vueltas: "la
                hoja espera que yo venga y yo no voy a venir". */}
            <div className="mx-auto mt-8 w-full max-w-md rounded-card border border-black/[0.07] bg-white p-5 text-left">
              <p className="text-[15px] font-bold text-ink">
                ¿Por dónde te aviso cuando pase algo?
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Cuando algo necesite tu ok, o cuando anote algo tuyo y quiera confirmarlo.
                Te escribo yo, no te llegan mails del sistema.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ["telegram", "Por Telegram"],
                  ["correo", "No uso Telegram"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => { setCanal(k); setPairErr(null); }}
                    className={`rounded-lg border px-3 py-2 text-[13px] font-semibold transition ${
                      canal === k
                        ? "border-primary bg-c-violet/60 text-primary"
                        : "border-black/10 text-ink-soft hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Telegram se activa ACA. Elegirlo sin activarlo seria elegir un
                  buzon que no existe: son dos toques y se hace ahora o no se
                  hace nunca. */}
              {canal === "telegram" && (
                pareado ? (
                  <p className="mt-3 text-[13px] font-semibold text-c-green-ink">
                    Listo, ya nos hablamos por ahí.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {tg?.link && (
                      <a
                        href={tg.link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
                      >
                        Abrir el chat conmigo
                      </a>
                    )}
                    <p className="text-[12px] leading-snug text-ink-soft">
                      Mandame un hola. Te contesto con un código: pegalo acá.
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={codigo}
                        onChange={(e) => { setCodigo(e.target.value); setPairErr(null); }}
                        onKeyDown={(e) => e.key === "Enter" && activarTelegram()}
                        placeholder="Código"
                        maxLength={16}
                        aria-label="Código de Telegram"
                        className={`${inputCls} w-36 font-mono uppercase`}
                      />
                      <Btn size="sm" disabled={!codigo.trim() || activando} onClick={activarTelegram}>
                        {activando ? "Activando…" : "Activar"}
                      </Btn>
                    </div>
                    {pairErr && <p className="text-[12px] text-c-coral-ink">{pairErr}</p>}
                  </div>
                )
              )}

              {canal === "correo" && (
                <div className="mt-3">
                  <input
                    autoFocus
                    value={mail}
                    onChange={(e) => setMail(e.target.value)}
                    placeholder="tu@empresa.com"
                    aria-label="Tu mail"
                    className={inputCls}
                  />
                  {/* Honestidad: por mail NO te escribo todavia. El correo lo
                      conectamos nosotros (necesita las claves de la casilla),
                      asi que esto queda como pedido, no como promesa. */}
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                    Para escribirte por mail necesitamos conectar la casilla de la empresa,
                    y eso lo hacemos nosotros. Dejanos tu dirección y te contactamos para
                    dejarlo andando.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              <Btn disabled={!puedeEntrar} onClick={terminar}>Entrar al portal</Btn>
              <span className="text-[12px] text-ink-soft">
                {!puedeEntrar
                  ? "Elegí por dónde te aviso para entrar."
                  : url.trim()
                    ? "Mientras tanto sigo leyendo tu web. Lo que saque queda en Entregas."
                    : "Cada sección se explica sola la primera vez que entrás."}
              </span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
