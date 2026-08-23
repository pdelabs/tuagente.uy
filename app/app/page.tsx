"use client";

// /app: the portal's entry point. Always goes to home, which is ours and
// doesn't depend on which modules the agent exposes.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AppIndex() {
  const router = useRouter();
  useEffect(() => { router.replace("/app/home"); }, [router]);
  return null;
}
