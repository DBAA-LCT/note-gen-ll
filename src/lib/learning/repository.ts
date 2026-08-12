import { isTauriRuntime } from "@/lib/check";

type LearningRepository = typeof import("@/db/learning");

let repositoryPromise: Promise<LearningRepository> | null = null;

async function repository(): Promise<LearningRepository> {
  if (!repositoryPromise) {
    repositoryPromise = isTauriRuntime()
      ? import("@/db/learning")
      : (import("@/db/learning-web") as Promise<LearningRepository>);
  }
  return repositoryPromise;
}

export const initLearningDb = async () => (await repository()).initLearningDb();
export const listLearningGoals: LearningRepository["listLearningGoals"] =
  async (options) => (await repository()).listLearningGoals(options);
export const createLearningGoal: LearningRepository["createLearningGoal"] =
  async (input) => (await repository()).createLearningGoal(input);
export const updateLearningGoal: LearningRepository["updateLearningGoal"] =
  async (id, input) => (await repository()).updateLearningGoal(id, input);
export const setLearningGoalStatus: LearningRepository["setLearningGoalStatus"] =
  async (id, status) => (await repository()).setLearningGoalStatus(id, status);
export const listLearningTasks: LearningRepository["listLearningTasks"] =
  async (date) => (await repository()).listLearningTasks(date);
export const listLearningTasksForGoal: LearningRepository["listLearningTasksForGoal"] =
  async (goalId) => (await repository()).listLearningTasksForGoal(goalId);
export const insertPlannedTasks: LearningRepository["insertPlannedTasks"] =
  async (tasks) => (await repository()).insertPlannedTasks(tasks);
export const createManualLearningTask: LearningRepository["createManualLearningTask"] =
  async (input) => (await repository()).createManualLearningTask(input);
export const replaceAiLearningTasks: LearningRepository["replaceAiLearningTasks"] =
  async (date, tasks, generatedFromDate) =>
    (await repository()).replaceAiLearningTasks(date, tasks, generatedFromDate);
export const setLearningTaskStatus: LearningRepository["setLearningTaskStatus"] =
  async (id, status) => (await repository()).setLearningTaskStatus(id, status);
export const setLearningTaskProgress: LearningRepository["setLearningTaskProgress"] =
  async (id, progress) =>
    (await repository()).setLearningTaskProgress(id, progress);
export const updateLearningTask: LearningRepository["updateLearningTask"] =
  async (id, input) => (await repository()).updateLearningTask(id, input);
export const saveFocusSession: LearningRepository["saveFocusSession"] = async (
  session,
) => (await repository()).saveFocusSession(session);
export const listFocusSessions: LearningRepository["listFocusSessions"] =
  async (date) => (await repository()).listFocusSessions(date);
export const getDailyReport: LearningRepository["getDailyReport"] = async (
  date,
) => (await repository()).getDailyReport(date);
export const saveDailyReport: LearningRepository["saveDailyReport"] = async (
  input,
) => (await repository()).saveDailyReport(input);
export const archiveDailyReport: LearningRepository["archiveDailyReport"] =
  async (date) => (await repository()).archiveDailyReport(date);
export const restoreDailyReport: LearningRepository["restoreDailyReport"] =
  async (date) => (await repository()).restoreDailyReport(date);
export const deleteDailyReportPermanently: LearningRepository["deleteDailyReportPermanently"] =
  async (date) => (await repository()).deleteDailyReportPermanently(date);
export const listArchivedDailyReports: LearningRepository["listArchivedDailyReports"] =
  async () => (await repository()).listArchivedDailyReports();
export const getLearningSettings: LearningRepository["getLearningSettings"] =
  async () => (await repository()).getLearningSettings();
export const saveLearningSettings: LearningRepository["saveLearningSettings"] =
  async (settings) => (await repository()).saveLearningSettings(settings);
export const listLearningDaySummaries: LearningRepository["listLearningDaySummaries"] =
  async (start, end) =>
    (await repository()).listLearningDaySummaries(start, end);
export const listDailyReports: LearningRepository["listDailyReports"] = async (
  start,
  end,
) => (await repository()).listDailyReports(start, end);
export const listDailyReportsForSummary: LearningRepository["listDailyReportsForSummary"] = async (
  start,
  end,
) => (await repository()).listDailyReportsForSummary(start, end);
export const getPeriodicLearningReport: LearningRepository["getPeriodicLearningReport"] =
  async (type, start, end) =>
    (await repository()).getPeriodicLearningReport(type, start, end);
export const listPeriodicLearningReports: LearningRepository["listPeriodicLearningReports"] =
  async (type, start, end) =>
    (await repository()).listPeriodicLearningReports(type, start, end);
export const savePeriodicLearningReport: LearningRepository["savePeriodicLearningReport"] =
  async (input) => (await repository()).savePeriodicLearningReport(input);
export const listLearningScheduleEvents: LearningRepository["listLearningScheduleEvents"] =
  async (start, end) =>
    (await repository()).listLearningScheduleEvents(start, end);
export const saveLearningScheduleEvent: LearningRepository["saveLearningScheduleEvent"] =
  async (input, id) =>
    (await repository()).saveLearningScheduleEvent(input, id);
export const deleteLearningScheduleEvent: LearningRepository["deleteLearningScheduleEvent"] =
  async (id) => (await repository()).deleteLearningScheduleEvent(id);
export const listLearningKnowledgeBases: LearningRepository["listLearningKnowledgeBases"] =
  async () => (await repository()).listLearningKnowledgeBases();
export const saveLearningKnowledgeBase: LearningRepository["saveLearningKnowledgeBase"] =
  async (input, id) =>
    (await repository()).saveLearningKnowledgeBase(input, id);
export const deleteLearningKnowledgeBase: LearningRepository["deleteLearningKnowledgeBase"] =
  async (id) => (await repository()).deleteLearningKnowledgeBase(id);
export const listLearningKnowledgeItems: LearningRepository["listLearningKnowledgeItems"] =
  async (baseId) => (await repository()).listLearningKnowledgeItems(baseId);
export const saveLearningKnowledgeItem: LearningRepository["saveLearningKnowledgeItem"] =
  async (input, id) =>
    (await repository()).saveLearningKnowledgeItem(input, id);
export const deleteLearningKnowledgeItem: LearningRepository["deleteLearningKnowledgeItem"] =
  async (id) => (await repository()).deleteLearningKnowledgeItem(id);
export const listLearningReviewStates: LearningRepository["listLearningReviewStates"] =
  async () => (await repository()).listLearningReviewStates();
export const listLearningReviewAttempts: LearningRepository["listLearningReviewAttempts"] =
  async (start, end) =>
    (await repository()).listLearningReviewAttempts(start, end);
export const saveLearningReviewAttempt: LearningRepository["saveLearningReviewAttempt"] =
  async (attempt, state) =>
    (await repository()).saveLearningReviewAttempt(attempt, state);
export const getLearningReviewSettings: LearningRepository["getLearningReviewSettings"] =
  async () => (await repository()).getLearningReviewSettings();
export const saveLearningReviewSettings: LearningRepository["saveLearningReviewSettings"] =
  async (settings) => (await repository()).saveLearningReviewSettings(settings);
