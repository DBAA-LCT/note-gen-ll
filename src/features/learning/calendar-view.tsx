"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Flag,
  ListChecks,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  addLocalDays,
  formatChineseDate,
  formatLocalDate,
} from "@/lib/learning/date";
import {
  deleteLearningScheduleEvent,
  listLearningDaySummaries,
  listLearningScheduleEvents,
  listLearningTasks,
  saveLearningScheduleEvent,
} from "@/lib/learning/repository";
import { cn } from "@/lib/utils";
import useLearningStore from "@/stores/learning";
import useLearningWorkspaceStore from "@/stores/learning-workspace";
import type {
  LearningDaySummary,
  LearningScheduleEvent,
  LearningTask,
  SaveLearningScheduleEventInput,
} from "@/types/learning";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const toDate = (value: string) => new Date(`${value}T12:00:00`);
const dateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const monthKey = (value: Date) => dateKey(value).slice(0, 7);
const startOfWeek = (value: string) =>
  addLocalDays(value, -((toDate(value).getDay() + 6) % 7));

function rangeForMonth(cursor: Date) {
  const first = `${monthKey(cursor)}-01`;
  const last = new Date(
    cursor.getFullYear(),
    cursor.getMonth() + 1,
    0,
  ).getDate();
  const lastDate = `${monthKey(cursor)}-${String(last).padStart(2, "0")}`;
  return {
    start: startOfWeek(first),
    end: addLocalDays(startOfWeek(lastDate), 6),
  };
}

function monthCells(cursor: Date) {
  const first = `${monthKey(cursor)}-01`;
  const leading = (toDate(first).getDay() + 6) % 7;
  const days = new Date(
    cursor.getFullYear(),
    cursor.getMonth() + 1,
    0,
  ).getDate();
  const cells = [
    ...Array.from({ length: leading }, () => ""),
    ...Array.from({ length: days }, (_, index) => addLocalDays(first, index)),
  ];
  const trailing = (7 - (cells.length % 7)) % 7;
  return [...cells, ...Array.from({ length: trailing }, () => "")];
}

const emptyEvent = (localDate: string): SaveLearningScheduleEventInput => ({
  title: "",
  localDate,
  startTime: "09:00",
  endTime: "10:00",
  allDay: false,
  kind: "schedule",
  notes: "",
});

