"use client";

import { create } from "zustand";
import type { SystemKey, TraceSource } from "./system-data";

export type AppView = "guide" | "lab" | "dashboard" | "systemData" | "erp" | "cardRules" | "mismatches" | "case" | "trace" | "investigation" | "resolution" | "caseHistory" | "history";

type SettlementState = {
  view: AppView;
  scenarioId: string;
  scenarioHasRun: boolean;
  systemTab: SystemKey;
  selectedReference: string;
  traceSource: TraceSource;
  analyzing: boolean;
  analyzed: boolean;
  selectedHypothesis: number;
  assignedOwner: string;
  requestGenerated: boolean;
  reprocessing: boolean;
  resolved: boolean;
  guideActive: boolean;
  guideStep: number;
  setView: (view: AppView) => void;
  setSystemTab: (systemTab: SystemKey) => void;
  selectScenario: (id: string) => void;
  runScenario: () => void;
  openCase: (reference: string, source: TraceSource) => void;
  openTrace: (reference: string, source: TraceSource) => void;
  startAnalysis: () => void;
  finishAnalysis: () => void;
  selectHypothesis: (index: number) => void;
  assignOwner: (owner: string) => void;
  generateRequest: () => void;
  startReprocess: () => void;
  finishReprocess: () => void;
  startGuide: () => void;
  nextGuide: () => void;
  previousGuide: () => void;
  endGuide: () => void;
  resetDemo: () => void;
};

export const useSettlementStore = create<SettlementState>((set) => ({
  view: "dashboard",
  scenarioId: "batch-failure",
  scenarioHasRun: false,
  systemTab: "pos",
  selectedReference: "VV-20260716-9001",
  traceSource: "erp",
  analyzing: false,
  analyzed: false,
  selectedHypothesis: 0,
  assignedOwner: "",
  requestGenerated: false,
  reprocessing: false,
  resolved: false,
  guideActive: false,
  guideStep: 0,
  setView: (view) => set({ view }),
  setSystemTab: (systemTab) => set({ systemTab }),
  selectScenario: (scenarioId) => set({ scenarioId, scenarioHasRun: false, analyzed: false, selectedHypothesis: 0, assignedOwner: "", requestGenerated: false, resolved: false }),
  runScenario: () => set({ view: "dashboard", scenarioHasRun: true, analyzed: false, resolved: false }),
  openCase: (selectedReference, traceSource) => set({ view: "case", selectedReference, traceSource }),
  openTrace: (selectedReference, traceSource) => set({ view: "trace", selectedReference, traceSource }),
  startAnalysis: () => set({ analyzing: true, analyzed: false }),
  finishAnalysis: () => set({ analyzing: false, analyzed: true }),
  selectHypothesis: (selectedHypothesis) => set({ selectedHypothesis }),
  assignOwner: (assignedOwner) => set({ assignedOwner }),
  generateRequest: () => set({ requestGenerated: true }),
  startReprocess: () => set({ reprocessing: true }),
  finishReprocess: () => set({ reprocessing: false, resolved: true }),
  startGuide: () => set({ view: "dashboard", scenarioId: "batch-failure", scenarioHasRun: true, analyzed: true, selectedHypothesis: 0, assignedOwner: "", requestGenerated: false, reprocessing: false, resolved: false, guideActive: true, guideStep: 0 }),
  nextGuide: () => set((state) => ({ guideStep: Math.min(7, state.guideStep + 1) })),
  previousGuide: () => set((state) => ({ guideStep: Math.max(0, state.guideStep - 1) })),
  endGuide: () => set({ guideActive: false }),
  resetDemo: () => set({ view: "dashboard", scenarioId: "batch-failure", scenarioHasRun: false, systemTab: "pos", selectedReference: "VV-20260716-9001", traceSource: "erp", analyzing: false, analyzed: false, selectedHypothesis: 0, assignedOwner: "", requestGenerated: false, reprocessing: false, resolved: false, guideActive: false, guideStep: 0 }),
}));
