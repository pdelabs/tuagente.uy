"use client";

// Icons Lucide does not have, drawn the way Lucide draws: a 24-unit box,
// round caps and joins, stroked in `currentColor`, so they sit in a row of
// Lucide icons without anyone noticing which is which. Here and not in a
// module because a module's screen and its welcome screen (`intros/`) both
// draw them, and `lib/` does not import from modules.

import type { SVGProps } from "react";

/** WhatsApp's mark: a round speech bubble with its tail down-left and a
 *  handset inside. Grey like every other channel glyph — the brand's green
 *  logo in a row of grey icons would be the loudest thing on the screen for
 *  no reason. */
export function WhatsAppGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9z" />
      <path
        strokeWidth={1.5}
        d="M8.8 8.6c0-.6.5-1.1 1.1-1.1h.5l1 2.3-.9.9a5.5 5.5 0 0 0 2.6 2.6l.9-.9 2.3 1v.5c0 .6-.5 1.1-1.1 1.1a6.4 6.4 0 0 1-6.4-6.4z"
      />
    </svg>
  );
}
