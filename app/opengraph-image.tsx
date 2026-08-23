import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt =
  "tuagente — Un equipo de IA que trabaja adentro de tu empresa. $U 1.500 por rol, por mes.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #5B4BE8 0%, #4436c9 55%, #14131F 130%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 12,
            background: "rgba(255,255,255,0.14)",
            borderRadius: 999,
            padding: "12px 28px",
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          Hecho en Uruguay · $U 1.500 por rol, por mes
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>
            Un equipo de IA que trabaja adentro de tu empresa.
          </div>
          <div style={{ display: "flex", fontSize: 34, color: "rgba(255,255,255,0.85)" }}>
            Marketing · Soporte · Ventas · Contabilidad · o el rol que te falte
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 30,
            fontWeight: 800,
          }}
        >
          <div style={{ display: "flex" }}>tuagente.uy</div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>
            Powered by pdelabs · Uruguay 🇺🇾
          </div>
        </div>
      </div>
    ),
    size
  );
}
