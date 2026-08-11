import { create } from 'zustand'

export type LearningWorkspaceView = 'today' | 'calendar' | 'goals' | 'focus' | 'review' | 'reports' | 'periods'

interface LearningWorkspaceState {
  activeView: LearningWorkspaceView
  createGoalSignal: number
  setActiveView: (view: LearningWorkspaceView) => void
  requestCreateGoal: () => void
}

const useLearningWorkspaceStore = create<LearningWorkspaceState>((set) => ({
  activeView: 'today',
  createGoalSignal: 0,
  setActiveView: (activeView) => set({ activeView }),
  requestCreateGoal: () => set((state) => ({
    activeView: 'goals',
    createGoalSignal: state.createGoalSignal + 1,
  })),
}))

export default useLearningWorkspaceStore
