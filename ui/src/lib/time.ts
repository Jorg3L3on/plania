// The server sends UTC; the screen shows the browser's local time.
const format = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

export const localTime = (iso: string) => format.format(new Date(iso));

/** "hace 5 min", "hace 3 h", "hace 2 d" from an ISO time. */
export function ago(iso: string, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 90) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

/** "5 min", "3 h", "2 d": a span without the "hace", for uptime. */
export function span(iso: string, nowMs = Date.now()): string {
  return ago(iso, nowMs).replace(/^hace /, "").replace("un momento", "<1 min");
}
