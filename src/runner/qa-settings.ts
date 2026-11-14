// PLA-I46-9: the QA lane's per-project settings (projects.settings.qa, set with set_project). Stored in Plania,
// never in the app repo. verify is the list QA runs on every delivery, in order, in the delivery's checkout.
import { z } from "zod";

const NAME = /^[a-z0-9][a-z0-9 _-]{0,39}$/i;

const verifyItem = z
  .object({
    // Shown on the evidence card: "test", "typecheck", "lint".
    name: z.string().trim().regex(NAME, "letters, digits, spaces, dashes"),
    // Run with sh -c in the checkout, with the shell basics only (never Plania's env).
    command: z.string().trim().min(1).max(300),
    timeout_minutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export const qaSettingsSchema = z
  .object({
    // false turns the lane off for the project even with a QA teammate.
    enabled: z.boolean().optional(),
    verify: z.array(verifyItem).max(8).default([]),
    // A change at or under small_lines (insertions + deletions against sandbox) runs the review on small_model.
    small_lines: z.number().int().min(0).max(100_000).optional(),
    small_model: z.string().trim().min(1).max(60).optional(),
    // The model for a bigger change; absent: the CLI's default.
    model: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const names = new Set<string>();
    s.verify.forEach((v, i) => {
      if (names.has(v.name)) ctx.addIssue({ code: "custom", path: ["verify", i, "name"], message: "duplicate name" });
      names.add(v.name);
    });
  });

export type QaSettings = z.infer<typeof qaSettingsSchema>;

export const SMALL_LINES = 150;
export const SMALL_MODEL = "sonnet";

export function parseQaSettings(v: unknown): { ok: true; settings: QaSettings } | { ok: false; field: string; hint: string } {
  const r = qaSettingsSchema.safeParse(v);
  if (r.success) return { ok: true, settings: r.data };
  const issue = r.error.issues[0]!;
  return { ok: false, field: ["settings", "qa", ...issue.path].join("."), hint: issue.message };
}

// The model for a review of a change this size: small_model when small, else model (null: the CLI default).
export function modelFor(s: QaSettings | undefined, diffLines: number | null): string | null {
  const small = s?.small_lines ?? SMALL_LINES;
  if (diffLines !== null && diffLines <= small) return s?.small_model ?? SMALL_MODEL;
  return s?.model ?? null;
}
