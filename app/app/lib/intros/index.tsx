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
import ActivityIntro from "./activity";
import FilesIntro from "./files";
import UsageIntro from "./usage";
import FlowsIntro from "./flows";
import PostsIntro from "./posts";
import InboxIntro from "./inbox";

const KEY = "tuagente_intro_v2";

export const INTROS: Record<string, ComponentType<IntroProps>> = {
  home: HomeIntro,
  chat: ChatIntro,
  // The key is the MODULE's, not the tab's: the manifest declares `kanban`
  // and the nav labels it "Tablero".
  kanban: PipelineIntro,
  inbox: InboxIntro,
  approvals: ApprovalsIntro,
  activity: ActivityIntro,
  files: FilesIntro,
  usage: UsageIntro,
  flows: FlowsIntro,
  posts: PostsIntro,
};

function stored(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

/** Marks a welcome screen seen from outside the shell. Onboarding's chat uses
 *  it: that conversation IS the Chat tab's first use, and its closing line
 *  promises «Esta charla te espera en el chat» — not a welcome screen over it. */
export function markIntroSeen(key: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...stored(), [key]: true }));
  } catch {
    /* private mode */
  }
}

export function useIntroGate() {
  const [seen, setSeen] = useState<Record<string, boolean> | null>(null);

  useEffect(() => { setSeen(stored()); }, []);

  // MERGED WITH WHAT IS STORED, not written from this hook's own copy: that
  // copy was read once, at mount, and writing it back erased whatever
  // `markIntroSeen` had added since.
  const dismiss = (key: string) => {
    setSeen((prev) => {
      const next = { ...stored(), ...(prev ?? {}), [key]: true };
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
