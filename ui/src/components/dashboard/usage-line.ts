import type { DashboardUsage } from "./types.js";
import { LOCALE } from "../../lib/locale.js";

const count = (n: number) => n.toLocaleString(LOCALE);

// PLA-I30-4: spend is tokens, never money. A dollar figure from the server is never shown.
export const usageCaption = (usage: DashboardUsage) =>
  [`${usage.week}`, `entrada ${count(usage.input)}`, `salida ${count(usage.output)}`, usage.label].join(" · ");
