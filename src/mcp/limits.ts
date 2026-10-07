import { ToolError } from "./errors.js";

// Size limits for text written over MCP, checked in code so they come back as TOO_LARGE {field, max}
// instead of an SDK validation error. Strings count characters; arrays count items.
export const TEXT_LIMITS: Record<string, number> = {
  key: 40,
  task_key: 40,
  parent_key: 40,
  initiative_key: 40,
  name: 40,
  title: 200,
  summary: 300,
  branch: 200,
  base_branch: 200,
  pr_url: 500,
  url: 500,
  adr_url: 500,
  request_id: 200,
  next_action: 2_000,
  in_progress_note: 2_000,
  text: 2_000,
  cite: 2_000,
  note: 4_000,
  question: 4_000,
  answer: 4_000,
  scope: 50_000,
  body: 50_000,
  rules: 20_000,
  adr_body: 100_000,
  markdown: 200_000,
};

const DEFAULT_TEXT = 10_000;

export const ITEM_LIMITS: Record<string, { items: number; each: number }> = {
  blocked_by: { items: 50, each: 200 },
  checks: { items: 50, each: 500 },
  tags: { items: 20, each: 40 },
  options: { items: 10, each: 300 },
  commits: { items: 200, each: 64 },
  // batch ops: each op is checked again on its own, with the limits of its fields.
  ops: { items: 50, each: 200_000 },
  fields: { items: 50, each: 60 },
};

function checkText(field: string, value: string, max: number): void {
  if (value.length > max) throw new ToolError("TOO_LARGE", { field, max });
}

// Walks the top-level fields of a tool input (and one level into arrays and plain objects).
export function checkSizes(input: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === "string") checkText(field, value, TEXT_LIMITS[field] ?? DEFAULT_TEXT);
    else if (Array.isArray(value)) {
      const limit = ITEM_LIMITS[field] ?? { items: 100, each: DEFAULT_TEXT };
      if (value.length > limit.items) throw new ToolError("TOO_LARGE", { field, max: limit.items });
      for (const item of value) {
        if (typeof item === "string") checkText(field, item, limit.each);
        else if (item && typeof item === "object") {
          for (const v of Object.values(item)) if (typeof v === "string") checkText(field, v, limit.each);
        }
      }
    } else if (value && typeof value === "object" && field !== "actor") {
      for (const [k, v] of Object.entries(value)) if (typeof v === "string") checkText(`${field}.${k}`, v, TEXT_LIMITS[k] ?? 500);
    }
  }
}
