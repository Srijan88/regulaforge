"use client";

import { ModeProvider } from "@/contexts/ModeContext";
import { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  return <ModeProvider>{children}</ModeProvider>;
}