export function LearningCalendarView() {
  const { date, goals, tasks, sessions, report, settings, loadDate } =
    useLearningStore();
  const { expandedScheduleWeekStart, setExpandedScheduleWeekStart } =
    useLearningWorkspaceStore();
  const today = formatLocalDate(Date.now(), settings.timeZone);
  const [cursor, setCursor] = useState(() => toDate(date || today));
  const [summaries, setSummaries] = useState<LearningDaySummary[]>([]);
  const [events, setEvents] = useState<LearningScheduleEvent[]>([]);
  const [expandedWeekTasks, setExpandedWeekTasks] = useState<
    Map<string, LearningTask[]>
  >(new Map());
  const [query, setQuery] = useState("");
  const [eventOpen, setEventOpen] = useState(false);
  const [editingEvent, setEditingEvent] =
    useState<LearningScheduleEvent | null>(null);
  const [draft, setDraft] = useState<SaveLearningScheduleEventInput>(() =>
    emptyEvent(date || today),
  );
  const range = useMemo(() => rangeForMonth(cursor), [cursor]);

  const reload = useCallback(async () => {
    const [nextSummaries, nextEvents] = await Promise.all([
      listLearningDaySummaries(range.start, range.end),
      listLearningScheduleEvents(range.start, range.end),
    ]);
    setSummaries(nextSummaries);
    setEvents(nextEvents);
  }, [range.end, range.start]);
  useEffect(() => {
    void reload();
  }, [reload, report, sessions, tasks]);
  useEffect(() => {
    if (!expandedScheduleWeekStart) {
      setExpandedWeekTasks(new Map());
      return;
    }
    let cancelled = false;
    void Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        addLocalDays(expandedScheduleWeekStart, index),
      ).map(
        async (localDate) =>
          [localDate, await listLearningTasks(localDate)] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setExpandedWeekTasks(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [expandedScheduleWeekStart, tasks]);

  const summaryMap = useMemo(
    () => new Map(summaries.map((item) => [item.localDate, item])),
    [summaries],
  );
  const eventMap = useMemo(() => {
    const map = new Map<string, LearningScheduleEvent[]>();
    events
      .filter(
        (item) =>
          !query ||
          `${item.title} ${item.notes}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .forEach((item) =>
        map.set(item.localDate, [...(map.get(item.localDate) || []), item]),
      );
    return map;
  }, [events, query]);
  const deadlineMap = useMemo(() => {
    const map = new Map<string, typeof goals>();
    goals
      .filter((goal) => goal.status !== "deleted" && goal.status !== "archived")
      .forEach((goal) =>
        map.set(goal.endDate, [...(map.get(goal.endDate) || []), goal]),
      );
    return map;
  }, [goals]);
  const selectDate = async (nextDate: string, syncCursor = true) => {
    if (syncCursor) setCursor(toDate(nextDate));
    await loadDate(nextDate, { ensureTasks: nextDate <= today });
  };
  const move = (direction: number) => {
    setExpandedScheduleWeekStart(null);
    setCursor((value) => {
      const next = new Date(value);
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
      return next;
    });
  };
  const expandDate = (nextDate: string) => {
    setExpandedScheduleWeekStart(startOfWeek(nextDate));
    void selectDate(nextDate);
  };
  const moveExpandedWeek = (direction: number) => {
    if (!expandedScheduleWeekStart) return;
    const nextWeekStart = addLocalDays(
      expandedScheduleWeekStart,
      direction * 7,
    );
    const selectedWeekday = (toDate(date).getDay() + 6) % 7;
    const nextDate = addLocalDays(nextWeekStart, selectedWeekday);
    setExpandedScheduleWeekStart(nextWeekStart);
    setCursor(toDate(nextDate));
    void selectDate(nextDate, false);
  };
  const openCreate = (localDate = date || today) => {
    setEditingEvent(null);
    setDraft(emptyEvent(localDate));
    setEventOpen(true);
  };
  const openEdit = (event: LearningScheduleEvent) => {
    setEditingEvent(event);
    setDraft({
      title: event.title,
      localDate: event.localDate,
      startTime: event.startTime,
      endTime: event.endTime,
      allDay: event.allDay,
      kind: event.kind,
      notes: event.notes,
    });
    setEventOpen(true);
  };
  const saveEvent = async () => {
    if (!draft.title.trim()) return;
    if (
      !draft.allDay &&
      draft.startTime &&
      draft.endTime &&
      draft.endTime <= draft.startTime
    ) {
      toast.error("结束时间需要晚于开始时间");
      return;
    }
    await saveLearningScheduleEvent(
      { ...draft, title: draft.title.trim(), notes: draft.notes.trim() },
      editingEvent?.id,
    );
    setEventOpen(false);
    await reload();
    await selectDate(draft.localDate);
    toast.success(editingEvent ? "日程已更新" : "日程已添加");
  };
  const removeEvent = async (event: LearningScheduleEvent) => {
    await deleteLearningScheduleEvent(event.id);
    await reload();
    toast.success("日程已删除");
  };
  const dropEvent = async (eventId: string, nextDate: string) => {
    const event = events.find((item) => item.id === eventId);
    if (!event || event.localDate === nextDate) return;
    await saveLearningScheduleEvent(
      {
        title: event.title,
        localDate: nextDate,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        kind: event.kind,
        notes: event.notes,
      },
      event.id,
    );
    await reload();
    toast.success(`已移动到 ${nextDate}`);
  };

  const renderEvent = (event: LearningScheduleEvent) => (
    <button
      key={event.id}
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/learning-event", event.id)
      }
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openEdit(event);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px]",
        event.kind === "milestone"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "bg-primary/10 text-primary",
      )}
      title={event.title}
    >
      {event.kind === "milestone" ? (
        <Flag className="size-3 shrink-0" />
      ) : (
        <Clock3 className="size-3 shrink-0" />
      )}
      <span className="truncate">
        {event.allDay ? "" : `${event.startTime} `}
        {event.title}
      </span>
    </button>
  );
  const dayCell = (cell: string) => {
    const summary = summaryMap.get(cell);
    const dayEvents = eventMap.get(cell) || [];
    const deadlines = deadlineMap.get(cell) || [];
    return (
      <div
        key={cell}
        role="button"
        tabIndex={0}
        onClick={() => expandDate(cell)}
        onDoubleClick={() => openCreate(cell)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            expandDate(cell);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void dropEvent(e.dataTransfer.getData("text/learning-event"), cell);
        }}
        className={cn(
          "flex min-h-28 flex-col gap-1 border-b border-r p-1.5 text-left hover:bg-muted/40",
          cell === date && "bg-primary/5 ring-1 ring-inset ring-primary",
          cell === today && "font-semibold",
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-full text-xs",
              cell === today && "bg-primary text-primary-foreground",
            )}
          >
            {Number(cell.slice(-2))}
          </span>
          {summary?.hasReport ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
              title="当天已打卡"
            >
              <CalendarCheck2 className="size-3" />
              已打卡
            </span>
          ) : null}
        </div>
        <div className="space-y-1">
          {deadlines.slice(0, 2).map((goal) => (
            <div
              key={goal.id}
              className={cn(
                "flex items-center gap-1 truncate rounded px-1.5 py-1 text-[11px] font-medium",
                goal.status === "completed"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-destructive/10 text-destructive",
              )}
              title={`${goal.title} · ${goal.status === "completed" ? "已达成" : "目标截止"}`}
            >
              <Flag className="size-3 shrink-0" />
              <span className="truncate">
                {goal.status === "completed" ? "已达成" : "截止"} · {goal.title}
              </span>
            </div>
          ))}
          {deadlines.length > 2 ? (
            <span className="block px-1.5 text-[10px] text-muted-foreground">
              另有 {deadlines.length - 2} 个目标截止
            </span>
          ) : null}
          {dayEvents.slice(0, 3).map(renderEvent)}
        </div>
        <span className="mt-auto flex justify-between text-[10px] text-muted-foreground">
          <span>
            {summary?.taskTotal
              ? `${summary.taskDone}/${summary.taskTotal} 任务`
              : ""}
          </span>
          <span>
            {summary?.focusedMinutes ? `${summary.focusedMinutes}m` : ""}
          </span>
        </span>
      </div>
    );
  };

  const renderMonth = () => {
    const cells = monthCells(cursor);
    const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
      cells.slice(index * 7, index * 7 + 7),
    );
    return (
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-l border-t">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="border-b border-r bg-muted/30 py-2 text-center text-xs text-muted-foreground"
            >
              周{day}
            </div>
          ))}
        </div>
        {weeks.map((week, weekIndex) => {
          const firstDate = week.find(Boolean);
          const weekStart = firstDate ? startOfWeek(firstDate) : null;
          if (weekStart && expandedScheduleWeekStart === weekStart) {
            return (
              <div key={`week-${weekIndex}`}>
                {renderExpandedWeek(weekStart)}
              </div>
            );
          }
          return (
            <div key={`week-${weekIndex}`}>
              <div className="grid grid-cols-7 border-l">
                {week.map((cell, dayIndex) =>
                  cell ? (
                    dayCell(cell)
                  ) : (
                    <div
                      key={`empty-${weekIndex}-${dayIndex}`}
                      className="min-h-28 border-b border-r bg-muted/10"
                    />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </Card>
    );
  };
  const renderExpandedWeek = (start: string) => {
    const end = addLocalDays(start, 6);
    return (
      <div className="animate-in border-b bg-muted/15 duration-200 fade-in slide-in-from-top-1">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div>
            <p className="text-sm font-medium">本周详情</p>
            <p className="text-xs text-muted-foreground">
              {formatChineseDate(start)} — {formatChineseDate(end)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => moveExpandedWeek(-1)}
              aria-label="上一周"
              title="上一周"
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => moveExpandedWeek(1)}
              aria-label="下一周"
              title="下一周"
            >
              <ChevronRight />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpandedScheduleWeekStart(null)}
            >
              <ChevronUp />
              收起
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-l border-t">
          {Array.from({ length: 7 }, (_, index) =>
            addLocalDays(start, index),
          ).map((cell, index) => (
            <div
              key={cell}
              className={cn(
                "min-h-52 border-b border-r p-2",
                cell === date && "bg-primary/5",
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) =>
                void dropEvent(
                  e.dataTransfer.getData("text/learning-event"),
                  cell,
                )
              }
            >
              <button
                className="mb-3 w-full text-left"
                onClick={() => void selectDate(cell, false)}
              >
                <p className="text-xs text-muted-foreground">
                  周{WEEKDAYS[index]}
                </p>
                <p
                  className={cn(
                    "mt-1 text-lg font-semibold",
                    cell === today && "text-primary",
                  )}
                >
                  {Number(cell.slice(-2))}
                </p>
              </button>
              {summaryMap.get(cell)?.hasReport ? (
                <span
                  className="mb-3 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                  title="当天已打卡"
                >
                  <CalendarCheck2 className="size-3.5" />
                  已打卡
                </span>
              ) : null}
              {(deadlineMap.get(cell) || []).length ? (
                <div className="mt-2 space-y-1.5">
                  {(deadlineMap.get(cell) || []).map((goal) => (
                    <div
                      key={goal.id}
                      className={cn(
                        "rounded-md border p-2 text-xs",
                        goal.status === "completed"
                          ? "border-emerald-500/25 bg-emerald-500/5"
                          : "border-destructive/25 bg-destructive/5",
                      )}
                    >
                      <p
                        className={cn(
                          "flex items-center gap-1 font-medium",
                          goal.status === "completed"
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-destructive",
                        )}
                      >
                        <Flag className="size-3.5 shrink-0" />
                        {goal.status === "completed"
                          ? "目标已达成"
                          : "目标截止"}
                      </p>
                      <p
                        className="mt-1 line-clamp-2 font-medium"
                        title={goal.title}
                      >
                        {goal.title}
                      </p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            goal.status === "completed"
                              ? "bg-emerald-500"
                              : "bg-destructive",
                          )}
                          style={{
                            width: `${Math.max(0, Math.min(100, goal.progressPercent))}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        当前进度 {Math.round(goal.progressPercent)}%
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 space-y-1">
                {(eventMap.get(cell) || []).map(renderEvent)}
              </div>
              <div className="mt-3 space-y-2">
                {(expandedWeekTasks.get(cell) || [])
                  .filter((task) => task.status !== "cancelled")
                  .map((task) => (
                    <div
                      key={task.id}
                      className="rounded-md border bg-background/70 p-2"
                    >
                      <div className="flex items-start justify-between gap-2 text-xs">
                        <span
                          className={cn(
                            "line-clamp-2",
                            task.status === "done" &&
                              "text-muted-foreground line-through",
                          )}
                        >
                          {task.title}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {Math.round(task.progressPercent)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(0, Math.min(100, task.progressPercent))}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                {!expandedWeekTasks.get(cell)?.length &&
                !(deadlineMap.get(cell) || []).length &&
                !(eventMap.get(cell) || []).length ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    暂无安排
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <ListChecks className="mr-1 inline size-3" />
                  {summaryMap.get(cell)?.taskDone || 0}/
                  {summaryMap.get(cell)?.taskTotal || 0}
                </span>
                <span>
                  <Clock3 className="mr-1 inline size-3" />
                  {summaryMap.get(cell)?.focusedMinutes || 0} 分钟
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">日程</h1>
          <p className="text-sm text-muted-foreground">
            统一安排工作、生活和目标相关事项；规划任务会自动显示在对应日期。
          </p>
        </div>
        <Button onClick={() => openCreate()}>
          <Plus />
          添加日程
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
        <div className="flex">
          <Button size="icon-sm" variant="ghost" onClick={() => move(-1)}>
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCursor(toDate(today));
              setExpandedScheduleWeekStart(startOfWeek(today));
              void selectDate(today);
            }}
          >
            今天
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => move(1)}>
            <ChevronRight />
          </Button>
        </div>
        <strong className="min-w-36 text-sm">
          {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
        </strong>
        <div className="relative ml-auto min-w-48 flex-1 sm:max-w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索日程…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {renderMonth()}
      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingEvent ? "编辑日程" : "添加日程"}</DialogTitle>
            <DialogDescription>
              全局日程和里程碑会显示在同一时间线上，可在月历或展开周中拖拽改期。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="event-title">标题</Label>
              <Input
                id="event-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-date">日期</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={draft.localDate}
                  onChange={(e) =>
                    setDraft({ ...draft, localDate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>类型</Label>
                <Select
                  value={draft.kind}
                  onValueChange={(kind) =>
                    setDraft({
                      ...draft,
                      kind: kind as SaveLearningScheduleEventInput["kind"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="schedule">普通日程</SelectItem>
                    <SelectItem value="milestone">里程碑</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="event-all-day">全天</Label>
              <Switch
                id="event-all-day"
                checked={draft.allDay}
                onCheckedChange={(allDay) => setDraft({ ...draft, allDay })}
              />
            </div>
            {!draft.allDay ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>开始</Label>
                  <Input
                    type="time"
                    value={draft.startTime || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, startTime: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>结束</Label>
                  <Input
                    type="time"
                    value={draft.endTime || ""}
                    onChange={(e) =>
                      setDraft({ ...draft, endTime: e.target.value })
                    }
                  />
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>备注</Label>
              <Textarea
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter className="justify-between">
            {editingEvent ? (
              <Button
                variant="destructive"
                onClick={() =>
                  void removeEvent(editingEvent).then(() => setEventOpen(false))
                }
              >
                <Trash2 />
                删除
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEventOpen(false)}>
                取消
              </Button>
              <Button
                disabled={!draft.title.trim()}
                onClick={() => void saveEvent()}
              >
                保存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
