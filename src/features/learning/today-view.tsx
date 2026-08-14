"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Brain,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  FileText,
  Flame,
  Gauge,
  Link2,
  Pencil,
  Plus,
  Sparkles,
  Target,
  TimerReset,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  addLocalDays,
  formatChineseDate,
  formatLocalDate,
  localWeekday,
  nextStudyDate,
} from "@/lib/learning/date";
import {
  getPeriodicLearningReport,
  listLearningDaySummaries,
  listLearningScheduleEvents,
} from "@/lib/learning/repository";
import { getLearningPeriodBounds } from "@/lib/learning/period-report";
import { isTauriRuntime } from "@/lib/check";
import { cn } from "@/lib/utils";
import useLearningStore from "@/stores/learning";
import { useSidebarStore } from "@/stores/sidebar";
import emitter from "@/lib/emitter";
import useLearningWorkspaceStore from "@/stores/learning-workspace";
import type {
  LearningGoal,
  LearningScheduleEvent,
  LearningTask,
} from "@/types/learning";
import { MaimemoProgressCard } from "./maimemo-progress-card";

type TodayNavigation = "focus" | "reports" | "calendar" | "goals" | "review";

function TaskProgressControl({
  task,
  onChange,
}: {
  task: LearningTask;
  onChange: (id: string, progress: number) => Promise<void>;
}) {
  const normalizedProgress = Number.isFinite(task.progressPercent)
    ? task.progressPercent
    : task.status === "done"
      ? 100
      : 0;
  const [value, setValue] = useState(normalizedProgress);
  useEffect(() => setValue(normalizedProgress), [normalizedProgress]);
  return (
    <div className="mt-2 flex items-center gap-3">
      <Slider
        aria-label={`${task.title}进度`}
        className="min-w-24 flex-1"
        value={[value]}
        min={0}
        max={100}
        step={5}
        onValueChange={(values) => setValue(values[0] || 0)}
        onValueCommit={(values) => void onChange(task.id, values[0] || 0).catch(() => setValue(normalizedProgress))}
      />
      <span className="w-9 text-right text-xs font-medium tabular-nums">
        {value}%
      </span>
      {task.plannedMinutes > 0 ? (
        <span
          className="text-[11px] text-muted-foreground/70"
          title="预计时间，仅供参考"
        >
          约 {task.plannedMinutes}m
        </span>
      ) : null}
    </div>
  );
}

function goalStatus(goal: LearningGoal, date: string) {
  if (goal.status === "completed" || goal.progressPercent >= 100)
    return { label: "已达成", tone: "success" as const };
  if (goal.endDate < date) return { label: `已逾期`, tone: "danger" as const };
  const start = new Date(`${goal.startDate}T12:00:00`).getTime();
  const end = new Date(`${goal.endDate}T12:00:00`).getTime();
  const now = new Date(`${date}T12:00:00`).getTime();
  const expected =
    end <= start
      ? 100
      : Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
  if (goal.progressPercent + 10 < expected)
    return { label: "进度偏慢", tone: "warning" as const };
  return { label: "按计划进行", tone: "neutral" as const };
}

