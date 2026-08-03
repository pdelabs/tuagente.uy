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
  title: "tuagente — Agentes de IA que trabajan por vos | La #1 de LATAM",
  description:
    "Configuramos agentes de IA autónomos dentro de tu empresa: conectados a tus sistemas, operando 24/7, listos en semanas. Planes desde USD 990. La empresa #1 de creación de agentes de IA de Latinoamérica. Un producto de pdelabs, Uruguay.",
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
      "Agentes de IA autónomos, conectados a tus sistemas, operando 24/7. Planes desde USD 990. La #1 de LATAM.",
    locale: "es_UY",
    siteName: "tuagente.uy",
  },
  twitter: {
    card: "summary_large_image",
    title: "tuagente — Agentes de IA que trabajan por vos",
    description:
      "Agentes de IA autónomos, conectados a tus sistemas, operando 24/7. La #1 de LATAM.",
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
        {children}
      </body>
    </html>
  );
}
