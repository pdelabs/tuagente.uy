import type { Metadata } from "next";
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
    "Configuramos agentes de IA autónomos dentro de tu empresa: conectados a tus sistemas, operando 24/7, listos en semanas. La empresa #1 de creación de agentes de IA de Latinoamérica.",
  openGraph: {
    type: "website",
    url: "https://tuagente.uy",
    title: "tuagente — Agentes de IA que trabajan por vos",
    description:
      "Agentes de IA autónomos, conectados a tus sistemas, operando 24/7. La #1 de LATAM.",
    locale: "es_UY",
  },
  themeColor: "#5B4BE8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={jakarta.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
