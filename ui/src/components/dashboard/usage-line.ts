import type { DashboardUsage } from "./types.js";

const count = (n: number) => n.toLocaleString("es-MX");

export const usageCaption = (usage: DashboardUsage) => {
  const parts = [`${usage.week}`, `entrada ${count(usage.input)}`, `salida ${count(usage.output)}`, usage.label];
  if (typeof usage.usd === "number" && Number.isFinite(usage.usd)) {
    parts.push(usage.usd.toLocaleString("es-MX", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }));
  }
  return parts.join(" · ");
};
