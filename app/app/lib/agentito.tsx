"use client";

// La cara estática del agentito: fallback del personaje Rive mientras carga
// (o si falla). Mismo dibujo que el .riv, con parpadeo y flote por CSS para
// que incluso el fallback esté vivo — sin un byte de JS.

export function AgentitoSvg({ className }: { className?: string }) {
  return (
    <div className={`onb-bob ${className ?? ""}`}>
      <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
        <line x1="60" y1="22" x2="60" y2="11" stroke="#5B4BE8" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="9" r="4.5" fill="#5B4BE8" />
        <ellipse cx="60" cy="68" rx="46" ry="44" fill="#5B4BE8" />
        <g className="onb-eyes">
          <circle cx="46" cy="58" r="10.5" fill="#fff" />
          <circle cx="74" cy="58" r="10.5" fill="#fff" />
          <circle cx="46" cy="58" r="4.6" fill="#14131F" />
          <circle cx="74" cy="58" r="4.6" fill="#14131F" />
        </g>
        <path d="M48 80 Q60 89 72 80" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}
