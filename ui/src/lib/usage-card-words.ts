// PLA-I2-10: the words of the reported-usage card (components/team/usage-card.tsx). Pure: no "@/" imports.
import { defineWords } from "./i18n.js";

export const USAGE_CARD = defineWords({
  es: {
    title: "Uso reportado",
    badge: "reportado",
    lead: "Totales por agente, proyecto y semana. Cifras que los agentes informan.",
    loading: "Cargando uso reportado…",
    failed: "No se pudo cargar el uso reportado.",
    empty: "Sin uso reportado.",
    caption: "Tokens reportados por agente, proyecto y semana",
    agent: "Agente",
    project: "Proyecto",
    week: "Semana",
    input: "Entrada",
    output: "Salida",
  },
  en: {
    title: "Reported usage",
    badge: "reported",
    lead: "Totals per agent, project and week. Numbers the agents report.",
    loading: "Loading reported usage…",
    failed: "Could not load the reported usage.",
    empty: "No reported usage.",
    caption: "Tokens reported per agent, project and week",
    agent: "Agent",
    project: "Project",
    week: "Week",
    input: "Input",
    output: "Output",
  },
});
