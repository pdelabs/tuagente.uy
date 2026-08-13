"use client";

// Cómo se llama, en criollo, lo que el agente guardó.
//
// El agente no nombra archivos: los direcciona. La skill `entregable` arma el
// nombre con la fecha adelante y el título en slug
// (`entregables/2026-08-13-hoja-de-ruta-del-reparto-jueves-13-de-agosto-de-2026.md`),
// y encima lo corta a lo ancho — `deliver.py` trunca el slug en 56 caracteres,
// así que cae cualquier cosa a la mitad y queda un guión colgando:
// `…-13-de-agosto-de-.md`. Una clienta de prueba lo anotó tal cual: "cortado a
// la mitad y con esas letras raras al final".
//
// Eso se arregla de los dos lados. Del lado del agente, que corte por palabra
// (pedido al kit). De este lado, que el cliente no vea nunca el slug: ve un
// nombre. La ruta sigue existiendo —es lo que se le pide al adapter y lo que
// se copia como link—, pero deja de ser lo que se lee.

/** Palabras que no pueden quedar al final de un nombre. Son las que deja
 *  colgando el corte del agente ("… 13 de agosto de"). */
const COLGANTES = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "y", "o", "a", "al",
  "en", "con", "por", "para", "sin", "que", "su", "sus", "lo",
]);

/** Lo que se nombra por su archivo y no por su contenido: el andamiaje del
 *  agente. Un `.py` que se llama "Validar hoja ruta hoy" es peor que
 *  `validar_hoja_ruta_hoy.py` — ahí el nombre técnico ES la información. */
const TECNICO = /\.(py|rb|sh|bash|zsh|pl|js|mjs|cjs|ts|tsx|jsx|ipynb|json|jsonl|ya?ml|toml|ini|cfg|conf|env|log|sql|xml|css|html?)$/i;

/** `entregables/2026-08-13-hoja-de-ruta-del-reparto.md` → "Hoja de ruta del
 *  reparto". Devuelve el nombre del archivo tal cual cuando traducirlo no
 *  ayuda (andamiaje) o cuando no queda nada legible. */
export function nombreLegibleDeArchivo(ruta: string): string {
  const archivo = (ruta || "").split("/").filter(Boolean).pop() || ruta || "";
  if (!archivo || TECNICO.test(archivo)) return archivo;

  const sinExtension = archivo.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  // La fecha del principio la pone el agente para ordenar la carpeta; el
  // cliente ya tiene la fecha en la fila y en el visor.
  const sinFecha = sinExtension.replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, "");
  const palabras = sinFecha.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  while (palabras.length > 1 && COLGANTES.has(palabras[palabras.length - 1].toLowerCase())) {
    palabras.pop();
  }
  const texto = palabras.join(" ");
  if (!texto) return archivo;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** La extensión en mayúscula ("XLSX"), para decirle al cliente con qué se abre
 *  lo que ya no muestra el nombre del archivo. "" si no tiene. */
export function tipoDeArchivo(ruta: string): string {
  const archivo = (ruta || "").split("/").pop() || "";
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(archivo);
  return m ? m[1].toUpperCase() : "";
}
