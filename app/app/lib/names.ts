"use client";

// What the agent saved, called out in plain terms.
//
// The agent doesn't name files: it addresses them. The `deliverable` skill
// builds the name with the date in front and the title as a slug
// (`entregables/2026-08-13-hoja-de-ruta-del-reparto-jueves-13-de-agosto-de-2026.md`),
// and on top of that it truncates it by width -- `deliver.py` cuts the slug
// at 56 characters, so anything falls right in the middle and leaves a
// dash hanging: `…-13-de-agosto-de-.md`. A test client wrote it down exactly
// like that: "cut in half with those weird letters at the end".
//
// It gets fixed on both sides. On the agent's side, by cutting on a word
// boundary (requested from the kit). On this side, by the client never
// seeing the slug: they see a name. The path still exists -- it's what gets
// asked of the adapter and what gets copied as a link -- but it stops being
// what's read.

/** Words that can't be left at the end of a name. They're the ones the
 *  agent's cut leaves hanging ("… 13 de agosto de"). */
const TRAILING_STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "y", "o", "a", "al",
  "en", "con", "por", "para", "sin", "que", "su", "sus", "lo",
]);

/** What gets named by its file and not by its content: the agent's own
 *  scaffolding. A `.py` called "Validar hoja ruta hoy" is worse than
 *  `validar_hoja_ruta_hoy.py` -- there the technical name IS the information. */
const TECHNICAL_RE = /\.(py|rb|sh|bash|zsh|pl|js|mjs|cjs|ts|tsx|jsx|ipynb|json|jsonl|ya?ml|toml|ini|cfg|conf|env|log|sql|xml|css|html?)$/i;

/** The files the product itself puts in every workspace, by what they ARE to
 *  the owner. Their names are addresses the engine picked: «MEMORY» and
 *  «Borrador» said nothing, and the notebook's said it in English. */
const KNOWN_FILES: Record<string, string> = {
  "negocio/borrador.md": "El borrador de tu negocio",
  "memoria/main/MEMORY.md": "Lo que tu agente se acuerda",
};

/** The workspace's own folders, in the owner's words. The folders the agent
 *  makes for her work are named by the agent, in her language, and show as
 *  they are; these are the engine's and the plugins', and `main` or `flows`
 *  on her screen was English she never chose. */
const KNOWN_FOLDERS: Record<string, string> = {
  negocio: "Tu negocio",
  memoria: "Memoria",
  "memoria/main": "De tu agente",
  entregables: "Entregables",
  entrada: "Entrada",
  imagenes: "Imágenes",
  posteos: "Posteos",
  flows: "Flujos",
  interno: "Interno",
};

const inWorkspace = (path: string) =>
  (path || "").replace(/^\/?(?:opt\/data\/)?workspace\//, "").replace(/^\.?\/+/, "");

/** A folder's name as the owner reads it, by its full path (`memoria/main`). */
export function folderLabel(path: string): string {
  const p = inWorkspace(path).replace(/\/+$/, "");
  return KNOWN_FOLDERS[p] ?? p.split("/").pop() ?? p;
}

/** `entregables/2026-08-13-hoja-de-ruta-del-reparto.md` -> "Hoja de ruta del
 *  reparto". Returns the file name as-is when translating it doesn't help
 *  (scaffolding) or when nothing readable is left. */
export function readableFileName(path: string): string {
  const known = KNOWN_FILES[inWorkspace(path)];
  if (known) return known;
  const file = (path || "").split("/").filter(Boolean).pop() || path || "";
  if (!file || TECHNICAL_RE.test(file)) return file;

  // A generated picture is named by its day and a counter
  // (`imagenes/2026-09-23-1.png`): with the date stripped, Archivos listed it
  // as «1». It is named as what it is, on the day it was made.
  const picture = /^(\d{4})-(\d{2})-(\d{2})-(\d+)\.(png|jpe?g|webp|gif)$/i.exec(file);
  if (picture) return `Imagen ${Number(picture[4])} · ${picture[3]}/${picture[2]}`;

  const withoutExtension = file.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  // The agent puts the leading date there to sort the folder; the client
  // already has the date in the row and in the viewer.
  const withoutDate = withoutExtension.replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, "");
  const words = withoutDate.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  while (words.length > 1 && TRAILING_STOPWORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  const text = words.join(" ");
  if (!text) return file;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The extension in caps ("XLSX"), to tell the client what to open with
 *  whatever the file name no longer shows. "" if it has none. */
export function fileType(path: string): string {
  const file = (path || "").split("/").pop() || "";
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(file);
  return m ? m[1].toUpperCase() : "";
}
