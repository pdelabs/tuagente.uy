"use client";

// Preview for spreadsheets (.xlsx) and CSV.
//
// Why it exists: the agent delivers spreadsheets -- the day's orders, price
// lists, reconciliations -- and the client uploads whatever their own
// management system exports. Until now that meant "no preview": download the
// file and open it in another program just to see three numbers.
//
// TWO DECISIONS BEST LEFT ALONE:
//
// 1. **Cells are drawn as React text, never as HTML.** Spreadsheet libraries
//    offer a `sheet_to_html` that's convenient and is a hole: the content is
//    written by the agent or uploaded by the client, so injecting it as HTML
//    would be XSS with extra steps. React escapes on its own.
// 2. **The library loads via dynamic import()**, like mermaid: it's heavy
//    and only needed when someone opens a spreadsheet.
//
// `read-excel-file` was chosen over the alternatives: it only reads (no
// writing, which is surface area we don't need), it weighs ~2.7 MB against
// exceljs's ~22 MB, and npm's `xlsx` package is stuck at 0.18.5 -- SheetJS
// publishes from its own CDN, so using it from npm would mean pinning an old
// version.

import { useEffect, useState } from "react";
import { AlertTriangle, Table2 } from "lucide-react";

/** Cap on rows drawn. A 5,000-row spreadsheet hangs the tab and doesn't read
 *  any better anyway: the first ones are shown and downloading it is offered. */
const MAX_ROWS = 300;

type Sheet = { name: string; rows: unknown[][] };

/** A cell can come in as a number, a date, a boolean, or null. */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return v.toLocaleDateString("es-UY", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (typeof v === "number") return v.toLocaleString("es-UY");
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

const isNumber = (v: unknown) => typeof v === "number";

/** Simple CSV: respects double quotes and either a comma or semicolon separator. */
function parseCsv(text: string): unknown[][] {
  const sep = (text.split("\n")[0].match(/;/g) || []).length >
    (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((f) => f.some((c) => c.trim() !== ""));
}

export function Table({ rows }: { rows: unknown[][] }) {
  if (rows.length === 0) return <p className="text-sm text-ink-soft">La hoja está vacía.</p>;
  const [header, ...body] = rows;
  const truncated = body.length > MAX_ROWS;
  const visible = truncated ? body.slice(0, MAX_ROWS) : body;
  return (
    <>
      {/* The table scrolls inside its own container: the page never overflows in width. */}
      <div className="overflow-x-auto rounded-lg border border-black/[0.07]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-black/[0.03]">
              {header.map((c, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap border-b border-black/[0.07] px-2.5 py-1.5 text-left font-semibold text-ink"
                >
                  {cellText(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((f, i) => (
              <tr key={i} className="even:bg-black/[0.015]">
                {header.map((_, j) => (
                  <td
                    key={j}
                    className={`whitespace-nowrap border-b border-black/[0.04] px-2.5 py-1.5 text-ink ${
                      isNumber(f[j]) ? "text-right tabular-nums" : ""
                    }`}
                  >
                    {cellText(f[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="mt-2 text-[12px] text-ink-soft">
          Se muestran las primeras {MAX_ROWS} filas de {body.length}. Descargá el archivo para
          verlo entero.
        </p>
      )}
    </>
  );
}

export function CsvPreview({ text }: { text: string }) {
  const rows = parseCsv(text);
  return <Table rows={rows} />;
}

export default function Spreadsheet({ bytes }: { bytes: ArrayBuffer }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        // v9 returns ALL sheets in a single call: [{sheet, data}]. The library
        // consumes a Blob in the browser; we already have the ArrayBuffer.
        const readSheets = await readXlsxFile(new Blob([bytes]));
        const parsed: Sheet[] = readSheets.map((h) => ({
          name: h.sheet,
          rows: h.data as unknown[][],
        }));
        if (alive) setSheets(parsed);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [bytes]);

  if (error) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[12px] text-c-amber-ink">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        No pude mostrar esta planilla ({error}). Podés descargarla y abrirla como siempre.
      </p>
    );
  }
  if (!sheets) return <p className="text-sm text-ink-soft">Abriendo la planilla…</p>;
  if (sheets.length === 0) return <p className="text-sm text-ink-soft">La planilla no tiene hojas.</p>;

  return (
    <div>
      {sheets.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sheets.map((h, i) => (
            <button
              key={h.name}
              onClick={() => setActive(i)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold transition ${
                i === active
                  ? "bg-ink text-white"
                  : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
              }`}
            >
              <Table2 className="h-3 w-3" />
              {h.name}
            </button>
          ))}
        </div>
      )}
      <Table rows={sheets[active].rows} />
    </div>
  );
}
