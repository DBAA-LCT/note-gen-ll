export interface LearningGoalInputLike {
  title: string;
  startDate: string;
  endDate: string;
  timeZone: string;
  weeklyDays: number[];
  timeWeight: number;
}

export interface LearningScheduleInputLike {
  title: string;
  localDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
}

export interface DailyReportInputLike {
  localDate: string;
  entries: Array<{
    goalId: string;
    progressPercent: number;
    studyMinutes: number;
  }>;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function assertValidLearningGoalInput(input: LearningGoalInputLike): void {
  if (!input.title.trim()) throw new Error("目标标题不能为空。");
  if (!isValidLocalDate(input.startDate) || !isValidLocalDate(input.endDate)) {
    throw new Error("目标日期格式无效。");
  }
  if (input.endDate < input.startDate) {
    throw new Error("目标结束日期不能早于开始日期。");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone }).format(0);
  } catch {
    throw new Error("目标时区无效。");
  }
  if (
    input.weeklyDays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    )
  ) {
    throw new Error("目标执行日无效。");
  }
  if (!Number.isFinite(input.timeWeight) || input.timeWeight <= 0) {
    throw new Error("目标时间权重必须大于 0。");
  }
}

export function assertValidLearningScheduleInput(
  input: LearningScheduleInputLike,
): void {
  if (!input.title.trim()) throw new Error("日程标题不能为空。");
  if (!isValidLocalDate(input.localDate)) throw new Error("日程日期无效。");
  if (input.allDay) return;
  if (
    !input.startTime
    || !input.endTime
    || !LOCAL_TIME_PATTERN.test(input.startTime)
    || !LOCAL_TIME_PATTERN.test(input.endTime)
  ) {
    throw new Error("日程时间无效。");
  }
  if (input.endTime <= input.startTime) {
    throw new Error("日程结束时间必须晚于开始时间。");
  }
}

export function assertValidDailyReportInput(input: DailyReportInputLike): void {
  if (!isValidLocalDate(input.localDate)) throw new Error("日报日期无效。");
  const goalIds = new Set<string>();
  for (const entry of input.entries) {
    if (!entry.goalId || goalIds.has(entry.goalId)) {
      throw new Error("日报包含重复或无效的目标。");
    }
    goalIds.add(entry.goalId);
    if (
      !Number.isFinite(entry.progressPercent)
      || entry.progressPercent < 0
      || entry.progressPercent > 100
    ) {
      throw new Error("日报目标进度必须在 0 到 100 之间。");
    }
    if (!Number.isFinite(entry.studyMinutes) || entry.studyMinutes < 0) {
      throw new Error("日报投入时间不能为负数。");
    }
  }
}

export function taskStateForProgress(progress: number): {
  progressPercent: number;
  status: "todo" | "in-progress" | "done";
} {
  const progressPercent = Math.max(0, Math.min(100, Math.round(progress)));
  return {
    progressPercent,
    status: progressPercent >= 100
      ? "done"
      : progressPercent > 0
        ? "in-progress"
        : "todo",
  };
}

export function shouldRestoreGeneratedTask(task: {
  status: string;
  manuallyEdited: boolean;
}): boolean {
  return task.status === "cancelled" && !task.manuallyEdited;
}

export function allocateWeightedMinutes(
  goals: Array<{ id: string; timeWeight: number; createdAt: number }>,
  budgetMinutes: number,
): Map<string, number> {
  const budget = Math.max(15, Math.min(720, Math.round(budgetMinutes)));
  const result = new Map<string, number>();
  if (!goals.length) return result;

  const totalWeight = goals.reduce(
    (sum, goal) => sum + Math.max(1, goal.timeWeight),
    0,
  );
  const shares = goals.map((goal) => {
    const exact = budget * Math.max(1, goal.timeWeight) / totalWeight;
    return {
      goal,
      minutes: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = budget - shares.reduce((sum, share) => sum + share.minutes, 0);
  shares
    .sort(
      (left, right) =>
        right.remainder - left.remainder
        || left.goal.createdAt - right.goal.createdAt,
    )
    .forEach((share) => {
      if (remaining > 0) {
        share.minutes += 1;
        remaining -= 1;
      }
    });
  shares.forEach((share) => result.set(share.goal.id, share.minutes));
  return result;
}

export function createLatestRequestGuard() {
  let latestRequest = 0;
  return {
    begin(): number {
      latestRequest += 1;
      return latestRequest;
    },
    isLatest(request: number): boolean {
      return request === latestRequest;
    },
  };
}
