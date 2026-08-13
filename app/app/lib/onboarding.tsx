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

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, BellOff, Columns3, Dices, Hand, MessageSquare, X } from "lucide-react";
import { Btn, inputCls } from "./ui";
import { CarruselEjemplos } from "./ejemplosFlujos";
import ChatOnboarding from "./ChatOnboarding";
import { urlApuntaADetalle } from "./rutas";
import {
  crearPedidoDeConexion, getConnections, guardarIdentidad,
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
  "Tota", "Rulo", "Pepa", "Milo", "Nina", "Beto", "Cuca", "Tito", "Lola",
  "Kiko", "Mora", "Nino", "Pocha", "Chispa", "Lino", "Juana", "Bruno", "Tuca", "Rosita", "Nilo",
];

/** La cara que eligió, capturada del canvas de Rive: termina siendo la foto
 *  del bot de Telegram (la sube un tool nuestro por MTProto). Si el canvas no
 *  coopera, el bautizo sigue igual, sin foto. */
function capturaDelAgentito(): { avatar_png?: string } {
  try {
    const canvas = document.querySelector("canvas");
    if (!canvas || !canvas.width) return {};

    // NO se sube el canvas tal cual. Rive dibuja con FONDO TRANSPARENTE, y
    // Telegram no soporta alfa en las fotos de perfil: la aplasta contra
    // NEGRO. La carita naranja del cliente terminaba recortada sobre un
    // cuadrado negro, con los bordes dentados. (Visto el 11/8 con Washington.)
    //
    // Así que se compone sobre el fondo del portal, cuadrado y en 512: es el
    // tamaño que Telegram usa para el avatar grande, y salir con menos lo deja
    // escalar a él —que es de donde venían los dientes—.
    const LADO = 512;
    const fuera = document.createElement("canvas");
    fuera.width = LADO;
    fuera.height = LADO;
    const ctx = fuera.getContext("2d");
    if (!ctx) return {};

    ctx.fillStyle = "#FBFAFF";           // bg-surface: la misma que ve en el portal
    ctx.fillRect(0, 0, LADO, LADO);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Cuadrado, centrado y sin deformar: el canvas del onboarding no siempre
    // es cuadrado y estirar la cara se nota más que cualquier otra cosa.
    const escala = Math.min(LADO / canvas.width, LADO / canvas.height);
    const w = canvas.width * escala;
    const h = canvas.height * escala;
    ctx.drawImage(canvas, (LADO - w) / 2, (LADO - h) / 2, w, h);

    const data = fuera.toDataURL("image/png");
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

/** La copia local del nombre. Un solo escritor: el bautizo y el layout cuando
 *  se lo aprende del manifiesto. */
export function saveAgentName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* modo privado: al menos vale para esta sesión */
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
  // El canal de aviso es un paso PROPIO y no el pie de la presentación. Es la
  // decisión que decide si el portal sirve —"la hoja espera que yo venga y yo
  // no voy a venir"— y apretada abajo de tres tarjetas competía con ellas.
  const [paso, setPaso] = useState<"bautismo" | "negocio" | "presentacion" | "aviso" | "automatizaciones" | "charla">(
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
  // Las opciones son CANALES CON NOMBRE, y "ahora no" es una de ellas. Antes
  // eran dos botones, "Por Telegram" y "No uso Telegram", y el segundo no era
  // una respuesta sino otra obligación: te pedía el mail igual. Las dos
  // clientas de prueba dijeron lo mismo con distintas palabras — "me sentí
  // vieja por no usar Telegram" y "nadie en mi barrio usa Telegram" — y las
  // dos terminaron dando un dato para que la pantalla las dejara pasar.
  const [canal, setCanal] = useState<"telegram" | "whatsapp" | "correo" | "ninguno" | "">("");
  const [mail, setMail] = useState("");
  const [tel, setTel] = useState("");
  // Elegir "Telegram" sin activarlo dejaria al agente sin donde escribir, asi
  // que se activa acá mismo. Y el catálogo entero, no solo Telegram: es de
  // donde sale qué puede hacer ESTE agente (si tiene bot, si su correo ya está
  // enchufado) y con qué nombre se llama cada conexión.
  const [conexiones, setConexiones] = useState<Connection[] | null>(null);
  const [codigo, setCodigo] = useState("");
  const [activando, setActivando] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [pareado, setPareado] = useState(false);
  // Lo que el cliente eligio del carrusel: arranca la charla sin salir de acá.
  const [pedido, setPedido] = useState("");
  // A DÓNDE VOLVER AL TERMINAR. El onboarding se pone adelante de CUALQUIER
  // ruta, y al cerrarse mandaba siempre a /app/inicio: el que llegaba con el
  // link de un entregable —el que el login le prometió que iba a respetar—
  // terminaba en la portada y tenía que salir a buscar lo que le habían
  // mandado. Se captura una sola vez al montar, antes de que cualquier cosa
  // toque la URL. (La credencial ya se limpió del hash en el layout; acá solo
  // viajan path y parámetros.)
  const [destinoDelLink] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return urlApuntaADetalle()
      ? window.location.pathname + window.location.search
      : null;
  });
  // Mientras se saca la foto, el personaje se queda QUIETO. La captura toma el
  // frame que hay en pantalla, y en `tranquilo` el agentito se ceba un mate a
  // los ~20 s y despues cada rato — o sea que casi siempre lo agarraba con el
  // mate en la mano y la bombilla a mitad de camino. Nadie bautiza a su agente
  // en menos de veinte segundos. (Visto el 11/8 en la foto de Mr.Wobble.)
  const [posando, setPosando] = useState(false);

  useEffect(() => {
    if (paso !== "presentacion" && paso !== "aviso") return;
    getConnections(cfg)
      .then((r) => {
        setConexiones(r.conexiones ?? []);
        if ((r.conexiones ?? []).some((c) => c.id === "telegram" && c.estado === "conectado")) {
          setPareado(true);
        }
      })
      .catch(() => { /* sin catalogo seguimos: se ofrece lo que se pueda probar */ });
  }, [paso, cfg]);

  const conexionDe = (id: string) => conexiones?.find((c) => c.id === id) ?? null;
  const tg = conexionDe("telegram");

  // Dos fuentes para el mismo dato, porque el paso NO se puede completar sin
  // él: el manifiesto (adapter 0.35+, siempre presente) y la conexión (que
  // puede no haber llegado si falló la llamada al catálogo).
  const handleBot = manifest.telegram_bot
    || tg?.link?.replace(/^https:\/\/t\.me\//, "")
    || null;
  const enlaceBot = handleBot ? `https://t.me/${handleBot}` : null;
  // ¿ESTE agente tiene Telegram? PRINCIPIO CERO: el portal sirve a cualquier
  // agente y el bot se lo instalamos nosotros, uno por cliente. Sin
  // `TELEGRAM_BOT_TOKEN` no hay bot, la conexión queda `sin_conectar` y el
  // manifiesto trae `telegram_bot: null` — o sea que no hay a quién escribirle
  // y el paso del código es imposible de terminar. (Medido el 13/8 en los tres
  // agentes del lab: los tres sin bot.) Si el catálogo no llegó, se asume que
  // no hay: el error de prometer de más lo paga el cliente esperando un mensaje
  // que no va a llegar nunca.
  const hayTelegram = Boolean(manifest.telegram_bot)
    || tg?.estado === "lista" || tg?.estado === "conectado";
  // El mail solo sirve como canal si la casilla de la empresa YA está
  // enchufada: si no, el agente no tiene desde dónde escribir.
  const correoConectado = conexionDe("correo")?.estado === "conectado";

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
      // El canal se anota EN EL MOMENTO en que empieza a existir, no al final
      // del onboarding: si el cliente cierra acá, ya tiene Telegram andando y
      // el portal no puede seguir recordándole que le falta un canal.
      guardarIdentidad(cfg, { contacto: { canal: "telegram", valor: "portal" } })
        .catch(() => { /* adapter viejo o caído: se reintenta al continuar */ });
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
  const leyendoWeb = (paso === "presentacion" || paso === "aviso") && Boolean(url.trim());
  const [gesto, setGesto] = useState<"buscando" | "leyendo">("buscando");
  useEffect(() => {
    if (!leyendoWeb) return;
    setGesto("buscando");
    const t = setInterval(
      () => setGesto((g) => (g === "buscando" ? "leyendo" : "buscando")), 5200);
    return () => clearInterval(t);
  }, [leyendoWeb]);

  const mailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail.trim());
  // Un teléfono uruguayo son ocho o nueve dígitos; con o sin 598, con o sin
  // espacios. No se valida más que eso: lo que llega es para que lo llamemos
  // nosotros, y rebotarle el formato a alguien que escribió bien su número es
  // el peaje de nuevo, más chico.
  const telOk = (tel.match(/\d/g)?.length ?? 0) >= 8;
  // YA NO HAY PUERTA. Antes era "o Telegram activado, o un mail": sin eso el
  // botón quedaba apagado y no se entraba al portal. La decisión de producto
  // (13/8) es que el canal se pueda dejar para después — el precio de forzarlo
  // era que la clienta diera un dato cualquiera para pasar, que no es un canal
  // sino un trámite trucho. Lo único que se pide es CONTESTAR la pregunta:
  // "Ahora no" es una respuesta y está al lado de las otras.
  const contestoAlgo = canal !== "";
  // UN SOLO CRITERIO: ¿el agente puede escribirle HOY por acá? Es la única
  // pregunta, y se contesta igual para las cuatro respuestas.
  //
  // Telegram cuenta solo si quedó pareado (si no, el agente escribiría a un
  // chat que no existe). El correo cuenta solo si la casilla de la empresa ya
  // está conectada — que es lo que esta misma pantalla le dice al cliente dos
  // renglones más abajo. WhatsApp no cuenta nunca todavía. Todo lo demás es
  // "no hay canal", y eso se GUARDA (ver `seguirDesdeAviso`): un canal que no
  // existe y un cliente que nunca contestó no pueden ser el mismo dato.
  const canalReal = canal === "telegram" && pareado ? "telegram"
    : canal === "correo" && mailOk && correoConectado ? "correo"
      : null;
  // Lo que se tramita a mano: acá no hay nada que el cliente pueda enchufar
  // solo, así que queda un pedido nuestro con su dato al lado. Telegram entra
  // en esta lista cuando el agente no tiene bot: el atajo no existe, y en vez
  // de mandarlo a una pantalla donde tampoco va a poder, se lo pedimos.
  const pedidoDeConexion = canal === "whatsapp" && telOk ? "whatsapp"
    : canal === "correo" && mailOk && !correoConectado ? "correo"
      : canal === "telegram" && !hayTelegram ? "telegram"
        : null;
  // Contador de festejos: cada bautismo dispara el trigger del personaje.
  const [festejos, setFestejos] = useState(0);
  const [look, setLook] = useState<AgentitoLook>(
    () => (hayLookGuardado()
      ? loadAgentLook()
      : lookDesdeAgente(manifest.look) ?? LOOK_DEFAULT));
  const listo = nombre.trim().length > 0;

  const otroLook = () => {
    const nuevo = sortearLook(look);
    saveAgentLook(nuevo);
    setLook(nuevo);
  };

  const bautizar = async () => {
    if (!listo) return;
    const n = nombre.trim();
    // Pose primero, foto despues. Los 450 ms son para que Rive termine la
    // transicion: sacarla en el mismo tick devuelve el frame viejo.
    setPosando(true);
    await new Promise((r) => setTimeout(r, 450));
    saveAgentName(n);
    setNombre(n);
    setFestejos((f) => f + 1);
    setPaso("negocio");
    // El bautizo se guarda ACA, cuando pasa, y no al final del onboarding.
    // Cuando el ultimo paso se volvio obligatorio (elegir canal), el nombre se
    // quedaba en el browser hasta el final: el agente pasaba por todo el
    // pairing de Telegram sin saber como se llamaba, su bot seguia con el
    // nombre viejo, y si el cliente abandonaba ahi el bautizo se perdia.
    const foto = capturaDelAgentito();
    setPosando(false);
    guardarIdentidad(cfg, { nombre: n, look, ...foto })
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

  /** El mismo pedido que deja la pestaña Conexiones —mismo helper, mismo
   *  ticket bloqueado de entrada— con el dato que el cliente acaba de dar.
   *
   *  EL TÍTULO SALE DEL CATÁLOGO, igual que allá (`Conectar ${label}`), y no de
   *  una constante escrita acá. Es lo único con lo que Conexiones reconoce que
   *  ya lo pediste: comparaba su label contra el título del ticket, y como el
   *  alta escribía "Conectar el correo de la empresa" y el catálogo dice
   *  "Correo de la empresa", no matcheaba — la clienta que lo pedía en el alta
   *  entraba a Conexiones, veía "Sin conectar" y lo volvía a pedir. */
  const pedirConexion = (id: "whatsapp" | "correo" | "telegram") => {
    const label = conexionDe(id)?.label
      ?? (id === "whatsapp" ? "WhatsApp" : id === "correo" ? "Correo de la empresa" : "Telegram");
    const detalle = id === "whatsapp"
      ? `Número: ${tel.trim()}\n\n` +
        `Vía oficial (Cloud API): pide verificación de la empresa ante Meta y ` +
        `la tramitamos nosotros.`
      : id === "correo"
        ? `Casilla: ${mail.trim()}\n\n` +
          `Hay que conectar la casilla de la empresa (IMAP/SMTP) para que el ` +
          `agente pueda escribir desde ahí.`
        : `Todavía no tiene un bot de Telegram propio: hay que crearlo y pasarle ` +
          `el link para que le mande el primer mensaje.`;
    crearPedidoDeConexion(cfg, {
      title: `Conectar ${label}`,
      cuerpo:
        `Lo pidió en el alta del portal, cuando eligió por dónde quiere que le avise.\n` +
        detalle +
        `\n\nNo hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
        `que hay que conectarlo y dejá el ticket esperando.`,
    }).catch(() => { /* si no se pudo anotar, el alta no se traba por eso */ });
  };

  /** El paso del aviso, resuelto donde se decide y no al final del onboarding.
   *
   *  Es la misma lección que el bautizo: guardarlo recién en la última pantalla
   *  significaba perderlo si el cliente cerraba antes — y encima solo se
   *  guardaba si había pasado por el bautismo, así que el que entraba desde
   *  otra máquina a un agente YA bautizado elegía canal y no se guardaba nunca.
   *
   *  Lo que NO se manda: `whatsapp` como canal de aviso. El adapter solo acepta
   *  telegram/correo/ninguno (`CANALES_AVISO`), y mandarle otra cosa hace
   *  fallar la llamada entera. Mientras el kit no lo agregue, WhatsApp vive
   *  como pedido —un ticket, igual que en Conexiones— y no como canal.
   *
   *  Y SIEMPRE SE GUARDA ALGO. Antes solo se anotaba el "ninguno" de dos de las
   *  cuatro respuestas: elegir WhatsApp, o correo con un mail inválido, no
   *  escribía nada, así que el manifiesto quedaba en `aviso: null` —
   *  indistinguible de un cliente que nunca llegó a contestar— y la franja que
   *  le recuerda que le falta un canal no le aparecía nunca. Justo a la que
   *  eligió WhatsApp, que es la que más tiempo va a estar sin canal. */
  const seguirDesdeAviso = () => {
    const contacto = canalReal === "telegram"
      ? { canal: "telegram" as const, valor: "portal" }
      : canalReal === "correo"
        ? { canal: "correo" as const, valor: mail.trim() }
        // No quedó ningún canal que funcione, sin importar cuál eligió: se
        // guarda EXPLÍCITO. Es el dato que le permite al portal volver a
        // ofrecerlo adentro y al agente saber que no tiene dónde escribir.
        : { canal: "ninguno" as const };
    if (contestoAlgo) {
      guardarIdentidad(cfg, { contacto })
        .catch(() => { /* adapter viejo o caído: el portal sigue */ });
    }
    // Qué quedó en trámite, para que la franja de adentro no le hable como si
    // no hubiera dicho nada. Es solo el TEXTO: quién muestra la franja lo
    // decide el manifiesto, que es de donde sale la verdad.
    recordarTramite(pedidoDeConexion);
    if (pedidoDeConexion) pedirConexion(pedidoDeConexion);
    setPaso("automatizaciones");
  };

  /** Cierra el onboarding y deja al cliente donde iba.
   *
   *  Sin destino explícito manda a donde APUNTABA EL LINK con el que entró, y
   *  recién si no venía a nada concreto, al inicio. */
  const terminar = (destino?: string) => {
    const n = nombre.trim();
    onDone(n);
    // Navegación DURA a propósito. Con router.push, al cerrar el onboarding se
    // montaba la página de /app —que hace replace("/app/inicio") en un efecto—
    // y se comía el destino: "Armar el primero" terminaba en Inicio. Esto pasa
    // una vez en la vida del cliente; un reload de más es barato al lado de un
    // llamado a la acción que no lleva a ningún lado.
    window.location.assign(destino ?? destinoDelLink ?? "/app/inicio");
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
        {paso === "presentacion" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Así vamos a trabajar
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Me pedís cosas en tus palabras, las resuelvo, y todo lo que hago
              queda a la vista acá.
            </p>
          </div>
        )}
        {paso === "charla" && (
          <div className="mb-6 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Ya estamos
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
              Contestale lo que te pregunte y lo armamos entre los dos. Cuando
              quieras, entrá al portal: la charla sigue ahí.
            </p>
          </div>
        )}
        {paso === "automatizaciones" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              ¿Qué te saco de encima?
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-ink-soft">
              Lo mejor que puedo hacer por vos es ocuparme de lo que se repite,
              sin que tengas que acordarte. Tocá algo parecido a lo que
              necesitás y lo armamos ahora.
            </p>
          </div>
        )}
        {paso === "aviso" && (
          <div className="mb-8 animate-fadeup">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              ¿Por dónde te aviso?
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Cuando termine algo tuyo o necesite tu ok, te escribo por donde
              vos digas. Si preferís verlo más adelante, también está bien.
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
        <div
          className={`relative transition-all duration-500 ${
            paso === "bautismo" ? "h-40 w-40" : paso === "charla" ? "h-16 w-16" : "h-28 w-28"
          }`}
        >
          {/* Si le pasó la web, el agentito no está quieto: la está leyendo de
              verdad — el adapter ya creó el ticket del brief. El gesto no es
              decorativo, muestra lo que está pasando. */}
          <AgentitoRive
            festejos={festejos}
            look={look}
            estado={posando ? "normal" : leyendoWeb ? gesto : "tranquilo"}
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
        {/* "¡Hola! Soy X" SOLO en el bautizo. Repetirlo después es presentarse
            de nuevo con alguien que ya te puso el nombre dos pantallas atrás:
            se lee como si no se acordara. En el resto va el nombre solo, y lo
            que dice qué está pasando es el h1 de arriba. */}
        <h2 className={`mt-6 font-extrabold leading-tight tracking-tight text-ink ${paso === "charla" ? "sr-only" : "text-[32px] sm:text-[38px]"}`}>
          {paso !== "bautismo" ? (
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
        ) : paso === "presentacion" ? (
          <div className="animate-fadeup">
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

            <div className="mt-8">
              <Btn onClick={() => setPaso("aviso")}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
            </div>
          </div>
        ) : paso === "aviso" ? (
          <div className="animate-fadeup">
            {/* Es la ultima pregunta que hace EL AGENTE, y se lee como tal.
                Tiene pantalla propia porque es lo que decide si el portal
                sirve — un cliente de prueba lo dijo sin vueltas: "la hoja
                espera que yo venga y yo no voy a venir". */}
            <div className="mx-auto mt-2 w-full max-w-md rounded-card border border-black/[0.07] bg-white p-5 text-left">
              <p className="text-[15px] font-bold text-ink">
                ¿Por dónde te aviso cuando pase algo?
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                Cuando algo necesite tu ok, o cuando anote algo tuyo y quiera confirmarlo.
                Te escribo yo, no te llegan mails del sistema.
              </p>
              {/* CUATRO RESPUESTAS, TODAS CON NOMBRE. La cuarta es "ahora no" y
                  está al lado de las otras a propósito: es una respuesta, no
                  una escapatoria escondida abajo. WhatsApp figura porque es lo
                  que la mitad del país usa — y figura diciendo la verdad sobre
                  lo que lleva, en vez de faltar y dejar a la clienta pensando
                  que el producto no la entiende. */}
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ["telegram", "Telegram"],
                  ["whatsapp", "WhatsApp"],
                  ["correo", "Correo"],
                  ["ninguno", "Ahora no"],
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

              {/* Telegram se activa ACA, pero SOLO si este agente tiene bot.
                  Sin bot no hay a quién escribirle: la caja del código quedaba
                  ahí pidiendo algo que nunca iba a llegar. */}
              {canal === "telegram" && !hayTelegram && (
                <div className="mt-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    Todavía no tengo un Telegram propio: el bot te lo creamos
                    nosotros y no lo puedo prender yo desde acá. Es rápido —
                    cuando esté, te pasamos el link para que le mandes un hola y
                    listo.
                  </p>
                </div>
              )}
              {canal === "telegram" && hayTelegram && (
                pareado ? (
                  <p className="mt-3 text-[13px] font-semibold text-c-green-ink">
                    Listo, ya nos hablamos por ahí.
                  </p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {enlaceBot && (
                      <a
                        href={enlaceBot}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
                      >
                        Abrir el chat conmigo
                      </a>
                    )}
                    {/* El handle va TAMBIÉN escrito, no solo en el botón: si la
                        llamada a conexiones falla, el paso vuelve a ser
                        imposible. Y así se puede buscar a mano desde el
                        teléfono, que es donde la gente tiene Telegram. */}
                    <p className="text-[12px] leading-snug text-ink-soft">
                      {handleBot
                        ? <>Buscame en Telegram como <span className="font-semibold text-ink">@{handleBot}</span> y mandame un hola. Te contesto con un código: pegalo acá.</>
                        : <>Mandame un hola por Telegram. Te contesto con un código: pegalo acá.</>}
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

              {/* WHATSAPP DICE LO QUE CUESTA Y NO SE OFRECE COMO SI FUERA UN
                  BOTÓN. Lo que el kit tiene hoy son dos caminos: el oficial
                  (Cloud API), que pide que Meta verifique a la empresa y lleva
                  días, y un puente por QR que solo existe si se lo instalamos
                  al agente y que puede hacer que le bloqueen el número. Ni uno
                  ni otro es "apretar Conectar": ofrecerlo así fue lo que le
                  devolvió un error de Python en la cara a una veterinaria. */}
              {canal === "whatsapp" && (
                <div className="mt-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    Por WhatsApp todavía no te puedo escribir solo. La vía que sirve
                    para un número de empresa pide que Meta verifique el negocio, y
                    ese trámite lo hacemos nosotros: suele llevar unos días. Dejanos
                    el número y lo arrancamos hoy.
                  </p>
                  <input
                    autoFocus
                    value={tel}
                    onChange={(e) => setTel(e.target.value)}
                    placeholder="099 123 456"
                    inputMode="tel"
                    maxLength={30}
                    aria-label="Tu número de WhatsApp"
                    className={`${inputCls} mt-2`}
                  />
                  {/* El atajo se ofrece SOLO si existe en este agente. Ofrecer
                      "Telegram en dos toques" a un agente sin bot es mandarla a
                      una pantalla donde tampoco va a poder. */}
                  {hayTelegram && (
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                      Mientras tanto, si querés que te avise desde hoy, Telegram se
                      activa acá en dos toques.
                    </p>
                  )}
                </div>
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
                  {/* Honestidad: por mail NO te escribo todavia, SALVO que la
                      casilla de la empresa ya esté conectada. El correo lo
                      conectamos nosotros (necesita las claves de la casilla),
                      asi que sin eso es un pedido y no una promesa. */}
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                    {correoConectado
                      ? "La casilla de tu empresa ya está conectada: te escribo desde ahí."
                      : "Para escribirte por mail necesitamos conectar la casilla de la empresa, "
                        + "y eso lo hacemos nosotros. Dejanos tu dirección y te contactamos para "
                        + "dejarlo andando."}
                  </p>
                </div>
              )}

              {/* Lo que se pierde, dicho una vez y sin dramatizar: no cambia lo
                  que el agente hace, cambia quién avisa a quién. */}
              {canal === "ninguno" && (
                <div className="mt-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-soft">
                    Entonces no te escribo a ningún lado: lo que haga te va a estar
                    esperando acá y lo ves cuando entres. Trabaja igual — lo que
                    cambia es que te enterás cuando venís, en vez de que te avise yo.
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                    {hayTelegram
                      ? "Cuando quieras prenderlo, está en Conexiones y son dos minutos."
                      : "Cuando quieras, entrá a Conexiones y pedilo desde ahí: lo dejamos andando nosotros y te avisamos."}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2">
              <Btn disabled={!contestoAlgo} onClick={seguirDesdeAviso}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
              {/* Qué va a pasar al tocar Continuar, dicho antes de tocarlo. Es
                  el renglón que evita la sorpresa de la clienta que eligió algo,
                  siguió, y recién adentro se enteró de que no le llegaba nada. */}
              <span className="max-w-sm text-[12px] leading-relaxed text-ink-soft">
                {canal === ""
                  ? "Elegí una, o tocá «Ahora no» si preferís verlo más adelante."
                  : canalReal === "telegram"
                    ? "Listo: te escribo por Telegram."
                    : canalReal === "correo"
                      ? "Listo: te escribo a esa dirección."
                      : canal === "telegram"
                        ? hayTelegram
                          ? "Todavía no lo activaste: entrás sin avisos y lo terminás cuando quieras desde Conexiones."
                          : "Queda pedido: te lo dejamos andando y te avisamos. Mientras tanto entrás sin avisos."
                        : canal === "whatsapp"
                          ? telOk
                            ? "Queda pedido: te escribimos para conectarlo. Mientras tanto entrás sin avisos."
                            : "Dejanos el número, o seguí y lo vemos más adelante."
                          : canal === "correo"
                            ? mailOk
                              ? "Queda pedido: te escribimos para conectar la casilla. Mientras tanto entrás sin avisos."
                              : "Escribí tu dirección, o seguí y lo vemos más adelante."
                            : "Seguís sin avisos. Lo vemos cuando quieras desde Conexiones."}
                {url.trim() && (
                  <> Mientras tanto sigo leyendo tu web: lo que saque queda en Entregas.</>
                )}
              </span>
            </div>
          </div>
        ) : paso === "charla" ? (
          <ChatOnboarding
            cfg={cfg}
            pedido={pedido}
            nombreAgente={nombre || "Tu agente"}
            onListo={() => terminar()}
            volviendoA={Boolean(destinoDelLink)}
          />
        ) : (
          <div className="w-full animate-fadeup">
            <CarruselEjemplos onElegir={(p) => { setPedido(p); setPaso("charla"); }} />
            {/* Primaria a armar el primero: el objetivo del onboarding entero
                es que el cliente salga con UNO andando, no que entre al portal.
                "Ir al inicio" existe igual — obligarlo sería un peaje, y el
                que quiere mirar antes de decidir tiene que poder. */}
            <div className="mt-7 flex flex-col items-center gap-3">
              <Btn onClick={() => {
                setPedido(
                  "Quiero que te encargues de algo que se repite en mi empresa. " +
                  "Proponeme dos o tres cosas que podrías hacer solo, de a una por " +
                  "vez, y armamos la que más me sirva.");
                setPaso("charla");
              }}>
                Contarle lo mío <ArrowRight className="h-4 w-4" />
              </Btn>
              <button
                onClick={() => terminar()}
                className="text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
              >
                {destinoDelLink ? "Ahora no, llevame a lo que vine a ver" : "Ahora no, ir al inicio"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/* ── La otra mitad de dejar saltear el canal ─────────────────────────────── */

const AVISO_CANAL_KEY = "tuagente_canal_pospuesto";
// Qué canal quedó EN TRÁMITE nuestro, para que la franja no le hable como si
// no hubiera contestado nada. Es solo el texto: quién ve la franja lo decide el
// manifiesto. Vive bajo el prefijo `tuagente_`, así que se borra al cambiar de
// agente como todo lo demás.
const AVISO_TRAMITE_KEY = "tuagente_canal_en_tramite";

/** Qué le pedimos que conecte, si es que pidió algo. */
export function recordarTramite(canal: "whatsapp" | "correo" | "telegram" | null) {
  try {
    if (canal) localStorage.setItem(AVISO_TRAMITE_KEY, canal);
    else localStorage.removeItem(AVISO_TRAMITE_KEY);
  } catch { /* modo privado: la franja cae al texto genérico, que es correcto igual */ }
}

const EN_TRAMITE: Record<string, string> = {
  whatsapp: "Estamos conectando tu WhatsApp; hasta que esté, lo que haga te espera acá.",
  correo: "Estamos conectando la casilla de tu empresa; hasta que esté, lo que haga te espera acá.",
  telegram: "Te estamos prendiendo el Telegram; hasta que esté, lo que haga te espera acá.",
};

/** El recordatorio de que todavía no hay por dónde avisarle.
 *
 *  Dejar entrar sin canal solo es honesto si el portal vuelve a ofrecerlo: si
 *  no, "después" es nunca y el cliente se queda con un agente que trabaja y no
 *  le avisa — que es exactamente lo que las dos clientas de prueba dijeron que
 *  las haría no pagar.
 *
 *  Aparece cuando NO QUEDÓ NINGÚN CANAL QUE FUNCIONE, que el alta guarda como
 *  `aviso: "ninguno"` sin importar cuál eligió el cliente. Con adapters viejos
 *  el campo no viene y no se muestra nada: es preferible no recordar nada a
 *  recordarle algo a alguien que ya tiene su canal puesto. Se puede cerrar, y
 *  cerrarlo dura: el camino no se pierde porque Conexiones sigue estando. */
export function AvisoSinCanal({ manifest }: { manifest: Manifest }) {
  const [cerrado, setCerrado] = useState(true);
  const [tramite, setTramite] = useState<string | null>(null);
  useEffect(() => {
    try {
      setCerrado(localStorage.getItem(AVISO_CANAL_KEY) === "1");
      setTramite(localStorage.getItem(AVISO_TRAMITE_KEY));
    } catch {
      setCerrado(false);
    }
  }, []);
  if (manifest.aviso !== "ninguno" || cerrado) return null;
  const cerrar = () => {
    setCerrado(true);
    try {
      localStorage.setItem(AVISO_CANAL_KEY, "1");
    } catch { /* modo privado: vale para esta sesión */ }
  };
  // A dónde lleva: a lo que dejó pedido, si dejó algo; si no, al atajo de
  // Telegram SOLO cuando este agente tiene bot; y si tampoco, a la pantalla
  // entera, donde el camino real es pedirlo. Y el link no dice "elegir un
  // canal": es la única vez que al cliente le aparecería la palabra que todo el
  // flujo evitó a propósito.
  const destino = tramite && EN_TRAMITE[tramite]
    ? `/app/conexiones?conexion=${tramite}`
    : manifest.telegram_bot
      ? "/app/conexiones?conexion=telegram"
      : "/app/conexiones";
  return (
    <div className="border-b border-black/[0.07] bg-c-amber/25 px-6 py-2.5 md:px-8">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <BellOff className="h-4 w-4 shrink-0 text-c-amber-ink" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-c-amber-ink">
          {(tramite && EN_TRAMITE[tramite])
            || "Todavía no tengo por dónde avisarte: lo que haga te espera acá hasta que entres."}{" "}
          <Link
            href={destino}
            className="font-semibold underline underline-offset-2"
          >
            {tramite && EN_TRAMITE[tramite] ? "Ver cómo va" : "Decime por dónde te aviso"}
          </Link>
        </p>
        <button
          onClick={cerrar}
          aria-label="Cerrar el aviso"
          title="Cerrar el aviso"
          className="shrink-0 rounded-lg p-1 text-c-amber-ink transition hover:bg-black/[0.05]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
