// The server sends UTC; the screen shows the browser's local time.
const format = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

export const localTime = (iso: string) => format.format(new Date(iso));
