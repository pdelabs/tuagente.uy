export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO
  dateHuman: string;
  readingMin: number;
};

export const POSTS: Post[] = [
  {
    slug: "que-es-un-agente-de-ia",
    title: "¿Qué es un agente de IA? Explicado para dueños de empresas, sin humo",
    description:
      "Todo el mundo habla de agentes de IA. Acá te explicamos qué son de verdad, qué pueden hacer en tu empresa y qué no — sin una palabra técnica.",
    date: "2026-08-03",
    dateHuman: "3 de agosto de 2026",
    readingMin: 6,
  },
  {
    slug: "agente-de-ia-vs-chatbot",
    title: "Agente de IA vs chatbot: la diferencia que te están ocultando",
    description:
      "Te venden chatbots como si fueran agentes. No son lo mismo: uno conversa, el otro trabaja. Cómo distinguirlos antes de pagar.",
    date: "2026-08-03",
    dateHuman: "3 de agosto de 2026",
    readingMin: 5,
  },
  {
    slug: "como-funciona-un-agente-de-ia",
    title: "Cómo funciona un agente de IA por dentro (sin una línea de código)",
    description:
      "El loop de mirar, decidir y actuar; las herramientas que conectan al agente con tus sistemas; y los frenos que te dejan el control. Explicado con un ejemplo real de cobranzas.",
    date: "2026-08-03",
    dateHuman: "3 de agosto de 2026",
    readingMin: 7,
  },
  {
    slug: "hermes-el-motor-de-tus-agentes",
    title: "Hermes: el motor open-source sobre el que armamos tus agentes",
    description:
      "No reinventamos la rueda: tus agentes corren sobre Hermes, un runtime open-source creado por Nous Research. Por qué eso te conviene a vos.",
    date: "2026-08-03",
    dateHuman: "3 de agosto de 2026",
    readingMin: 5,
  },
  {
    slug: "cuanto-cuesta-un-agente-de-ia",
    title: "¿Cuánto cuesta un agente de IA en LATAM? Números reales, sin vueltas",
    description:
      "Qué cobra el mercado, qué cobramos nosotros, qué compone el precio de un agente de IA — y cuándo NO te conviene contratar uno.",
    date: "2026-08-03",
    dateHuman: "3 de agosto de 2026",
    readingMin: 6,
  },
];
