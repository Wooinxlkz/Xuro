import { ChevronLeft, ChevronRight, Sparkle } from "lucide-react";
import { useMemo, useState } from "react";
import { isoDate, todayIso } from "@/lib/date";
import { cx } from "@/lib/utils";
import { useVault } from "@/stores/vault";

const DAILY_FOLDER = "Daily Notes";
const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});

/** Dates (YYYY-MM-DD) that already have a note, read straight off the
 * existing vault tree — no separate "list daily notes" backend command. */
function useDailyNoteDates(): Set<string> {
  const tree = useVault((s) => s.tree);
  return useMemo(() => {
    const folder = tree.find(
      (node) => node.kind === "folder" && node.name === DAILY_FOLDER,
    );
    const dates = new Set<string>();
    for (const child of folder?.children ?? []) {
      if (child.kind === "note" && /^\d{4}-\d{2}-\d{2}\.md$/.test(child.name)) {
        dates.add(child.name.replace(/\.md$/, ""));
      }
    }
    return dates;
  }, [tree]);
}

/** Every date cell for the visible month, padded to full weeks, plus
 * whether each one belongs to the displayed month. */
function monthGrid(monthStart: Date): Array<{ date: Date; inMonth: boolean }> {
  const firstOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstWeekday);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    return { date, inMonth: date.getMonth() === firstOfMonth.getMonth() };
  });
}

export function DailyNotesPage() {
  const [monthStart, setMonthStart] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const dailyNoteDates = useDailyNoteDates();
  const openDailyNote = useVault((s) => s.openDailyNote);
  const today = todayIso();

  const cells = useMemo(() => monthGrid(monthStart), [monthStart]);
  const changeMonth = (delta: number) =>
    setMonthStart((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  return (
    <div className="page-scroll">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-8 pb-24 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
            Daily Notes
          </h1>
          <button
            type="button"
            onClick={() => void openDailyNote(today)}
            className="flex items-center gap-1.5 rounded-md bg-invert px-3 py-1.5 text-[12.5px] font-medium text-invert-ink transition-opacity duration-100 hover:opacity-90"
          >
            <Sparkle size={13} strokeWidth={2} />
            Today
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-panel p-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => changeMonth(-1)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <p className="text-[13px] font-medium text-ink">
            {MONTH_FORMAT.format(monthStart)}
          </p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => changeMonth(1)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="pb-1 text-center text-[10.5px] font-medium text-faint"
            >
              {label}
            </div>
          ))}
          {cells.map(({ date, inMonth }) => {
            const iso = isoDate(date);
            const hasNote = dailyNoteDates.has(iso);
            const isToday = iso === today;
            return (
              <button
                key={iso}
                type="button"
                disabled={!inMonth}
                onClick={() => void openDailyNote(iso)}
                aria-current={isToday ? "date" : undefined}
                className={cx(
                  "relative grid aspect-square place-items-center rounded-lg text-[12.5px] transition-colors duration-100",
                  !inMonth && "pointer-events-none opacity-0",
                  isToday
                    ? "bg-invert text-invert-ink font-semibold"
                    : hasNote
                      ? "bg-panel text-ink hover:bg-hover"
                      : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                {date.getDate()}
                {hasNote && !isToday && (
                  <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-muted" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
