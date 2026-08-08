import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tuagente.uy"),
  title: "tuagente — Agentes de IA que trabajan dentro de tu empresa",
  description:
    "Instalamos agentes de IA autónomos dentro de tu empresa: conectados a tus sistemas, operando 24/7 y con un portal donde ves todo lo que hacen. Lo sensible espera tu aprobación. Un producto de pdelabs, Montevideo, Uruguay.",
  keywords: [
    "agentes de IA",
    "agentes de inteligencia artificial",
    "automatización con IA",
    "agentes autónomos para empresas",
    "IA para empresas LATAM",
    "agentes de IA Uruguay",
    "automatización de procesos",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://tuagente.uy",
    title: "tuagente — Agentes de IA que trabajan por vos",
    description:
      "Agentes de IA autónomos, conectados a tus sistemas, operando 24/7, con un portal donde ves todo lo que hacen.",
    locale: "es_UY",
    siteName: "tuagente.uy",
  },
  twitter: {
    card: "summary_large_image",
    title: "tuagente — Agentes de IA que trabajan por vos",
    description:
      "Agentes de IA autónomos, conectados a tus sistemas, con un portal donde ves todo lo que hacen.",
  },
};

export const viewport: Viewport = {
  themeColor: "#5B4BE8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={jakarta.variable}>
      <body className="font-sans antialiased">
        {/* Without JS the reveal observer never fires — keep everything visible. */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important}.animate-fadeup{opacity:1 !important;animation:none !important}`}</style>
        </noscript>
        {/* Rescate de deploy. Cuando redeployamos, la pestaña que el cliente ya
            tenía abierta sigue pidiendo los chunks del build viejo: 404 y
            pantalla en blanco SIN sidebar, que ni recargando se arregla. Le
            pasó a un cliente de prueba el 8/8 y su conclusión fue "compré algo
            y no anda". Va INLINE en el HTML a propósito: es lo único que
            sobrevive cuando justamente lo que falla es cargar un chunk.
            Una sola recarga, marcada en sessionStorage, para que un error
            permanente no se vuelva un loop de recargas. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var K="tuagente_chunk_reload",VENTANA=30000;
function esChunk(e){var m=(e&&(e.message||String(e)))||"";return /ChunkLoadError|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(m)}
function rescatar(e){if(!esChunk(e))return;var ahora=Date.now(),ultima=0;
try{ultima=parseInt(sessionStorage.getItem(K)||"0",10)||0}catch(_){}
if(ahora-ultima<VENTANA)return;
try{sessionStorage.setItem(K,String(ahora))}catch(_){}
location.reload()}
addEventListener("error",function(e){rescatar(e.error||e)});
addEventListener("unhandledrejection",function(e){rescatar(e.reason)})})()`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