function GoalTodayCard({
  goal,
  tasks,
  date,
  onTaskChange,
  onTaskProgress,
  onTaskEdit,
  onFocus,
  onOpenNote,
  onAiReport,
}: {
  goal: LearningGoal;
  tasks: LearningTask[];
  date: string;
  onTaskChange: (id: string, done: boolean) => Promise<void>;
  onTaskProgress: (id: string, progress: number) => Promise<void>;
  onTaskEdit: (task: LearningTask) => void;
  onFocus: () => void;
  onOpenNote?: (path: string) => void;
  onAiReport: (goal: LearningGoal) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const status = goalStatus(goal, date);
  const done = tasks.filter((task) => task.status === "done").length;
  const averageProgress = tasks.length
    ? Math.round(
        tasks.reduce((sum, task) => sum + task.progressPercent, 0) /
          tasks.length,
      )
    : 0;
  const remainingDays = Math.max(
    0,
    Math.ceil(
      (new Date(`${goal.endDate}T12:00:00`).getTime() -
        new Date(`${date}T12:00:00`).getTime()) /
        86400000,
    ),
  );

  const finishAll = async () => {
    setFinishing(true);
    try {
      for (const task of tasks.filter((item) => item.status !== "done"))
        await onTaskChange(task.id, true);
      toast.success(`“${goal.title}”今天的任务已完成`);
    } catch (error) {
      toast.error("完成任务失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setFinishing(false);
    }
  };

  return (
    <Card
      className={cn(
        "overflow-hidden",
        status.tone === "danger" && "border-destructive/30",
        status.tone === "warning" && "border-amber-500/30",
      )}
    >
      <CardHeader className="gap-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="truncate text-base">{goal.title}</CardTitle>
              <Badge
                variant={status.tone === "danger" ? "destructive" : "outline"}
                className={cn(
                  status.tone === "success" &&
                    "border-emerald-500/30 text-emerald-600",
                  status.tone === "warning" &&
                    "border-amber-500/30 text-amber-600",
                )}
              >
                {status.label}
              </Badge>
            </div>
            <CardDescription className="mt-1 line-clamp-2">
              {goal.description}
            </CardDescription>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {Math.round(goal.progressPercent)}%
          </span>
        </div>
        <Progress value={goal.progressPercent} className="h-1.5" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="size-3.5" />
            今日 {done}/{tasks.length}
          </span>
          <span className="flex items-center gap-1">
            <Gauge className="size-3.5" />
            任务进度 {averageProgress}%
          </span>
          <span className="flex items-center gap-1">
            <Target className="size-3.5" />
            剩余 {remainingDays} 天
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length ? (
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="group flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={task.status === "done"}
                  onCheckedChange={(checked) =>
                    void onTaskChange(task.id, checked === true).catch(() => undefined)
                  }
                  aria-label={`${task.title}完成状态`}
                />
                <div className="min-w-0 flex-1">
                  {task.notePath && isTauriRuntime() ? (
                    <button
                      type="button"
                      className={cn(
                        "flex max-w-full items-center gap-1.5 text-left text-sm font-medium hover:underline",
                        task.status === "done" &&
                          "text-muted-foreground line-through",
                      )}
                      onClick={() => onOpenNote?.(task.notePath!)}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">{task.title}</span>
                    </button>
                  ) : (
                    <p
                      className={cn(
                        "text-sm font-medium",
                        task.status === "done" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                  )}
                  {task.description ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                  <TaskProgressControl task={task} onChange={onTaskProgress} />
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="opacity-60 group-hover:opacity-100"
                  onClick={() => onTaskEdit(task)}
                  aria-label={`编辑${task.title}`}
                >
                  <Pencil />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            今天没有为这个目标安排任务。
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            size="sm"
            onClick={onFocus}
            disabled={!tasks.some(task => task.status !== "done" && task.status !== "cancelled")}
            title={tasks.some(task => task.status !== "done" && task.status !== "cancelled") ? undefined : "请先为今天安排任务"}
          >
            <TimerReset />
            {tasks.some(task => task.status !== "done" && task.status !== "cancelled") ? "开始执行" : "暂无任务"}
          </Button>
          {tasks.some((task) => task.status !== "done") ? (
            <Button
              size="sm"
              variant="outline"
              disabled={finishing}
              onClick={() => void finishAll()}
            >
              <Check />
              {finishing ? "处理中…" : "完成今日任务"}
            </Button>
          ) : (
            <Badge variant="secondary" className="h-8 px-3 text-emerald-600">
              <CheckCircle2 />
              今日已完成
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => onAiReport(goal)}>
            <Sparkles />
            复盘这一项
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TodayView({
  onNavigate,
  onCreateGoal,
  onOpenNote,
}: {
  onNavigate: (value: TodayNavigation) => void;
  onCreateGoal: () => void;
  onOpenNote?: (path: string) => void;
}) {
  const {
    date,
    tasks,
    goals,
    sessions,
    report,
    settings,
    addManualTask,
    setTaskStatus,
    setTaskProgress,
    updateTask,
  } = useLearningStore();
  const { leftSidebarVisible, rightSidebarVisible, toggleRightSidebar } =
    useSidebarStore();
  const openPeriodReport = useLearningWorkspaceStore(
    (state) => state.openPeriodReport,
  );
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<LearningTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(0);
  const [taskProgress, setTaskProgressValue] = useState(0);
  const [completionCriteria, setCompletionCriteria] = useState("");
  const [activeNotePath, setActiveNotePath] = useState("");
  const [linkCurrentNote, setLinkCurrentNote] = useState(true);
  const [events, setEvents] = useState<LearningScheduleEvent[]>([]);
  const [periodReminders, setPeriodReminders] = useState<
    Array<{
      type: "week" | "month";
      anchor: string;
      start: string;
      end: string;
    }>
  >([]);
  const nativeRuntime = isTauriRuntime();
  const actionable = tasks.filter((task) => task.status !== "cancelled");
  const percent = actionable.length
    ? Math.round(
        actionable.reduce((sum, task) => sum + task.progressPercent, 0) /
          actionable.length,
      )
    : 0;
  const focusedMinutes = Math.round(
    sessions
      .filter((session) => session.status === "completed")
      .reduce((sum, session) => sum + session.effectiveSeconds, 0) / 60,
  );
  const activeGoals = goals.filter(
    (goal) => goal.status === "active" || goal.status === "planned",
  );
  const manualTasks = actionable.filter((task) => !task.goalId);
  const isToday = date === formatLocalDate(Date.now(), settings.timeZone);
  const compactLayout = leftSidebarVisible && rightSidebarVisible;

  const goalTasks = useMemo(
    () =>
      new Map(
        activeGoals.map((goal) => [
          goal.id,
          actionable.filter((task) => task.goalId === goal.id),
        ]),
      ),
    [actionable, activeGoals],
  );

  useEffect(() => {
    void listLearningScheduleEvents(date, date)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [date]);

  useEffect(() => {
    let cancelled = false;
    const previousWeekAnchor = addLocalDays(date, -7);
    const previousMonthDate = new Date(`${date}T12:00:00`);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const previousMonthAnchor = formatLocalDate(
      previousMonthDate.getTime(),
      settings.timeZone,
    );
    const candidates = [
      { type: "week" as const, anchor: previousWeekAnchor },
      { type: "month" as const, anchor: previousMonthAnchor },
      ...(localWeekday(date) === 0 && report?.completedAt
        ? [{ type: "week" as const, anchor: date }]
        : []),
      ...(addLocalDays(date, 1).slice(0, 7) !== date.slice(0, 7) &&
      report?.completedAt
        ? [{ type: "month" as const, anchor: date }]
        : []),
    ];
    void Promise.all(
      candidates.map(async (candidate) => {
        const bounds = getLearningPeriodBounds(
          candidate.type,
          candidate.anchor,
        );
        const [saved, summaries] = await Promise.all([
          getPeriodicLearningReport(candidate.type, bounds.start, bounds.end),
          listLearningDaySummaries(bounds.start, bounds.end),
        ]);
        return !saved && summaries.some((summary) => summary.checkedIn)
          ? { ...candidate, ...bounds }
          : null;
      }),
    )
      .then((values) => {
        if (!cancelled)
          setPeriodReminders(
            values
              .filter((value): value is NonNullable<typeof value> =>
                Boolean(value),
              )
              .filter(
                (value, index, all) =>
                  all.findIndex(
                    (item) =>
                      item.type === value.type && item.start === value.start,
                  ) === index,
              ),
          );
      })
      .catch(() => {
        if (!cancelled) setPeriodReminders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date, report?.completedAt, settings.timeZone]);

  useEffect(() => {
    if (!nativeRuntime) return;
    let unsubscribe: (() => void) | undefined;
    void import("@/stores/article").then(({ default: useArticleStore }) => {
      setActiveNotePath(useArticleStore.getState().activeFilePath);
      unsubscribe = useArticleStore.subscribe((state) =>
        setActiveNotePath(state.activeFilePath),
      );
    });
    return () => unsubscribe?.();
  }, [nativeRuntime]);

  const handleCreateTask = async () => {
    if (!title.trim()) return;
    try {
      await addManualTask({
        date,
        title: title.trim(),
        description: description.trim(),
        plannedMinutes: Math.max(0, minutes || 0),
        notePath: linkCurrentNote ? activeNotePath || null : null,
      });
      setTitle("");
      setDescription("");
      setTaskOpen(false);
      toast.success("临时任务已添加");
    } catch (error) {
      toast.error("添加任务失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const openCreateTask = () => {
    setEditingTask(null);
    setTitle("");
    setDescription("");
    setCompletionCriteria("");
    setMinutes(0);
    setTaskProgressValue(0);
    setLinkCurrentNote(Boolean(activeNotePath));
    setTaskOpen(true);
  };

  const openEditTask = (task: LearningTask) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description);
    setCompletionCriteria(task.completionCriteria);
    setMinutes(task.plannedMinutes);
    setTaskProgressValue(task.progressPercent);
    setTaskOpen(true);
  };

  const handleSaveTask = async () => {
    if (!title.trim()) return;
    if (!editingTask) return handleCreateTask();
    try {
      await updateTask(editingTask.id, {
        title: title.trim(),
        description: description.trim(),
        completionCriteria: completionCriteria.trim(),
        plannedMinutes: Math.max(0, minutes || 0),
        progressPercent: taskProgress,
      });
      setTaskOpen(false);
      setEditingTask(null);
      toast.success("任务已更新");
    } catch (error) {
      toast.error("更新任务失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const changeTask = async (id: string, done: boolean) => {
    try {
      await setTaskStatus(id, done ? "done" : "todo");
    } catch (error) {
      toast.error("更新任务状态失败", {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  const changeTaskProgress = async (id: string, progress: number) => {
    try {
      await setTaskProgress(id, progress);
    } catch (error) {
      toast.error("更新任务进度失败", {
        description: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const openAi = async (prompt: string) => {
    if (!rightSidebarVisible) await toggleRightSidebar();
    window.setTimeout(() => emitter.emit("quick-prompt-insert", prompt), 120);
  };

  const createAiPlan = async (
    targetDate: string,
    basedOnDate: string | null = null,
  ) => {
    const adjustingExistingPlan = targetDate === date && actionable.length > 0;
    await openAi(
      `请为 ${targetDate} ${adjustingExistingPlan ? "调整现有" : "生成可执行的"}今日计划。先调用 learning_get_context 读取目标总体路线、${adjustingExistingPlan ? "当前已有任务、" : "任务和"}最近 30 天日报，再根据我的每日可投入时间安排具体任务。${adjustingExistingPlan ? "保留合理的任务，并根据我的修改要求调整任务内容、顺序或时长。我的修改要求：[请在这里填写]。" : ""}${basedOnDate ? `重点依据 ${basedOnDate} 已完成打卡的日报，并兼顾更早的日报趋势。` : ""}如果信息不足先问我；方案确定后调用 learning_propose_daily_plan 生成完整的待采纳卡片，不要直接写入任务。`,
    );
  };

  const createGoalReport = async (goal: LearningGoal) => {
    const goalTaskSummary =
      (goalTasks.get(goal.id) || [])
        .map(
          (task) =>
            `- [${task.status === "done" ? "x" : " "}] ${task.title}（进度 ${Math.round(task.progressPercent)}%${task.plannedMinutes > 0 ? `，预计 ${task.plannedMinutes} 分钟` : ""}）`,
        )
        .join("\n") || "- 今日没有任务";
    await openAi(
      `请采访我并生成 ${date} 的单目标日报，目标是“${goal.title}”（goalId: ${goal.id}）。采访的每一轮必须调用 learning_ask_interview_question 生成问题卡，一次只问一个问题并等待回答，不要用普通正文代替问题卡；封闭问题使用 direct，开放问题使用 draft。请询问实际做了什么、完成情况、投入时长、状态、困难、收获和累计进度。信息充分后调用 learning_propose_daily_report，scope 使用 single-goal，只包含该目标。这只是当天统一日报中的一个条目，不要保存或结束今日打卡。\n\n今日任务：\n${goalTaskSummary}`,
    );
  };

  const createWholeDayReport = async () => {
    await openAi(
      `请采访我并生成 ${date} 的整日回顾。先调用 learning_get_context 读取今天每个目标的任务、专注记录和已有日报内容。采访的每一轮必须调用 learning_ask_interview_question 生成问题卡，一次只问一个问题并等待回答，不要用普通正文代替问题卡；封闭问题使用 direct，开放问题使用 draft。再逐项询问做了什么、完成情况、状态、困难、收获和下一步调整。信息充分后调用 learning_propose_daily_report，scope 使用 whole-day，覆盖今天讨论过的全部目标。不要直接保存或结束打卡。`,
    );
  };

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6",
        compactLayout && "gap-4 p-4",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {formatChineseDate(date)}
          </p>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {isToday ? "今日计划" : "当天计划"}
            </h1>
            {report?.completedAt ? (
              <Badge className="bg-emerald-600">
                <CheckCircle2 />
                已完成
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            从今天的任务进入相关笔记，完成后留下简短回顾。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void createAiPlan(date)}>
            <Sparkles />
            {actionable.length ? "AI 调整今日规划" : "AI 生成今日规划"}
          </Button>
          <Button variant="outline" onClick={openCreateTask}>
            <Plus />
            临时任务
          </Button>
          <Button
            onClick={() => onNavigate("focus")}
            disabled={!actionable.some(task => task.status !== "done")}
            title={actionable.some(task => task.status !== "done") ? undefined : "请先添加今天要执行的任务"}
          >
            <TimerReset />
            {actionable.some(task => task.status !== "done") ? "开始执行" : "暂无可执行任务"}
          </Button>
        </div>
      </div>

      {!compactLayout ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="min-w-36 flex-1">
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-muted-foreground">今天的进度</span>
                <span>{percent}%</span>
              </div>
              <Progress value={percent} className="h-1.5" />
            </div>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Flame className="size-4 text-amber-500" />
              已投入 {focusedMinutes} 分钟
            </span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Target className="size-4" />
              {activeGoals.length} 个目标
            </span>
          </CardContent>
        </Card>
      ) : null}

      {periodReminders.length ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">有周期尚未汇总</p>
              <p className="text-sm text-muted-foreground">
                及时生成周报/月报，后续 AI
                规划会优先使用汇总信息，避免上下文持续变长。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {periodReminders.map((reminder) => (
                <Button
                  key={`${reminder.type}-${reminder.start}`}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openPeriodReport({
                      type: reminder.type,
                      anchor: reminder.anchor,
                    })
                  }
                >
                  生成 {reminder.start} 至 {reminder.end}{" "}
                  {reminder.type === "week" ? "周报" : "月报"}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div
        className={cn(
          "grid items-start gap-5",
          !compactLayout && "lg:grid-cols-[minmax(0,1fr)_320px]",
        )}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              按目标执行
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("goals")}
            >
              目标总览
              <ArrowRight />
            </Button>
          </div>
          {activeGoals.length ? (
            activeGoals.map((goal) => (
              <GoalTodayCard
                key={goal.id}
                goal={goal}
                tasks={goalTasks.get(goal.id) || []}
                date={date}
                onTaskChange={changeTask}
                onTaskProgress={changeTaskProgress}
                onTaskEdit={openEditTask}
                onFocus={() => onNavigate("focus")}
                onOpenNote={onOpenNote}
                onAiReport={createGoalReport}
              />
            ))
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Target className="size-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">今天还没有安排</p>
                  <p className="text-sm text-muted-foreground">
                    先创建目标，再和 AI 一起安排第一天要做的事情。
                  </p>
                </div>
                <Button onClick={onCreateGoal}>创建目标</Button>
              </CardContent>
            </Card>
          )}
          {manualTasks.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">其他任务</CardTitle>
                <CardDescription>
                  临时任务和未关联目标的 NoteGen 笔记。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {manualTasks.map((task) => (
                  <div
                    key={task.id}
                    className="group flex items-start gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={task.status === "done"}
                      onCheckedChange={(checked) =>
                        void changeTask(task.id, checked === true)
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          task.status === "done" &&
                            "text-muted-foreground line-through",
                        )}
                      >
                        {task.title}
                      </span>
                      <TaskProgressControl
                        task={task}
                        onChange={changeTaskProgress}
                      />
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="opacity-60 group-hover:opacity-100"
                      onClick={() => openEditTask(task)}
                      aria-label={`编辑${task.title}`}
                    >
                      <Pencil />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside
          className={cn(
            "space-y-4",
            compactLayout
              ? "grid gap-4 space-y-0 sm:grid-cols-2"
              : "lg:sticky lg:top-20",
          )}
        >
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">今日日程</CardTitle>
                <CardDescription>
                  {events.length ? `${events.length} 项安排` : "尚未安排"}
                </CardDescription>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onNavigate("calendar")}
                aria-label="打开日程"
              >
                <ArrowRight />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {events.length ? (
                events.slice(0, 5).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onNavigate("calendar")}
                    className="flex w-full items-start gap-3 rounded-md border p-2.5 text-left hover:bg-muted/50"
                  >
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {event.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {event.allDay
                          ? "全天"
                          : `${event.startTime || "--:--"}${event.endTime ? ` – ${event.endTime}` : ""}`}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate("calendar")}
                  className="w-full rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground hover:bg-muted/40"
                >
                  添加今天的第一项日程
                </button>
              )}
            </CardContent>
          </Card>
          <MaimemoProgressCard />
          <Card>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Brain className="size-4" />
                  复习笔记
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  从已经整理的知识中继续复习。
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onNavigate("review")}
              >
                打开
                <ArrowRight />
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarCheck2 className="size-4" />
                完成今天
              </CardTitle>
              <CardDescription>
                {report?.completedAt
                  ? "今天已经回顾完成，可以根据实际情况安排下一天。"
                  : "简单说说今天做了什么，NoteGen 会把回顾保存成 Markdown 笔记。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full justify-start"
                onClick={() => void createWholeDayReport()}
              >
                <Sparkles />和 AI 一起回顾今天
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-between"
                onClick={() => onNavigate("reports")}
              >
                自己填写回顾
                <ArrowRight />
              </Button>
              {report?.completedAt ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() =>
                    void createAiPlan(
                      nextStudyDate(date, settings.weeklyDays),
                      date,
                    )
                  }
                >
                  <Sparkles />
                  安排下一天
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>

      <ResponsiveDialog open={taskOpen} onOpenChange={setTaskOpen}>
        <ResponsiveDialogContent className="overflow-y-auto">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {editingTask ? "编辑任务" : "添加临时任务"}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manual-task-title">任务标题</Label>
              <Input
                id="manual-task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-task-description">说明</Label>
              <Textarea
                id="manual-task-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {editingTask ? (
              <div className="space-y-2">
                <Label htmlFor="manual-task-criteria">完成标准</Label>
                <Textarea
                  id="manual-task-criteria"
                  value={completionCriteria}
                  onChange={(event) =>
                    setCompletionCriteria(event.target.value)
                  }
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="manual-task-minutes">
                预计时间（分钟，可选）
              </Label>
              <Input
                id="manual-task-minutes"
                type="number"
                min={0}
                max={720}
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
            </div>
            {editingTask ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>当前进度</Label>
                  <span className="text-sm font-medium tabular-nums">
                    {taskProgress}%
                  </span>
                </div>
                <Slider
                  value={[taskProgress]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={(values) =>
                    setTaskProgressValue(values[0] || 0)
                  }
                />
              </div>
            ) : null}
            {!editingTask && nativeRuntime && activeNotePath ? (
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <Checkbox
                  checked={linkCurrentNote}
                  onCheckedChange={(checked) =>
                    setLinkCurrentNote(checked === true)
                  }
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 font-medium">
                    <Link2 className="size-4" />
                    关联当前 NoteGen 笔记
                  </span>
                  <span
                    className="block truncate text-xs text-muted-foreground"
                    title={activeNotePath}
                  >
                    {activeNotePath}
                  </span>
                </span>
              </label>
            ) : null}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setTaskOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => void handleSaveTask()}
              disabled={!title.trim()}
            >
              {editingTask ? "保存修改" : "添加"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}
