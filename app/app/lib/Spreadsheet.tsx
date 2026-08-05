"use client";

// Vista previa de planillas (.xlsx) y de CSV.
//
// Por qué existe: el agente entrega planillas —pedidos del día, listas de
// precios, controles— y el cliente sube las que le exporta su sistema de
// gestión. Hasta ahora eso era "sin vista previa": bajás el archivo y lo abrís
// en otro programa para ver tres números.
//
// DOS DECISIONES QUE NO CONVIENE DESHACER:
//
// 1. **Las celdas se dibujan como texto de React, nunca como HTML.** Las
//    librerías de planillas ofrecen un `sheet_to_html` que es cómodo y es un
//    agujero: el contenido lo escribe el agente o lo sube el cliente, así que
//    inyectarlo como HTML sería XSS con pasos extra. React escapa solo.
// 2. **La librería entra por import() dinámico**, como mermaid: pesa y solo
//    hace falta cuando alguien abre una planilla.
//
// Se eligió `read-excel-file` sobre las alternativas: solo lee (no escribe, que
// es superficie que no necesitamos), pesa ~2,7 MB contra los ~22 MB de exceljs,
// y el paquete `xlsx` de npm quedó clavado en 0.18.5 — SheetJS publica por su
// propio CDN, así que usarlo desde npm sería fijar una versión vieja.

import { useEffect, useState } from "react";
import { AlertTriangle, Table2 } from "lucide-react";

/** Tope de filas dibujadas. Una planilla de 5.000 filas cuelga la pestaña y no
 *  se lee igual: se muestran las primeras y se ofrece bajarla. */
const MAX_FILAS = 300;

type Hoja = { nombre: string; filas: unknown[][] };

/** Una celda puede venir como número, fecha, booleano o null. */
function celda(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return v.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (typeof v === "number") return v.toLocaleString("es-UY");
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

const esNumero = (v: unknown) => typeof v === "number";

/** CSV simple: respeta comillas dobles y separador coma o punto y coma. */
function parseCsv(texto: string): unknown[][] {
  const sep = (texto.split("\n")[0].match(/;/g) || []).length >
    (texto.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

export function Tabla({ filas }: { filas: unknown[][] }) {
  if (filas.length === 0) return <p className="text-sm text-ink-soft">La hoja está vacía.</p>;
  const [encabezado, ...cuerpo] = filas;
  const recortada = cuerpo.length > MAX_FILAS;
  const visibles = recortada ? cuerpo.slice(0, MAX_FILAS) : cuerpo;
  return (
    <>
      {/* La tabla scrollea adentro de su contenedor: la página nunca se va de ancho. */}
      <div className="overflow-x-auto rounded-lg border border-black/[0.07]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-black/[0.03]">
              {encabezado.map((c, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-black/[0.07] px-2.5 py-1.5 text-left font-semibold text-ink"
                >
                  {celda(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((f, i) => (
              <tr key={i} className="even:bg-black/[0.015]">
                {encabezado.map((_, j) => (
                  <td
                    key={j}
                    className={`whitespace-nowrap border-b border-black/[0.04] px-2.5 py-1.5 text-ink ${
                      esNumero(f[j]) ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {celda(f[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recortada && (
        <p className="mt-2 text-[12px] text-ink-soft">
          Se muestran las primeras {MAX_FILAS} filas de {cuerpo.length}. Descargá el archivo para
          verlo entero.
        </p>
      )}
    </>
  );
}

export function CsvPreview({ text }: { text: string }) {
  const filas = parseCsv(text);
  return <Tabla filas={filas} />;
}

export default function Spreadsheet({ bytes }: { bytes: ArrayBuffer }) {
  const [hojas, setHojas] = useState<Hoja[] | null>(null);
  const [activa, setActiva] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        // v9 devuelve TODAS las hojas de una sola llamada: [{sheet, data}].
        // La librería consume Blob en el browser; el ArrayBuffer ya lo tenemos.
        const hojasLeidas = await readXlsxFile(new Blob([bytes]));
        const leidas: Hoja[] = hojasLeidas.map((h) => ({
          nombre: h.sheet,
          filas: h.data as unknown[][],
        }));
        if (vivo) setHojas(leidas);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { vivo = false; };
  }, [bytes]);

  if (error) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[12px] text-c-amber-ink">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No pude mostrar esta planilla ({error}). Podés descargarla y abrirla como siempre.
      </p>
    );
  }
  if (!hojas) return <p className="text-sm text-ink-soft">Abriendo la planilla…</p>;
  if (hojas.length === 0) return <p className="text-sm text-ink-soft">La planilla no tiene hojas.</p>;

  return (
    <div>
      {hojas.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {hojas.map((h, i) => (
            <button
              key={h.nombre}
              onClick={() => setActiva(i)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition ${
                i === activa
                  ? "bg-ink text-white"
                  : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
              }`}
            >
              <Table2 className="h-3 w-3" />
              {h.nombre}
            </button>
          ))}
        </div>
      )}
      <Tabla filas={hojas[activa].filas} />
    </div>
  );
}
