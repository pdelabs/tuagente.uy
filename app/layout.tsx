import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tuagente.uy"),
  title: "tuagente — Un equipo de IA que trabaja adentro de tu empresa",
  description:
    "Contratás roles de IA — marketing, soporte, ventas, contabilidad o uno a medida — que trabajan 24/7 adentro de tu empresa. $U 1.500 por rol por mes, con un portal donde ves todo lo que hacen y nada sale sin tu aprobación. Un producto de pdelabs, Montevideo, Uruguay.",
  keywords: [
    "equipo de agentes de IA",
    "empleados de IA",
    "agentes de IA",
    "agentes de inteligencia artificial",
    "automatización con IA",
    "IA para empresas",
    "agentes de IA Uruguay",
    "automatización de procesos",
  ],
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://tuagente.uy",
    title: "tuagente — Un equipo de IA que trabaja adentro de tu empresa",
    description:
      "Contratás los roles que necesitás y trabajan 24/7 adentro de tu empresa. $U 1.500 por rol por mes, y nada sale para afuera sin tu ok.",
    locale: "es_UY",
    siteName: "tuagente.uy",
  },
  twitter: {
    card: "summary_large_image",
    title: "tuagente — Un equipo de IA que trabaja adentro de tu empresa",
    description:
      "Contratás los roles que necesitás y trabajan 24/7 adentro de tu empresa. $U 1.500 por rol por mes, con un portal donde ves todo lo que hacen.",
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
        {/* Deploy rescue. When we redeploy, a tab the client already had open
            keeps requesting chunks from the old build: a 404 and a blank
            screen with NO sidebar, which reloading alone doesn't fix. It
            happened to a test client on 8/8 and their takeaway was "I bought
            something and it doesn't work". This runs INLINE in the HTML on
            purpose: it's the only thing that survives when the very thing
            that's failing is loading a chunk. A single reload, flagged in
            sessionStorage, so a permanent error doesn't turn into a reload
            loop. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var KEY="tuagente_chunk_reload",WINDOW_MS=30000;
function isChunkError(e){var m=(e&&(e.message||String(e)))||"";return /ChunkLoadError|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(m)}
function rescue(e){if(!isChunkError(e))return;var now=Date.now(),last=0;
try{last=parseInt(sessionStorage.getItem(KEY)||"0",10)||0}catch(_){}
if(now-last<WINDOW_MS)return;
try{sessionStorage.setItem(KEY,String(now))}catch(_){}
location.reload()}
addEventListener("error",function(e){rescue(e.error||e)});
addEventListener("unhandledrejection",function(e){rescue(e.reason)})})()`,
          }}
        />
        {children}
        {/* Vercel analytics. Lives in the root layout, so it covers the
            landing, the blog and the portal. It doesn't use cookies or
            identify the visitor, which is what lets us run it without a
            consent banner. Locally it sends nothing: the script only
            injects itself on Vercel deploys. */}
        <Analytics />
      </body>
    </html>
  );
}
