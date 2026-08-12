import { create } from "zustand";
import type { DailyReflection, DailyReportGoalEntry } from "@/types/learning";

export interface PendingLearningReportDraft {
  date: string;
  overall: string;
  reflection: DailyReflection;
  entries: DailyReportGoalEntry[];
}

export type LearningWorkspaceView =
  "today" | "calendar" | "goals" | "focus" | "review" | "reports" | "periods";
export type LearningPeriodRequest = { type: "week" | "month"; anchor: string };

interface LearningWorkspaceState {
  activeView: LearningWorkspaceView;
  createGoalSignal: number;
  expandedScheduleWeekStart: string | null;
  pendingReportDraft: PendingLearningReportDraft | null;
  periodReportRequest: LearningPeriodRequest | null;
  setActiveView: (view: LearningWorkspaceView) => void;
  setExpandedScheduleWeekStart: (start: string | null) => void;
  requestCreateGoal: () => void;
  clearCreateGoalRequest: () => void;
  setPendingReportDraft: (draft: PendingLearningReportDraft | null) => void;
  openPeriodReport: (request: LearningPeriodRequest) => void;
  clearPeriodReportRequest: () => void;
}

const useLearningWorkspaceStore = create<LearningWorkspaceState>((set) => ({
  activeView: "today",
  createGoalSignal: 0,
  expandedScheduleWeekStart: null,
  pendingReportDraft: null,
  periodReportRequest: null,
  setActiveView: (activeView) => set({ activeView }),
  setExpandedScheduleWeekStart: (expandedScheduleWeekStart) =>
    set({ expandedScheduleWeekStart }),
  requestCreateGoal: () =>
    set((state) => ({
      activeView: "goals",
      createGoalSignal: state.createGoalSignal + 1,
    })),
  clearCreateGoalRequest: () => set({ createGoalSignal: 0 }),
  setPendingReportDraft: (pendingReportDraft) => set({ pendingReportDraft }),
  openPeriodReport: (periodReportRequest) =>
    set({ periodReportRequest, activeView: "reports" }),
  clearPeriodReportRequest: () => set({ periodReportRequest: null }),
}));

export default useLearningWorkspaceStore;
