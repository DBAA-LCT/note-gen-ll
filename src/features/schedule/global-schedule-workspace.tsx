"use client";

import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { LearningCalendarView } from "@/features/learning/calendar-view";
import { formatLocalDate } from "@/lib/learning/date";
import useLearningStore from "@/stores/learning";

export function GlobalScheduleWorkspace() {
  const { initialized, date, settings, initialize } = useLearningStore();

  useEffect(() => {
    void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(
      () => undefined,
    );
  }, [initialize, settings.timeZone]);

  if (!initialized || !date) {
    return (
      <div className="flex h-full flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在准备日程…
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/15">
      <LearningCalendarView />
    </div>
  );
}
