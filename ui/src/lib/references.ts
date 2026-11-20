// PLA-I67-4: an agent's references on «Oficio»: the shapes the server sends (src/references/store.ts and
// src/api/company-oficio-refs.ts), the calls, and the pure rules the page draws with (tested without a browser).

export type ReferenceUse = { runs_carried: number; runs_opened: number; deliveries_carried: number; deliveries_opened: number };
export type Reference = {
  id: string;
  kind: "link" | "image" | "file";
  title: string;
  url: string | null;
  host: string | null;
  snapshot_at: string | null;
  snapshot_chars: number;
  fetch_status: "ok" | "failed" | null;
  fetch_error: { code: string; message: string } | null;
  file_url: string | null;
  mime: "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | null;
  bytes: number | null;
  original_bytes: number | null;
  width: number | null;
  height: number | null;
  tokens: number | null;
  pages: number | null;
  note: string;
  stance: "follow" | "avoid";
  applies: "always" | "on_topic";
  scope: "agent" | "project";
  state: "on" | "off";
  mine: boolean;
  created_at: string;
  uses: ReferenceUse;
};
export type ReferenceFields = Partial<Pick<Reference, "title" | "note" | "stance" | "applies" | "scope" | "state">>;
export type SeatRun = { run_id: string; task_key: string | null; status: string; at: string; references: { id: string; title: string; kind: string; stance: string; opened: boolean }[] };

export const REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
export const REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
export const REFERENCE_ACCEPT = REFERENCE_TYPES.join(",");

/** What the screen says about a refusal: the server's own sentence when it sent one, else the fallback. */
export const refusal = (e: unknown, fallback: string): string => {
  const detail = (e as { detail?: { message?: unknown } } | null)?.detail;
  return typeof detail?.message === "string" ? detail.message : fallback;
};

/** A pasted text that is a web address (one line, http or https). */
export function pastedUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t) || t.length > 2048) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Files a paste or a drop carries that might be references (the server still checks their bytes). */
export const droppedFiles = (list: FileList | null | undefined): File[] => (list ? Array.from(list) : []);

/** The refusal the screen can say before sending: over 5 MB, or a type the browser already knows is wrong. */
export function precheck(f: { size: number; type: string }): "big" | "type" | null {
  if (f.size > REFERENCE_MAX_BYTES) return "big";
  if (f.type && !REFERENCE_TYPES.includes(f.type)) return "type";
  return null;
}

/** The drawing's rows: the seat's references that are on first, newest first, then the ones off; cut to room. */
export function refRows(refs: Reference[], room: number): { shown: Reference[]; more: number } {
  const ordered = [...refs.filter((r) => r.state === "on"), ...refs.filter((r) => r.state === "off")];
  if (ordered.length <= room) return { shown: ordered, more: 0 };
  const keep = Math.max(0, room - 1);
  return { shown: ordered.slice(0, keep), more: ordered.length - keep };
}

/** How many rows the references take, given the room left for both skills and references. */
export function refRoom(total: number, refCount: number): number {
  if (refCount === 0 || total <= 2) return 0;
  return Math.min(refCount, Math.max(1, Math.floor(total / 3)));
}

/** Per delivery key: how many references its runs carried and how many they opened (distinct references). */
export function deliveryRefs(runs: SeatRun[]): Map<string, { carried: number; opened: number }> {
  const by = new Map<string, { carried: Set<string>; opened: Set<string> }>();
  for (const r of runs) {
    if (!r.task_key) continue;
    const e = by.get(r.task_key) ?? { carried: new Set<string>(), opened: new Set<string>() };
    for (const x of r.references) {
      e.carried.add(x.id);
      if (x.opened) e.opened.add(x.id);
    }
    by.set(r.task_key, e);
  }
  return new Map([...by].map(([k, v]) => [k, { carried: v.carried.size, opened: v.opened.size }]));
}
