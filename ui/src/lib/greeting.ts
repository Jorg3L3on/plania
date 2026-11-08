// PLA-09: the /ceo greeting follows the hour in the dashboard's timezone, not a fixed "Buenos días".
export type DayPart = "morning" | "afternoon" | "night";

/** The hour (0-23) at `now` in `timeZone`. */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now);
  return Number.parseInt(hour, 10) % 24;
}

/** 05-11 morning, 12-18 afternoon, the rest night. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 19) return "afternoon";
  return "night";
}

const GREETING: Record<DayPart, string> = { morning: "Buenos días", afternoon: "Buenas tardes", night: "Buenas noches" };
// "mientras dormías" only reads right when the day is starting.
const SUBTITLE: Record<DayPart, string> = { morning: "la compañía mientras dormías", afternoon: "la compañía hoy", night: "la compañía hoy" };

export function greeting(timeZone: string, now: Date = new Date()): { hello: string; subtitle: string } {
  const part = dayPart(hourIn(timeZone, now));
  return { hello: GREETING[part], subtitle: SUBTITLE[part] };
}
