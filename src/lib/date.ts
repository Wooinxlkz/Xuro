/** Local-timezone "YYYY-MM-DD", matching what daily_notes.rs expects. */
export function isoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function todayIso(): string {
  return isoDate(new Date());
}
