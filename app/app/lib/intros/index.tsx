"use client";

// Registry of welcome screens: one per module, each with its own
// composition. Shown the first time the client enters the tab and dismissed
// with the button (remembered in localStorage).

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
import FlowsIntro from "./flows";
import TeamIntro from "./team";

const KEY = "tuagente_intro_v2";

export const INTROS: Record<string, ComponentType<IntroProps>> = {
  home: HomeIntro,
  chat: ChatIntro,
  // The key is the MODULE's, not the tab's: the manifest declares `roles` and
  // the nav labels it "Equipo".
  roles: TeamIntro,
  kanban: PipelineIntro,
  approvals: ApprovalsIntro,
  artifacts: ArtifactsIntro,
  crons: CronsIntro,
  activity: ActivityIntro,
  files: FilesIntro,
  usage: UsageIntro,
  connections: ConnectionsIntro,
  flows: FlowsIntro,
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
        /* private mode: at least it's good for this session */
      }
      return next;
    });
  };

  return { seen, dismiss };
}
