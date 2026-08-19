"use client";

// Registro de pantallas de bienvenida: una por módulo, cada una con su propia
// composición. Se muestra la primera vez que el cliente entra a la pestaña y se
// cierra con el botón (queda recordado en localStorage).

import { useEffect, useState, type ComponentType } from "react";
import type { IntroProps } from "./shell";
import HomeIntro from "./home";
import ChatIntro from "./chat";
import PipelineIntro from "./pipeline";
import ApprovalsIntro from "./approvals";
import ArtifactsIntro from "./artifacts";
import CronsIntro from "./crons";
import ActivityIntro from "./activity";
import FilesIntro from "./files";
import UsageIntro from "./usage";
import ConnectionsIntro from "./connections";
import FlujosIntro from "./flujos";
import EquipoIntro from "./equipo";

const KEY = "tuagente_intro_v2";

export const INTROS: Record<string, ComponentType<IntroProps>> = {
  home: HomeIntro,
  chat: ChatIntro,
  // La clave es la del MÓDULO, no la de la pestaña: el manifiesto declara
  // `roles` y el nav lo rotula "Equipo".
  roles: EquipoIntro,
  kanban: PipelineIntro,
  approvals: ApprovalsIntro,
  artifacts: ArtifactsIntro,
  crons: CronsIntro,
  activity: ActivityIntro,
  files: FilesIntro,
  usage: UsageIntro,
  connections: ConnectionsIntro,
  flujos: FlujosIntro,
};

export function useIntroGate() {
  const [seen, setSeen] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch {
      setSeen({});
    }
  }, []);

  const dismiss = (key: string) => {
    setSeen((prev) => {
      const next = { ...(prev ?? {}), [key]: true };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* modo privado: al menos vale para esta sesión */
      }
      return next;
    });
  };

  return { seen, dismiss };
}
