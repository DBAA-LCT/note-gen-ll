import { create } from "zustand";
import {
  createLearningGoal,
  createManualLearningTask,
  getDailyReport,
  getLearningSettings,
  initLearningDb,
  insertPlannedTasks,
  replaceAiLearningTasks,
  listFocusSessions,
  listLearningGoals,
  listLearningTasks,
  saveDailyReport,
  archiveDailyReport,
  listArchivedDailyReports,
  restoreDailyReport,
  deleteDailyReportPermanently,
  savePeriodicLearningReport,
  saveFocusSession,
  saveLearningSettings,
  setLearningGoalStatus,
  setLearningTaskStatus,
  setLearningTaskProgress,
  updateLearningGoal,
  updateLearningTask,
} from "@/lib/learning/repository";
import { planTasksForDate } from "@/lib/learning/planner";
import { generateLocalPeriodicReport, getLearningPeriodBounds } from "@/lib/learning/period-report";
import type {
  CreateLearningGoalInput,
  DailyReport,
  FocusSession,
  LearningGoal,
  LearningGoalStatus,
  LearningSettings,
  LearningTask,
  LearningTaskStatus,
  PeriodicLearningReport,
  SaveDailyReportInput,
  AiLearningTaskDraft,
  UpdateLearningTaskInput,
} from "@/types/learning";
import { DEFAULT_LEARNING_SETTINGS } from "@/types/learning";

