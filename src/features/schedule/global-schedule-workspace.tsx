"use client";

import { useEffect } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LearningCalendarView } from "@/features/learning/calendar-view";
import { formatLocalDate } from "@/lib/learning/date";
import useLearningStore from "@/stores/learning";

export function GlobalScheduleWorkspace() {
  const { initialized, error, date, settings, initialize } = useLearningStore();

  useEffect(() => {
    void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(
      () => undefined,
    );
  }, [initialize, settings.timeZone]);

  if (error && (!initialized || !date)) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>日程加载失败</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col items-start gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={() => void initialize(formatLocalDate(Date.now(), settings.timeZone)).catch(() => undefined)}
            >
              <RotateCcw />重试
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

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
