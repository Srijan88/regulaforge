"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type AppMode = "live" | "mock";

export interface MockPolicy {
  id: string;
  name: string;
  shortName: string;
  description: string;
  ruleCount: number;
  color: string;
  icon: string;
}

export const MOCK_POLICIES: MockPolicy[] = [
  {
    id: "pci-dss",
    name: "PCI-DSS v4.0",
    shortName: "PCI-DSS",
    description: "Payment Card Industry Data Security Standard — cardholder data protection",
    ruleCount: 22,
    color: "#2e72d2",
    icon: "💳",
  },
  {
    id: "ffiec",
    name: "FFIEC IT Examination",
    shortName: "FFIEC",
    description: "Federal Financial Institutions Examination Council — banking IT security",
    ruleCount: 18,
    color: "#a78bfa",
    icon: "🏦",
  },
  {
    id: "ofac",
    name: "OFAC Sanctions Screening",
    shortName: "OFAC",
    description: "Office of Foreign Assets Control — wire transfer & entity screening",
    ruleCount: 15,
    color: "#f59e0b",
    icon: "🌐",
  },
];

interface ModeContextType {
  mode: AppMode;
  selectedPolicy: MockPolicy | null;
  setMode: (m: AppMode) => void;
  setSelectedPolicy: (p: MockPolicy | null) => void;
  switchToMock: (p: MockPolicy) => void;
  switchToLive: () => void;
}

const ModeContext = createContext<ModeContextType>({
  mode: "mock",
  selectedPolicy: null,
  setMode: () => {},
  setSelectedPolicy: () => {},
  switchToMock: () => {},
  switchToLive: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>("mock");
  const [selectedPolicy, setSelectedPolicy] = useState<MockPolicy | null>(MOCK_POLICIES[0]);

  const switchToMock = (p: MockPolicy) => {
    setSelectedPolicy(p);
    setMode("mock");
  };

  const switchToLive = () => {
    setMode("live");
    setSelectedPolicy(null);
  };

  return (
    <ModeContext.Provider value={{ mode, selectedPolicy, setMode, setSelectedPolicy, switchToMock, switchToLive }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