interface LearningStoreState {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  date: string;
  goals: LearningGoal[];
  tasks: LearningTask[];
  sessions: FocusSession[];
  report: DailyReport | null;
  archivedReports: DailyReport[];
  settings: LearningSettings;
  initialize: (date: string) => Promise<void>;
  loadDate: (
    date: string,
    options?: { ensureTasks?: boolean },
  ) => Promise<void>;
  refreshGoals: () => Promise<void>;
  ensureTasks: (date: string) => Promise<void>;
  saveGoal: (input: CreateLearningGoalInput, id?: string) => Promise<void>;
  setGoalStatus: (id: string, status: LearningGoalStatus) => Promise<void>;
  addManualTask: (input: {
    date: string;
    goalId?: string | null;
    notePath?: string | null;
    title: string;
    description?: string;
    plannedMinutes: number;
  }) => Promise<void>;
  adoptAiPlan: (
    date: string,
    tasks: AiLearningTaskDraft[],
    generatedFromDate?: string | null,
  ) => Promise<void>;
  setTaskStatus: (id: string, status: LearningTaskStatus) => Promise<void>;
  setTaskProgress: (id: string, progress: number) => Promise<void>;
  updateTask: (id: string, input: UpdateLearningTaskInput) => Promise<void>;
  saveSession: (session: FocusSession) => Promise<void>;
  saveReport: (input: SaveDailyReportInput) => Promise<DailyReport>;
  archiveReport: (date: string) => Promise<PeriodicLearningReport>;
  restoreReport: (date: string) => Promise<void>;
  deleteArchivedReport: (date: string) => Promise<void>;
  refreshArchivedReports: () => Promise<void>;
  updateSettings: (settings: LearningSettings) => Promise<void>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const useLearningStore = create<LearningStoreState>((set, get) => ({
  initialized: false,
  loading: false,
  error: null,
  date: "",
  goals: [],
  tasks: [],
  sessions: [],
  report: null,
  archivedReports: [],
  settings: DEFAULT_LEARNING_SETTINGS,

  initialize: async (date) => {
    if (get().initialized) {
      await get().loadDate(date);
      return;
    }
    set({ loading: true, error: null });
    try {
      await initLearningDb();
      const [goals, settings, archivedReports] = await Promise.all([
        listLearningGoals(),
        getLearningSettings(),
        listArchivedDailyReports(),
      ]);
      set({ goals, settings, archivedReports, initialized: true });
      await get().loadDate(date);
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  loadDate: async (date, options = {}) => {
    set({ loading: true, error: null, date });
    try {
      if (options.ensureTasks) await get().ensureTasks(date);
      const [tasks, sessions, report] = await Promise.all([
        listLearningTasks(date),
        listFocusSessions(date),
        getDailyReport(date),
      ]);
      set({ tasks, sessions, report });
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  refreshGoals: async () => set({ goals: await listLearningGoals() }),

  ensureTasks: async (date) => {
    const goals = get().goals.length ? get().goals : await listLearningGoals();
    const settings = get().settings || (await getLearningSettings());
    await insertPlannedTasks(planTasksForDate(goals, settings, date));
  },

  saveGoal: async (input, id) => {
    if (id) await updateLearningGoal(id, input);
    else await createLearningGoal(input);
    await get().refreshGoals();
    set({ tasks: await listLearningTasks(get().date) });
  },

  setGoalStatus: async (id, status) => {
    await setLearningGoalStatus(id, status);
    await get().refreshGoals();
    set({ tasks: await listLearningTasks(get().date) });
  },

  addManualTask: async (input) => {
    await createManualLearningTask({
      localDate: input.date,
      goalId: input.goalId,
      notePath: input.notePath,
      title: input.title,
      description: input.description,
      plannedMinutes: input.plannedMinutes,
    });
    if (input.date === get().date)
      set({ tasks: await listLearningTasks(input.date) });
  },

  adoptAiPlan: async (date, tasks, generatedFromDate = null) => {
    await replaceAiLearningTasks(date, tasks, generatedFromDate);
    if (date === get().date) set({ tasks: await listLearningTasks(date) });
  },

  setTaskStatus: async (id, status) => {
    await setLearningTaskStatus(id, status);
    set({ tasks: await listLearningTasks(get().date) });
  },

  setTaskProgress: async (id, progress) => {
    await setLearningTaskProgress(id, progress);
    set({ tasks: await listLearningTasks(get().date) });
  },

  updateTask: async (id, input) => {
    await updateLearningTask(id, input);
    set({ tasks: await listLearningTasks(get().date) });
  },

  saveSession: async (session) => {
    await saveFocusSession(session);
    if (session.localDate === get().date)
      set({ sessions: await listFocusSessions(get().date) });
  },

  saveReport: async (input) => {
    const report = await saveDailyReport(input);
    set({ report });
    if (get().settings.autoCompleteGoals) {
      await Promise.all(
        input.entries
          .filter((entry) => entry.progressPercent >= 100)
          .map((entry) => setLearningGoalStatus(entry.goalId, "completed")),
      );
    }
    await get().refreshGoals();
    return report;
  },

  archiveReport: async (date) => {
    const bounds = getLearningPeriodBounds("week", date);
    const weeklyDraft = await generateLocalPeriodicReport("week", bounds.start, bounds.end);
    if (!weeklyDraft.sourceDates.includes(date)) {
      throw new Error("日报尚未完成打卡，无法汇总进规划周报。");
    }
    const weeklyReport = await savePeriodicLearningReport(weeklyDraft);
    await archiveDailyReport(date);
    const archivedReports = await listArchivedDailyReports();
    if (get().date === date) set({ report: null, archivedReports });
    else set({ archivedReports });
    return weeklyReport;
  },

  restoreReport: async (date) => {
    await restoreDailyReport(date);
    const archivedReports = await listArchivedDailyReports();
    if (get().date === date) set({ report: await getDailyReport(date), archivedReports });
    else set({ archivedReports });
  },

  deleteArchivedReport: async (date) => {
    await deleteDailyReportPermanently(date);
    set({ archivedReports: await listArchivedDailyReports() });
  },

  refreshArchivedReports: async () => {
    set({ archivedReports: await listArchivedDailyReports() });
  },

  updateSettings: async (settings) => {
    await saveLearningSettings(settings);
    set({ settings });
  },
}));

export default useLearningStore;
