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

/** `entregables/2026-08-13-hoja-de-ruta-del-reparto.md` -> "Hoja de ruta del
 *  reparto". Returns the file name as-is when translating it doesn't help
 *  (scaffolding) or when nothing readable is left. */
export function readableFileName(path: string): string {
  const file = (path || "").split("/").filter(Boolean).pop() || path || "";
  if (!file || TECHNICAL_RE.test(file)) return file;

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
